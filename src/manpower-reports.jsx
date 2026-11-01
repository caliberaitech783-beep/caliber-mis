import './log-book-readability.css';
import {compactLogBookLabel} from '../log-book-labels.mjs';
import React,{useEffect,useMemo,useState} from 'react';
import {OPERATIONAL_START} from '../operational-start.mjs';
import './manpower-reports.css';

const views=[['manpower','Manpower by Category'],['employee','Shift Performance'],['ot','OT & Multiple Duties']];
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const columns=entries=>entries.map(([key,label])=>({key,label:compactLogBookLabel(label),value:r=>r[key]??'—'}));
const context=[['date','Duty date'],['site','Site'],['shift','Shift']];
const person=[['employeeId','Employee ID'],['caliberCode','Caliber ID'],['employeeName','Driver / operator']];
const classification=[['category','Category'],['group','Equipment group'],['make','Make'],['model','Model']];
const detailColumns=columns([...context,['door','Door / equipment'],...classification,...person,['assignment','Assignment'],['batches','Source batches'],['batchStatus','Batch status'],['book','Saved card'],['remarks','Remarks / review']]);
const summaryColumns=columns([...context,...classification,['assets','Distinct vehicles / equipment'],['employees','Distinct employees'],['unresolved','Unresolved assignment records'],['doors','Door numbers'],['batches','Source batches']]);
const performanceColumns=columns([...context,...person,['doors','Doors worked'],['equipment','Equipment / make / model'],['hours','HMR performance hours'],['trips','Completed trips'],['km','Kilometres'],['start','Scheduled start (IST)'],['end','Scheduled end (IST)'],['batches','Source batches'],['books','Saved cards'],['remarks','Remarks / review']]);
const otColumns=columns([['reason','OT flag / reason'],...person,['site','Site'],['dates','Duty dates'],['shifts','Shifts worked'],['shiftHours','Each shift’s HMR hours'],['combinedHours','Combined HMR performance hours'],['schedule','Scheduled start / end (IST)'],['gaps','Scheduled gap between duties'],['batches','Source batches'],['books','Saved cards'],['remarks','Remarks / review']]).map(c=>c.key==='reason'?{...c,render:r=><strong className={`mp-flag mp-flag-${r.severity}`}>{r.reason}</strong>}:c);
const exceptionColumns=columns([...context,['door','Door / equipment'],['employeeId','Employee ID'],['employeeName','Driver / operator'],['book','Saved card'],['batches','Source batches'],['reason','Review reason']]);

export default function ManpowerReports({session,reportId='manpower',onSelect,ReportSection}){
 const [filters,setFilters]=useState(()=>{const date=today();return {from:date,to:date,site:'',shift:'',batch:'',employee:'',asset:''};});
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[options,setOptions]=useState({});
 const query=useMemo(()=>new URLSearchParams(filters).toString(),[filters]);
 const valid=filters.from>=OPERATIONAL_START&&filters.to>=filters.from&&Date.parse(filters.to)-Date.parse(filters.from)<=30*86400000;
 useEffect(()=>{
  const controller=new AbortController();setError('');setData(null);if(!valid){setBusy(false);return ()=>controller.abort();}setBusy(true);
  fetch('/api/reports/manpower?'+query,{headers:{Authorization:`Bearer ${session.token}`},signal:controller.signal}).then(async response=>{const payload=await response.json();if(!response.ok)throw Error(payload.error||'Unable to load saved manpower records.');return payload;}).then(payload=>{if(!controller.signal.aborted){setData({query,payload});setOptions(payload.options);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[query,session.token,refresh,valid]);
 const ready=data?.query===query&&valid&&!busy&&!error,report=ready?data.payload:null;
 const set=(field,value)=>setFilters(current=>({...current,[field]:value,...(field==='site'?{batch:'',asset:''}:{})}));
 const title=views.find(([id])=>id===reportId)?.[1]||views[0][1];
 const choice=(field,label,items)=><label>{label}<select value={filters[field]} onChange={e=>set(field,e.target.value)}><option value="">All</option>{(items||[]).map(item=>{const value=typeof item==='string'?item:item.value;return <option key={value} value={value}>{typeof item==='string'?item:item.label}</option>;})}</select></label>;
 const description=`${filters.from} to ${filters.to} · ${filters.site||'All assigned sites'} · ${filters.shift||'All shifts'} · Saved records only`;
 return <section className="mp-reports" aria-label="Manpower and OT reports">
  <header className="mp-heading"><div><small>REPORTS / MANPOWER & OT</small><h1>{title}</h1><p>Saved duties, clear assignments and shift-by-shift performance.</p></div><button type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Refresh reports</button></header>
  <nav className="mp-tabs" aria-label="Manpower report views">{views.map(([id,label])=><button key={id} type="button" aria-current={reportId===id?'page':undefined} onClick={()=>onSelect(id)}>{label}</button>)}</nav>
  <div className="mp-filters"><label>From<input type="date" min={OPERATIONAL_START} value={filters.from} onChange={e=>set('from',e.target.value)}/></label><label>To<input type="date" min={OPERATIONAL_START} value={filters.to} onChange={e=>set('to',e.target.value)}/></label>{choice('site','Site',options.sites)}{choice('shift','Shift',options.shifts)}{choice('batch','Saved batch',options.batches)}{choice('employee','Employee',options.employees)}{choice('asset','Door / equipment',options.assets)}<button type="button" onClick={()=>setFilters(f=>({...f,site:'',shift:'',batch:'',employee:'',asset:''}))}>Clear selections</button></div>
  {!valid&&<p role="alert">Choose a valid range of up to 31 days, starting on or after 1 November 2026.</p>}{busy&&<p role="status">Loading saved records and checking shift patterns…</p>}{error&&<p role="alert">{error}</p>}
  {report&&<>
   <p className="mp-source">{description} · Updated {new Date(report.generatedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST</p>
   <div className="mp-metrics">{[['assets','Distinct assets'],['employees','Distinct employees'],['duties','Employee shift duties'],['exceptions','Review items']].map(([key,label])=><div key={key}><strong>{report.totals[key]}</strong><span>{label}</span></div>)}</div>
   {reportId==='ot'?<>
    <div className="mp-legend"><span className="mp-flag mp-flag-red">RED · consecutive shifts / all three shifts</span><span className="mp-flag mp-flag-orange">ORANGE · Shift 1 + Shift 3 with a gap</span><span className="mp-flag mp-flag-review">REVIEW · missing or inconsistent schedule</span></div>
    <p className="mp-notice">Combined hours below are machine HMR performance hours. Actual employee attendance and payable OT hours are not calculated. Cross-midnight cases include the adjoining day. A duty can appear in both a same-day and overnight event; event hours must not be added together.</p>
    <ReportSection key={'ot-'+query} title="OT & Multiple Duties" category="manpower-ot" description={description+' · Scheduled times in IST; HMR performance hours, not payable OT'} rows={report.ot} columns={otColumns} rowKey={r=>r.id} rowClassName={r=>'mp-ot-'+r.severity} emptyMessage="No matching multiple-duty pattern in the saved records."/>
   </>:reportId==='employee'?<>
    <p className="mp-notice">One row per employee, site, date and shift. Changing vehicles within a shift remains one duty. Vehicle and batch selections show the complete matching duty.</p>
    <ReportSection key={'performance-'+query} title="Shift Performance" category="manpower-performance" description={description+' · Each shift is separate; HMR is machine performance'} rows={report.performance} columns={performanceColumns} rowKey={r=>r.id} emptyMessage="No saved duties with a resolved employee identity match these selections."/>
   </>:<>
    <ReportSection key={'summary-'+query} title="Manpower by Category, Make & Model" category="manpower-summary" description={description+' · Distinct assets and employees within each category'} rows={report.summary} columns={summaryColumns} emptyMessage="No saved asset assignments in this selection. An empty batch has no manpower count."/>
    <ReportSection key={'details-'+query} title="Vehicle & Employee Assignments" category="manpower-assignments" description={description} rows={report.details} columns={detailColumns} rowKey={r=>r.id} emptyMessage="No saved assignments match these selections."/>
   </>}
   <ReportSection key={'exceptions-'+query} title="Manpower Data Review" category="manpower-review" description="Unresolved IDs, duplicate candidates, meter conflicts and missing master data remain visible for correction." rows={report.exceptions} columns={exceptionColumns} rowKey={r=>r.id} emptyMessage="No data-review items for these selections."/>
   <details className="mp-notes"><summary>Sources and calculation rules</summary><ul>{report.notes.map(note=><li key={note}>{note}</li>)}</ul><p>Manpower requirements, shortages and relief availability are reserved for a later phase.</p></details>
  </>}
 </section>;
}

