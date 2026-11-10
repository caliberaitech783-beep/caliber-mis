import React,{useEffect,useRef,useState} from 'react';
import {BookOpen,Building2,ShieldCheck,ArrowUpRight,X,Download,Printer} from 'lucide-react';
import {openSmartPrint} from './smart-print.mjs';
import './log-book-dashboard.css';
import {scanImageExtensionForType} from '../public/scan-image-type.mjs';
import {OPERATIONAL_START} from '../shared/operational-start.mjs';
import {sitesLowToHigh} from '../shared/site-entry-ranking.mjs';
import BatchStatusReport from './batch-status-report.jsx';
import ManpowerReports from './manpower-reports.jsx';
export const LOGBOOK_COLOURS={vehicle:'#56309A',equipment:'#F34856'};
const number=n=>Number(n||0).toLocaleString('en-IN');
const todayIst=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
// The dashboard opens on the month so far: 1 November 2026 (the first operating day) to today, then the 1st of each later month.
export function monthToDate(to=todayIst()){const first=to.slice(0,8)+'01';return {from:first<OPERATIONAL_START?OPERATIONAL_START:first,to};}
export function initialLogbookRange(){return {...monthToDate(),location:'',shift:''};}
export const rangeValid=({from,to},today=todayIst())=>Boolean(from&&to)&&from>=OPERATIONAL_START&&to>=from&&to<=today&&(Date.parse(to)-Date.parse(from))/86400000<=365;
const query=filters=>new URLSearchParams(Object.entries(filters).filter(([,v])=>v)).toString();
const dateLabel=value=>new Date(value+'T00:00:00Z').toLocaleDateString('en-IN',{day:'2-digit',month:'short',timeZone:'UTC'});
function Legend(){return <div className="lb-legend"><span><i className="lb-purple"/>VLB · Vehicle</span><span><i className="lb-coral"/>ELB · Equipment</span></div>}
function Dialog({title,close,children}){const ref=React.useRef();useEffect(()=>{const prior=document.activeElement;ref.current.showModal();return ()=>prior?.focus?.()},[]);return <dialog ref={ref} className="lb-dialog" aria-label={title} onCancel={close} onClick={e=>{if(e.target===ref.current)close()}}><div className="mis-popup-close-bar"><button type="button" className="mis-popup-close" onClick={close}  aria-label="Close window">× Close</button></div><div className="lb-dialog-head"><h2>{title}</h2><button autoFocus onClick={close} aria-label="Close details"><X size={20}/></button></div>{children}</dialog>}
function RecordDetails({selection,filters,session,fetcher,close}){
 const [state,setState]=useState({records:[],loading:true,error:'',cursor:null});
 const load=async(before='')=>{setState(s=>({...s,loading:true,error:''}));try{const response=await fetcher('/api/dashboard/log-books/records?'+query({...filters,...selection,kind:selection.kind,before}),{headers:{Authorization:'Bearer '+session.token},cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to load records.');setState(s=>({records:before?[...s.records,...data.records]:data.records,cursor:data.nextCursor,loading:false,error:''}))}catch(e){setState(s=>({...s,loading:false,error:e.message}))}};
 useEffect(()=>{void load()},[]);
 const openScan=async row=>{try{const response=await fetcher(`/api/log-books/${row.book_type}/${row.id}/source-image`,{headers:{Authorization:'Bearer '+session.token}});if(!response.ok)throw Error('No original scan is available for this entry. Manual entries may have no scan.');const blob=await response.blob();const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=row.book_no.replaceAll('/','-')+scanImageExtensionForType(blob.type);link.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}catch(e){setState(s=>({...s,error:e.message}))}};
 return <Dialog title={(selection.kind==='vehicle'?'VLB':'ELB')+' saved cards'+(selection.location?' · '+selection.location:'')} close={close}><p className="lb-muted">{dateLabel(selection.from||filters.from)} – {dateLabel(selection.to||filters.to)} · Saved entries only</p>{state.error&&<p role="alert" className="lb-error">{state.error}</p>}<div className="lb-table-wrap"><table><thead><tr><th>Book number</th><th>Site / date</th><th>Door</th><th>Original</th></tr></thead><tbody>{state.records.map(r=><tr key={r.id}><td>{r.book_no}</td><td>{r.site}<small>{r.day}</small></td><td>{r.door||'—'}</td><td><button onClick={()=>void openScan(r)}>Download scan</button></td></tr>)}</tbody></table></div>{!state.records.length&&!state.loading&&<p>No saved cards match these filters.</p>}{state.loading&&<p role="status">Loading records…</p>}{state.cursor&&<button disabled={state.loading} onClick={()=>void load(state.cursor)}>Load more cards</button>}</Dialog>
}
// The dashboard on A3 landscape sheets, one report to a sheet: the cards and graphs, Batch Status & Turnaround, then
// OT & Multiple Duties, each drawn as large as its sheet allows. A report too long for one sheet runs on to the next.
const A3_PAGE={widthMm:420,heightMm:297};
const displayDay=value=>value.slice(8,10)+'-'+value.slice(5,7)+'-'+value.slice(2,4);
export default function LogBookDashboard({session,goto,fetcher=fetch,initialFilters,ReportSection,printDashboard}){
 const printRoot=useRef(null),[printing,setPrinting]=useState(''),[printError,setPrintError]=useState('');
 // Everything the user sees on the dashboard page: the banner, the cards and graphs, and the two reports.
 const printTarget=()=>printRoot.current?.closest('.erp-mis-dashboard')||printRoot.current;
 const [applied,setApplied]=useState(()=>initialFilters||initialLogbookRange()),[range,setRange]=useState(()=>({from:applied.from,to:applied.to})),[data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0),[selection,setSelection]=useState(null),[showTable,setShowTable]=useState(false);
 useEffect(()=>{const abort=new AbortController();setLoading(true);setError('');setData(null);setSelection(null);fetcher('/api/dashboard/log-books?'+query(applied),{signal:abort.signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token}}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error||'Dashboard could not be loaded.');if(!abort.signal.aborted)setData(body)}).catch(e=>{if(!abort.signal.aborted)setError(e.message)}).finally(()=>{if(!abort.signal.aborted)setLoading(false)});return ()=>abort.abort()},[applied,refresh,session.token,fetcher]);
 const [compact,setCompact]=useState(()=>window.matchMedia('(max-width:540px)').matches);
 useEffect(()=>{const media=window.matchMedia('(max-width:540px)'),change=()=>setCompact(media.matches);media.addEventListener('change',change);return ()=>media.removeEventListener('change',change)},[]);
 const chartWidth=compact?420:760,plotWidth=chartWidth-100;
 const choose=(kind,extra={})=>setSelection({kind,...extra});
 const printTitle='Caliber Pulse-II dashboard · '+displayDay(applied.from)+' to '+displayDay(applied.to);
 const exportPdf=async()=>{
  if(printing)return;setPrintError('');setPrinting('Preparing the A3 PDF…');
  try{
   const {dashboardPrintPdf}=await import('./dashboard-pdf.mjs');
   const blob=await dashboardPrintPdf(printTarget(),A3_PAGE);
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='Caliber-Pulse-II-Dashboard-'+displayDay(applied.from)+'-to-'+displayDay(applied.to)+'-A3.pdf';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }catch(e){setPrintError(e.message||'The dashboard PDF could not be prepared.');}
  finally{setPrinting('');}
 };
 const smartPrint=()=>{
  setPrintError('');
  openSmartPrint({title:printTitle,snapshot:'The complete dashboard prints as it looks on screen: the cards, both graphs, Batch Status & Turnaround and OT & Multiple Duties, over as many pages as it needs. Choose the paper (A3 suits it best) and the printer next.',
   onPrint:({pageSize,printOptions})=>{
    const dashboard=printTarget();
    if(printDashboard)printDashboard({dashboard,title:printTitle,pageSize,printOptions});
    else void import('./dashboard-pdf.mjs').then(m=>m.printDashboard(dashboard,printTitle)).catch(e=>setPrintError(e.message||'The dashboard could not be printed.'));
   }});
 };
 // Lowest entry site on top, best site at the bottom, so weak sites are seen first.
 const rankedSites=sitesLowToHigh(data?.bySite,['vehicle','equipment'].filter(k=>data?.kinds?.includes(k)));
 const max=Math.max(1,...(data?.bySite||[]).flatMap(r=>[r.vehicle,r.equipment])),trend=data?.trend||[],top=Math.max(4,Math.ceil(Math.max(0,...trend.flatMap(r=>[r.vehicle,r.equipment]))/4)*4),x=i=>52+(trend.length<2?plotWidth/2:i/(trend.length-1)*plotWidth),y=n=>190-n/top*150;
 return <div className="lb-print-root" data-print-fit="" data-print-pages=".lb-dashboard, .lb-reports > *" data-print-brand="Caliber Pulse-II" data-print-logo="/pulse-ii-icon.png" ref={printRoot}><section className="lb-dashboard" aria-label="VLB and ELB dashboard" aria-busy={loading} data-print-title="VLB & ELB Dashboard" data-print-subtitle="Saved log book cards by site and by day" data-print-note={displayDay(applied.from)+' to '+displayDay(applied.to)+' · '+(applied.location||'All permitted sites')+' · '+(applied.shift||'All shifts')}>
  <form className="lb-filters lb-range" aria-label="Dashboard dates" onSubmit={e=>{e.preventDefault();if(rangeValid(range))setApplied(a=>({...a,from:range.from,to:range.to}));}}>
   <label>From<input type="date" required min={OPERATIONAL_START} max={range.to||todayIst()} value={range.from} onChange={e=>setRange(r=>({...r,from:e.target.value}))}/></label>
   <label>To<input type="date" required min={range.from||OPERATIONAL_START} max={todayIst()} value={range.to} onChange={e=>setRange(r=>({...r,to:e.target.value}))}/></label>
   <button type="submit" className="lb-apply" disabled={!rangeValid(range)||loading}>{loading?'Loading…':'Show dashboard'}</button>
   <button type="button" disabled={loading} onClick={()=>{const month=monthToDate();setRange(month);setApplied(a=>({...a,...month}));}}>Month to date</button>
   <button type="button" disabled={loading} onClick={()=>{const day=todayIst(),one={from:day,to:day};setRange(one);setApplied(a=>({...a,...one}));}}>Today</button>
   <span className="lb-print-actions" data-print-hide="">
    <button type="button" disabled={loading||Boolean(printing)} onClick={()=>void exportPdf()} title="The complete dashboard as an A3 PDF file"><Download size={16}/>{printing||'Export PDF (A3)'}</button>
    <button type="button" disabled={loading||Boolean(printing)} onClick={smartPrint} title="Choose paper, printer, pages and copies"><Printer size={16}/>Smart Print</button>
   </span>
  </form>
  {printing&&<p role="status" className="lb-muted" data-print-hide="">{printing} This takes a few seconds; the whole dashboard is being drawn.</p>}
  {printError&&<p role="alert" className="lb-error">{printError}</p>}
  {!rangeValid(range)&&<p role="status" className="lb-muted">Choose dates from 01 Nov 2026 up to today, with From not after To.</p>}
  {error&&<div role="alert" className="lb-error">{error} <button onClick={()=>setRefresh(n=>n+1)}>Retry</button></div>}{loading&&<p role="status" className="lb-loading">Loading site totals and graphs…</p>}
  {data&&<><div className="lb-context"><span>{dateLabel(applied.from)} – {dateLabel(applied.to)} · {applied.location||'All permitted sites'} · {applied.shift||'All shifts'}</span><span>Updated {new Date(data.updatedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span></div>
   <div className="lb-kpis">{[{key:'vehicle',name:'Total VLB cards',sub:'Saved vehicle logbook entries',icon:BookOpen,tone:'purple',click:()=>choose('vehicle')},{key:'equipment',name:'Total ELB cards',sub:'Saved equipment logbook entries',icon:BookOpen,tone:'coral',click:()=>choose('equipment')},{key:'activeSites',name:'Sites with entries',sub:`of ${data.bySite.length} sites in view`,icon:Building2,tone:'purple',click:()=>setSelection({sites:true})},{key:'recoveryDrafts',name:'My recovery drafts',sub:'Server copies · counted separately',icon:ShieldCheck,tone:'amber',click:()=>setSelection({drafts:true})}].map(({key,name,sub,icon:Icon,tone,click})=><button key={key} className={'lb-kpi lb-tone-'+tone} onClick={click} disabled={['vehicle','equipment'].includes(key)&&!data.kinds.includes(key)}><span className="lb-kpi-top"><span>{name}</span><i><Icon size={21}/></i></span><strong>{['vehicle','equipment'].includes(key)&&!data.kinds.includes(key)?'—':number(data.totals[key])}</strong><span className="lb-kpi-bottom">{sub}<ArrowUpRight size={16}/></span></button>)}</div>
   {!data.kinds.length&&<p>No logbook types are assigned to your login.</p>}
   <div className="lb-graphs"><article className="lb-panel"><div className="lb-panel-heading"><div><h3>Site comparison</h3><p>Saved cards by site · lowest entry first<span data-print-hide=""> · click a bar to view</span></p></div><Legend/></div><div className="lb-bars">{rankedSites.map(r=><div className="lb-site-row" key={r.site}><span title={r.site}>{r.site}</span><div>{['vehicle','equipment'].filter(k=>data.kinds.includes(k)).map(kind=><button key={kind} className={'lb-bar lb-'+(kind==='vehicle'?'purple':'coral')} disabled={!r[kind]} onClick={()=>choose(kind,{location:r.site})} aria-label={`${r.site}, ${kind==='vehicle'?'VLB':'ELB'}, ${r[kind]} saved cards`} title={`${kind==='vehicle'?'VLB':'ELB'}: ${number(r[kind])}`}><i style={{width:r[kind]/max*85+'%'}}/><b>{number(r[kind])}</b></button>)}</div></div>)}</div><div className="lb-panel-foot">Lowest total (VLB + ELB) on top, highest at the bottom. A shared scale compares VLB and ELB fairly. Zero-entry sites stay visible.</div></article>
   <article className="lb-panel"><div className="lb-panel-heading"><div><h3>Daily entry trend</h3><p>Book date · saved cards per day</p></div><Legend/></div><div className="lb-line-wrap"><svg viewBox={`0 0 ${chartWidth} 240`} role="img" aria-label="Daily VLB and ELB saved card counts"><text x="10" y="18" className="lb-axis-title">Cards</text>{[0,.25,.5,.75,1].map(f=><g key={f}><line x1="52" x2={chartWidth-48} y1={y(top*f)} y2={y(top*f)} stroke="var(--lb-line)"/><text x="42" y={y(top*f)+4} textAnchor="end">{number(Math.ceil(top*f))}</text></g>)}{['vehicle','equipment'].filter(k=>data.kinds.includes(k)).map(kind=><g key={kind}><polyline fill="none" stroke={LOGBOOK_COLOURS[kind]} strokeWidth="3" strokeDasharray={kind==='equipment'?'7 4':undefined} points={trend.map((r,i)=>`${x(i)},${y(r[kind])}`).join(' ')}/>{trend.map((r,i)=><circle key={r.date} cx={x(i)} cy={y(r[kind])} r="4.5" fill={LOGBOOK_COLOURS[kind]} stroke="white" strokeWidth="1.5" role="button" tabIndex={r[kind]?0:-1} aria-label={`${r.date} ${kind==='vehicle'?'VLB':'ELB'} ${r[kind]} cards`} onClick={()=>{if(r[kind])choose(kind,{from:r.date,to:r.date})}} onKeyDown={e=>{if(r[kind]&&['Enter',' '].includes(e.key)){e.preventDefault();choose(kind,{from:r.date,to:r.date})}}}><title>{dateLabel(r.date)} · {kind==='vehicle'?'VLB':'ELB'}: {r[kind]}</title></circle>)}</g>)}{trend.filter((r,i)=>i===0||i===trend.length-1||(trend.length>5&&i%Math.ceil(trend.length/5)===0)).map(r=><text key={r.date} x={x(trend.indexOf(r))} y="218" textAnchor="middle">{dateLabel(r.date)}</text>)}</svg></div><div className="lb-trend-summary"><div><span className="lb-dot lb-purple"/>VLB<strong>{number(data.totals.vehicle)}</strong></div><div><span className="lb-dot lb-coral"/>ELB<strong>{number(data.totals.equipment)}</strong></div></div><div className="lb-panel-foot">Solid purple: VLB · Dashed coral: ELB. Drafts are excluded.</div></article></div>
   {data.totals.vehicle+data.totals.equipment===0&&<p className="lb-empty">No saved cards for this period. Start a new logbook entry.</p>}
   <div className="lb-footer"><span><ShieldCheck size={16}/> Recovery copies protect unfinished work until the batch is saved and locked.</span><button onClick={()=>setShowTable(v=>!v)}>{showTable?'Hide':'Show'} graph data</button></div>
   {showTable&&<div className="lb-table-wrap"><table><caption>Daily saved logbook counts</caption><thead><tr><th>Date</th><th>VLB</th><th>ELB</th></tr></thead><tbody>{trend.map(r=><tr key={r.date}><td>{r.date}</td><td>{r.vehicle}</td><td>{r.equipment}</td></tr>)}</tbody></table></div>}
  </>}
  {selection?.kind&&<RecordDetails selection={selection} filters={applied} session={session} fetcher={fetcher} close={()=>setSelection(null)}/>}
  {selection?.sites&&<Dialog title="Sites with saved entries" close={()=>setSelection(null)}><p className="lb-muted">Sites with zero entries are included for comparison.</p><div className="lb-table-wrap"><table><thead><tr><th>Site</th><th>VLB</th><th>ELB</th></tr></thead><tbody>{rankedSites.map(r=><tr key={r.site}><td>{r.site}</td>{['vehicle','equipment'].map(k=><td key={k}><button disabled={!r[k]} onClick={()=>choose(k,{location:r.site})}>{number(r[k])}</button></td>)}</tr>)}</tbody></table></div></Dialog>}
  {selection?.drafts&&<Dialog title="My recovery drafts" close={()=>setSelection(null)}><p>{number(data.totals.recoveryDrafts)} active server recovery copies match these filters. Copies saved only on another laptop are not counted here.</p><p>These copies are separate from saved logbook totals. Completed recovery copies are removed after their batch is saved and locked.</p>{goto?<button className="lb-apply" onClick={()=>goto('Drafts')}>Open Draft recovery</button>:<p className="lb-muted">Open MIS → Draft recovery in the live app to resume work.</p>}</Dialog>}
 </section>
 {/* The two reports sit below the graphs and keep their own dates, so changing the dashboard dates does not reload them. */}
 {ReportSection&&<div className="lb-reports" aria-label="Reports on the dashboard">
  <BatchStatusReport session={session} ReportSection={ReportSection}/>
  <ManpowerReports session={session} reportId="ot" ReportSection={ReportSection} embedded initialFrom={monthToDate().from}/>
 </div>}</div>
}
