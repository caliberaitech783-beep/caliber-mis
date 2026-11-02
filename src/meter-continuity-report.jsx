import React,{useEffect,useMemo,useState} from 'react';
import {OPERATIONAL_START} from '../operational-start.mjs';
import {CLASS_LABELS,DEFAULT_TOLERANCE} from '../meter-continuity-report.mjs';
import './production-reports.css';
import './meter-continuity-report.css';

// Meter continuity: opening KMR/HMR of each tipper card against the previous card's closing.
// A report only; entry and scanning are untouched. Three tabs: card by card, by driver, by tipper.
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const daysAgo=n=>new Date(Date.parse(today()+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);
const request=async(url,token,signal)=>{const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal});const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to load report.');return data;};
const column=(key,label,value)=>({key,label,value:value||(r=>r[key]===null||r[key]===undefined||r[key]===''?'—':r[key])});
const SHIFT_LABELS={S1:'I',S2:'II',S3:'III',D:'Day',N:'Night'};
const signed=v=>v===null||v===undefined?'—':(v>0?'+':'')+v;

export const cardColumns=[column('date','Date'),column('shift','Shift',r=>SHIFT_LABELS[r.shift]||r.shift),column('door','Tipper'),column('driver','Driver on card',r=>r.driver?`${r.driver}${r.driverId?' ('+r.driverId+')':''}`:'—'),
 column('bookNo','Card'),column('source','Source'),column('previousBookNo','Previous card',r=>r.previousBookNo?`${r.previousBookNo} (${r.previousDate}, ${SHIFT_LABELS[r.previousShift]||r.previousShift})`:'—'),
 column('previousClosingKmr','Prev. closing KMR'),column('openingKmr','Opening KMR'),column('kmGap','KM gap',r=>signed(r.kmGap)),
 column('previousClosingHmr','Prev. closing HMR'),column('openingHmr','Opening HMR'),column('hourGap','HMR gap',r=>signed(r.hourGap)),column('statusLabel','Result')];
export const summaryColumns=label=>[column('label',label),column('cards','Cards'),column('compared','Compared'),column('matches','Match'),column('tolerance','Within tolerance'),column('negatives','Below previous'),column('jumps','Jumps'),column('issueRate','Issue %'),column('averageAbsKmGap','Avg. KM gap'),column('averageAbsHourGap','Avg. HMR gap')];

export default function MeterContinuityReport({session,ReportSection,onSelect,reportId}){
 const [filters,setFilters]=useState({site:'',from:daysAgo(7)<OPERATIONAL_START?OPERATIONAL_START:daysAgo(7),to:today(),kmTolerance:DEFAULT_TOLERANCE.kmTolerance,hourTolerance:DEFAULT_TOLERANCE.hourTolerance});
 const [sites,setSites]=useState([]),[result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[run,setRun]=useState(null),[tab,setTab]=useState('cards');
 const query=useMemo(()=>new URLSearchParams(filters).toString(),[filters]);
 useEffect(()=>{const c=new AbortController();request('/api/reports/production/options',session.token,c.signal).then(o=>setSites(o.sites||[])).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[session.token]);
 useEffect(()=>{
  setResult(null);setBusy(false);if(!run||run.query!==query)return;
  const c=new AbortController();setBusy(true);setError('');request('/api/reports/meter-continuity?'+query,session.token,c.signal).then(data=>{if(!c.signal.aborted)setResult({query,data});}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});
  return()=>c.abort();
 },[run,query,session.token]);
 const set=(key,value)=>{setFilters(f=>({...f,[key]:value}));setError('');};
 const report=result?.query===query&&!busy?result.data:null;
 const valid=filters.site&&filters.from>=OPERATIONAL_START&&filters.to>=filters.from;
 const description=report?`${report.site} · ${report.from} to ${report.to} · tolerance ${report.kmTolerance} km / ${report.hourTolerance} h · ${report.totals.cards} cards, ${report.totals.compared} compared: ${report.totals.matches} match, ${report.totals.tolerance} within tolerance, ${report.totals.negatives} below previous closing, ${report.totals.jumps} jumps · Generated ${new Date(report.generatedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}`:'Run the report to compare each tipper card with its previous card.';
 const tabs=[['cards','Card by card'],['drivers','By driver'],['tippers','By tipper']];
 const rows=report?tab==='cards'?report.rows:tab==='drivers'?report.drivers:report.tippers:[];
 const columns=tab==='cards'?cardColumns:summaryColumns(tab==='drivers'?'Driver':'Tipper');
 return <section className="production-reports meter-continuity-report"><header><small>REPORTS / TRIPS & PRODUCTIVITY</small><h1>Meter Continuity Report</h1><p>Opening KMR and HMR of every tipper card against the closing readings of that tipper's previous card, by date and shift order. Cards save exactly as written; this report only shows where readings do not follow on.</p></header>
  {onSelect&&<nav className="production-tabs" aria-label="Report"><button type="button" aria-current="page">Meter continuity</button></nav>}
  <form className="production-filters" onSubmit={e=>{e.preventDefault();if(valid)setRun({query,at:Date.now()});}}>
   <label>1. Site<select value={filters.site} required onChange={e=>set('site',e.target.value)}><option value="">Select site</option>{sites.map(s=><option key={s}>{s}</option>)}</select></label>
   <label>2. From<input type="date" required min={OPERATIONAL_START} value={filters.from} onChange={e=>set('from',e.target.value)}/></label>
   <label>3. To<input type="date" required min={filters.from||OPERATIONAL_START} value={filters.to} onChange={e=>set('to',e.target.value)}/></label>
   <label>4. KM tolerance<input type="number" min="0" max="500" step="0.5" value={filters.kmTolerance} onChange={e=>set('kmTolerance',e.target.value)}/></label>
   <label>5. HMR tolerance<input type="number" min="0" max="24" step="0.25" value={filters.hourTolerance} onChange={e=>set('hourTolerance',e.target.value)}/></label>
   <button type="submit" disabled={!valid||busy}>{busy?'Running…':'Run report'}</button>
  </form>
  {error&&<p role="alert" className="production-error">{error}</p>}
  <nav className="production-tabs meter-tabs" aria-label="Meter continuity views">{tabs.map(([id,label])=><button key={id} type="button" aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}>{label}</button>)}</nav>
  <p className="meter-legend">{Object.entries(CLASS_LABELS).map(([key,label])=><span key={key} className={'meter-status meter-status-'+key}>{label}</span>)}</p>
  <ReportSection title={tab==='cards'?'Meter continuity, card by card':tab==='drivers'?'Meter continuity by driver':'Meter continuity by tipper'} category={'meter-continuity-'+tab} description={description} columns={columns} rows={rows} rowKey={r=>r.id||r.key} rowClassName={r=>r.status?'meter-row-'+r.status:''} emptyMessage={report?'No cards in this range.':'Run the report to see results.'}/>
 </section>;
}
