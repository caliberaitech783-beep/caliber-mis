import React,{Suspense,lazy,useEffect,useRef,useState} from 'react';
import {BookOpen,Building2,ShieldCheck,ArrowUpRight,X,Download,Printer} from 'lucide-react';
import {openSmartPrint} from './smart-print.mjs';
import TableSmartPrint from './table-smart-print.jsx';
import './log-book-dashboard.css';
import {scanImageExtensionForType} from '../public/scan-image-type.mjs';
import {OPERATIONAL_START} from '../shared/operational-start.mjs';
import {sitesLowToHigh} from '../shared/site-entry-ranking.mjs';
import BatchStatusReport from './batch-status-report.jsx';
import ManpowerReports from './manpower-reports.jsx';
import RecentActivityPanel,{useRecentActivity,windowLabel} from './log-book-recent-activity.jsx';
import {RECENT_WINDOWS,recentSiteRows} from '../shared/recent-activity.mjs';
// Trip Timing & Gap and Loading Equipment-wise are the same screens as on the Reports page; they load after the cards so the
// dashboard opens quickly, and they share one reading of the month's log books.
const OperationsReports=lazy(()=>import('./operations-reports.jsx'));
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
// actions: the pop-up's Smart Print menu, shown beside the close button; it prints the list in the pop-up.
function Dialog({title,close,children,actions=null}){const ref=React.useRef();useEffect(()=>{const prior=document.activeElement;ref.current.showModal();return ()=>prior?.focus?.()},[]);return <dialog ref={ref} className="lb-dialog" aria-label={title} onCancel={close} onClick={e=>{if(e.target===ref.current)close()}}><div className="mis-popup-close-bar"><button type="button" className="mis-popup-close" onClick={close}  aria-label="Close window">× Close</button></div><div className="lb-dialog-head"><h2>{title}</h2><span className="lb-dialog-tools">{actions}<button autoFocus onClick={close} aria-label="Close details"><X size={20}/></button></span></div>{children}</dialog>}
function RecordDetails({selection,filters,session,fetcher,close}){
 const [state,setState]=useState({records:[],loading:true,error:'',cursor:null});
 const load=async(before='')=>{setState(s=>({...s,loading:true,error:''}));try{const response=await fetcher('/api/dashboard/log-books/records?'+query({...filters,...selection,kind:selection.kind,before}),{headers:{Authorization:'Bearer '+session.token},cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to load records.');setState(s=>({records:before?[...s.records,...data.records]:data.records,cursor:data.nextCursor,loading:false,error:''}))}catch(e){setState(s=>({...s,loading:false,error:e.message}))}};
 useEffect(()=>{void load()},[]);
 const openScan=async row=>{try{const response=await fetcher(`/api/log-books/${row.book_type}/${row.id}/source-image`,{headers:{Authorization:'Bearer '+session.token}});if(!response.ok)throw Error('No original scan is available for this entry. Manual entries may have no scan.');const blob=await response.blob();const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=row.book_no.replaceAll('/','-')+scanImageExtensionForType(blob.type);link.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}catch(e){setState(s=>({...s,error:e.message}))}};
 const title=(selection.kind==='vehicle'?'VLB':'ELB')+' saved cards'+(selection.location?' · '+selection.location:''),period=selection.hours?'Saved in the '+windowLabel(selection.hours).toLowerCase():dateLabel(selection.from||filters.from)+' – '+dateLabel(selection.to||filters.to);
 // The print holds the cards listed in the pop-up; while more can still be loaded, its heading says how many it has.
 return <Dialog title={title} close={close} actions={state.records.length>0&&<TableSmartPrint title={title+' · '+period+(state.cursor?' · first '+number(state.records.length)+' cards':'')}/>}><p className="lb-muted">{period} · Saved entries only</p>{state.error&&<p role="alert" className="lb-error">{state.error}</p>}<div className="lb-table-wrap"><table><thead><tr><th>Book number</th><th>Site / date</th><th>Door</th><th data-smart-print-skip="">Original</th></tr></thead><tbody>{state.records.map(r=><tr key={r.id}><td>{r.book_no}</td><td>{r.site}<small>{r.day}</small></td><td>{r.door||'—'}</td><td><button onClick={()=>void openScan(r)}>Download scan</button></td></tr>)}</tbody></table></div>{!state.records.length&&!state.loading&&<p>No saved cards match these filters.</p>}{state.loading&&<p role="status">Loading records…</p>}{state.cursor&&<button disabled={state.loading} onClick={()=>void load(state.cursor)}>Load more cards</button>}</Dialog>
}
// The dashboard on A3 landscape sheets, one report to a sheet: the cards (with the last 24 hours when Sr 1 is shown),
// then each Sr No on screen, each drawn as large as its sheet allows. A report too long for one sheet runs on to the next.
// With All chosen that is every report: Trip Timing & Gap, the site comparison, Batch Status & Turnaround,
// OT & Multiple Duties, then the Loading Equipment-wise Report.
const A3_PAGE={widthMm:420,heightMm:297};
const displayDay=value=>value.slice(8,10)+'-'+value.slice(5,7)+'-'+value.slice(2,4);
// The panels of the dashboard by serial number, in the order they stood on the page (owner, 14 Nov 2026). The cards stay
// on top; below them only the Sr No chosen in the strip is on screen, so opening the dashboard starts the reading of
// Sr 1 alone and not six readings at once. A panel reads from the server the first time it is opened; after that it is
// hidden, not removed, while another Sr No is shown, so its figures and the step reached in it stay.
export const DASHBOARD_PANELS=[{sr:1,name:'Completed in 6, 12 and 24 hours'},{sr:2,name:'Trip Timing & Gap'},{sr:3,name:'Site comparison'},{sr:4,name:'Batch Status & Turnaround'},{sr:5,name:'OT & Multiple Duties'},{sr:6,name:'Loading Equipment-wise'}];
// All: every Sr No on one page, as the dashboard was before, for a look at everything or a print of the whole dashboard.
export const ALL_PANELS='all';
export const panelShown=(chosen,sr)=>chosen===ALL_PANELS||chosen===sr;
// With All chosen the panels are opened one after another, lowest Sr No first, never all in the same moment.
export const nextPanelToOpen=(chosen,opened)=>chosen===ALL_PANELS?DASHBOARD_PANELS.map(panel=>panel.sr).find(sr=>!opened.includes(sr))??null:null;
// The longest All waits for the reports already open to finish reading before it opens the next one anyway.
export const PANEL_OPEN_WAIT_MS=15000;
function SrPanel({sr,chosen,opened,children}){return opened.includes(sr)?<div className="lb-sr" role="tabpanel" id={'lb-sr-'+sr} aria-labelledby={'lb-sr-tab-'+sr} hidden={!panelShown(chosen,sr)}>{children}</div>:null}
export default function LogBookDashboard({session,goto,fetcher=fetch,initialFilters,ReportSection,printDashboard,initialSr=1}){
 const printRoot=useRef(null),[printing,setPrinting]=useState(''),[printError,setPrintError]=useState('');
 // What the user sees on the dashboard page: the banner, the cards and the Sr No on screen (every Sr No when All is chosen).
 const printTarget=()=>printRoot.current?.closest('.erp-mis-dashboard')||printRoot.current;
 const [applied,setApplied]=useState(()=>initialFilters||initialLogbookRange()),[range,setRange]=useState(()=>({from:applied.from,to:applied.to})),[data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0),[selection,setSelection]=useState(null),[siteHours,setSiteHours]=useState(0);
 // The Sr No on screen, and the Sr Nos opened so far (those stay on the page, hidden, with their figures).
 const [sr,setSr]=useState(initialSr),[opened,setOpened]=useState(()=>[initialSr===ALL_PANELS?DASHBOARD_PANELS[0].sr:initialSr]);
 const shown=number=>panelShown(sr,number);
 // Without the report table (a screen that passes no ReportSection) only the panels drawn here have a tab.
 const panels=DASHBOARD_PANELS.filter(panel=>ReportSection||[1,3].includes(panel.sr));
 const chooseSr=next=>{setSr(next);if(next!==ALL_PANELS)setOpened(list=>list.includes(next)?list:[...list,next]);};
 useEffect(()=>{
  const next=nextPanelToOpen(sr,opened);if(next===null)return undefined;
  // A report still reading says "Loading …" or "Reading …" in a status line; a table's "3 of 3 records" line is not one of those.
  const started=Date.now(),reading=()=>[...(printRoot.current?.querySelectorAll('.lb-reports [role=status]')||[])].some(line=>/^(Loading|Reading)\b/.test(line.textContent.trim()));
  const timer=setInterval(()=>{if(reading()&&Date.now()-started<PANEL_OPEN_WAIT_MS)return;clearInterval(timer);setOpened(list=>list.includes(next)?list:[...list,next]);},400);
  return ()=>clearInterval(timer);
 },[sr,opened]);
 // The last 24 hours are read only while Sr 1 is shown, or the site comparison is set to its 6, 12 or 24 hours.
 const live=useRecentActivity({session,fetcher,refresh,active:shown(1)||(shown(3)&&siteHours>0)});
 useEffect(()=>{const abort=new AbortController();setLoading(true);setError('');setData(null);setSelection(null);fetcher('/api/dashboard/log-books?'+query(applied),{signal:abort.signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token}}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error||'Dashboard could not be loaded.');if(!abort.signal.aborted)setData(body)}).catch(e=>{if(!abort.signal.aborted)setError(e.message)}).finally(()=>{if(!abort.signal.aborted)setLoading(false)});return ()=>abort.abort()},[applied,refresh,session.token,fetcher]);
 const choose=(kind,extra={})=>setSelection({kind,...extra});
 const printTitle='Caliber Pulse-II dashboard · '+displayDay(applied.from)+' to '+displayDay(applied.to);
 // What a print or PDF holds besides the cards: the Sr No on screen, by number and name.
 const printedPanel=sr===ALL_PANELS?'every Sr No':'Sr '+sr+' ('+(DASHBOARD_PANELS.find(panel=>panel.sr===sr)?.name||'')+')';
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
  openSmartPrint({title:printTitle,snapshot:sr===ALL_PANELS
    ?'The complete dashboard prints as it looks on screen: the cards, the last 6, 12 and 24 hours, Trip Timing & Gap, the site comparison, Batch Status & Turnaround, OT & Multiple Duties and the Loading Equipment-wise Report, over as many pages as it needs. Wait until every report has finished reading. Choose the paper (A3 suits it best) and the printer next.'
    :'The cards and '+printedPanel+' print as they look on screen. For the complete dashboard, choose All in the Sr No strip first. Choose the paper (A3 suits it best) and the printer next.',
   onPrint:({pageSize,printOptions})=>{
    const dashboard=printTarget();
    if(printDashboard)printDashboard({dashboard,title:printTitle,pageSize,printOptions});
    else void import('./dashboard-pdf.mjs').then(m=>m.printDashboard(dashboard,printTitle)).catch(e=>setPrintError(e.message||'The dashboard could not be printed.'));
   }});
 };
 // Site comparison: the dates chosen above, or the cards saved in the last 6, 12 or 24 hours.
 const siteRows=siteHours?recentSiteRows(live.recent,siteHours,(data?.bySite||[]).map(r=>r.site)):data?.bySite||[];
 // Lowest entry site on top, best site at the bottom, so weak sites are seen first.
 const rankedSites=sitesLowToHigh(siteRows,['vehicle','equipment'].filter(k=>data?.kinds?.includes(k)));
 const max=Math.max(1,...siteRows.flatMap(r=>[r.vehicle,r.equipment]));
 const datesLabel=dateLabel(applied.from)+' – '+dateLabel(applied.to);
 // A sheet for the cards and one for each report on screen. A Sr No that is hidden is not printed.
 return <div className="lb-print-root" data-print-fit="" data-print-pages=".lb-dashboard, .lb-reports > .lb-sr:not([hidden]) > *" data-print-brand="Caliber Pulse-II" data-print-logo="/pulse-ii-icon.png" ref={printRoot}><section className="lb-dashboard" aria-label="VLB and ELB dashboard" aria-busy={loading} data-print-title="VLB & ELB Dashboard" data-print-subtitle={shown(1)?'Saved log book cards and shifts completed':'Saved log book cards'} data-print-note={displayDay(applied.from)+' to '+displayDay(applied.to)+' · '+(applied.location||'All permitted sites')+' · '+(applied.shift||'All shifts')}>
  <form className="lb-filters lb-range" aria-label="Dashboard dates" onSubmit={e=>{e.preventDefault();if(rangeValid(range))setApplied(a=>({...a,from:range.from,to:range.to}));}}>
   <label>From<input type="date" required min={OPERATIONAL_START} max={range.to||todayIst()} value={range.from} onChange={e=>setRange(r=>({...r,from:e.target.value}))}/></label>
   <label>To<input type="date" required min={range.from||OPERATIONAL_START} max={todayIst()} value={range.to} onChange={e=>setRange(r=>({...r,to:e.target.value}))}/></label>
   <button type="submit" className="lb-apply" disabled={!rangeValid(range)||loading}>{loading?'Loading…':'Show dashboard'}</button>
   <button type="button" disabled={loading} onClick={()=>{const month=monthToDate();setRange(month);setApplied(a=>({...a,...month}));}}>Month to date</button>
   <button type="button" disabled={loading} onClick={()=>{const day=todayIst(),one={from:day,to:day};setRange(one);setApplied(a=>({...a,...one}));}}>Today</button>
   <span className="lb-print-actions" data-print-hide="">
    <button type="button" disabled={loading||Boolean(printing)} onClick={()=>void exportPdf()} title={'The cards and '+printedPanel+' as an A3 PDF file'+(sr===ALL_PANELS?'':'. Choose All in the Sr No strip first for the complete dashboard')}><Download size={16}/>{printing||'Export PDF (A3)'}</button>
    <button type="button" disabled={loading||Boolean(printing)} onClick={smartPrint} title="Choose paper, printer, pages and copies"><Printer size={16}/>Smart Print</button>
   </span>
  </form>
  {printing&&<p role="status" className="lb-muted" data-print-hide="">{printing} This takes a few seconds; the cards and {printedPanel} are being drawn.</p>}
  {printError&&<p role="alert" className="lb-error">{printError}</p>}
  {!rangeValid(range)&&<p role="status" className="lb-muted">Choose dates from 01 Nov 2026 up to today, with From not after To.</p>}
  {error&&<div role="alert" className="lb-error">{error} <button onClick={()=>setRefresh(n=>n+1)}>Retry</button></div>}{loading&&<p role="status" className="lb-loading">Loading site totals and graphs…</p>}
  {data&&<><div className="lb-context"><span>{dateLabel(applied.from)} – {dateLabel(applied.to)} · {applied.location||'All permitted sites'} · {applied.shift||'All shifts'}</span><span>Updated {new Date(data.updatedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span></div>
   <div className="lb-kpis">{[{key:'vehicle',name:'Total VLB cards',sub:'Saved vehicle logbook entries',icon:BookOpen,tone:'purple',click:()=>choose('vehicle')},{key:'equipment',name:'Total ELB cards',sub:'Saved equipment logbook entries',icon:BookOpen,tone:'coral',click:()=>choose('equipment')},{key:'activeSites',name:'Sites with entries',sub:`of ${data.bySite.length} sites in view`,icon:Building2,tone:'purple',click:()=>setSelection({sites:true})},{key:'recoveryDrafts',name:'My recovery drafts',sub:'Server copies · counted separately',icon:ShieldCheck,tone:'amber',click:()=>setSelection({drafts:true})}].map(({key,name,sub,icon:Icon,tone,click})=><button key={key} className={'lb-kpi lb-tone-'+tone} onClick={click} disabled={['vehicle','equipment'].includes(key)&&!data.kinds.includes(key)}><span className="lb-kpi-top"><span>{name}</span><i><Icon size={21}/></i></span><strong>{['vehicle','equipment'].includes(key)&&!data.kinds.includes(key)?'—':number(data.totals[key])}</strong><span className="lb-kpi-bottom">{sub}<ArrowUpRight size={16}/></span></button>)}</div>
   {!data.kinds.length&&<p>No logbook types are assigned to your login.</p>}
   {data.totals.vehicle+data.totals.equipment===0&&<p className="lb-empty">No saved cards for this period. Start a new logbook entry.</p>}
  </>}
  {/* The Sr No strip: one tab for each panel, then All. Only the Sr No chosen is on screen below it. */}
  <nav className="lb-sr-tabs" role="tablist" aria-label="Dashboard reports by Sr No" data-print-hide="">
   {panels.map(panel=><button key={panel.sr} type="button" role="tab" id={'lb-sr-tab-'+panel.sr} aria-selected={sr===panel.sr} aria-controls={'lb-sr-'+panel.sr} onClick={()=>chooseSr(panel.sr)}><b>Sr {panel.sr}</b><span>{panel.name}</span></button>)}
   <button type="button" role="tab" id="lb-sr-tab-all" aria-selected={sr===ALL_PANELS} onClick={()=>chooseSr(ALL_PANELS)} title="Every Sr No on one page, read one after another. Choose it to print the complete dashboard."><b>All</b><span>Every Sr No</span></button>
  </nav>
  {data&&shown(1)&&<div role="tabpanel" id="lb-sr-1" aria-labelledby="lb-sr-tab-1"><RecentActivityPanel recent={live.recent} error={live.error} Dialog={Dialog} customHours={live.customHours} onCustomHours={live.setCustomHours}/></div>}
  {selection?.kind&&<RecordDetails selection={selection} filters={applied} session={session} fetcher={fetcher} close={()=>setSelection(null)}/>}
  {selection?.sites&&<Dialog title="Sites with saved entries" close={()=>setSelection(null)} actions={<TableSmartPrint title={'Sites with saved entries · '+displayDay(applied.from)+' to '+displayDay(applied.to)}/>}><p className="lb-muted">Sites with zero entries are included for comparison.</p><div className="lb-table-wrap"><table><thead><tr><th>Site</th><th>VLB</th><th>ELB</th></tr></thead><tbody>{sitesLowToHigh(data?.bySite,['vehicle','equipment'].filter(k=>data?.kinds?.includes(k))).map(r=><tr key={r.site}><td>{r.site}</td>{['vehicle','equipment'].map(k=><td key={k}><button disabled={!r[k]} onClick={()=>choose(k,{location:r.site})}>{number(r[k])}</button></td>)}</tr>)}</tbody></table></div></Dialog>}
  {selection?.drafts&&<Dialog title="My recovery drafts" close={()=>setSelection(null)}><p>{number(data.totals.recoveryDrafts)} active server recovery copies match these filters. Copies saved only on another laptop are not counted here.</p><p>These copies are separate from saved logbook totals. Completed recovery copies are removed after their batch is saved and locked.</p>{goto?<button className="lb-apply" onClick={()=>goto('Drafts')}>Open Draft recovery</button>:<p className="lb-muted">Open MIS → Draft recovery in the live app to resume work.</p>}</Dialog>}
 </section>
  {/* Below the cards and the Sr No strip: Sr 2 Trip Timing & Gap, Sr 3 the site comparison, Sr 4 and Sr 5 the two reports, and Sr 6 the
      Loading Equipment-wise Report. Each report keeps its own dates. A report is put on the page the first time its Sr No is opened. */}
  <div className="lb-reports" aria-label="Reports on the dashboard">
   {ReportSection&&<SrPanel sr={2} chosen={sr} opened={opened}><Suspense fallback={<p role="status" className="lb-muted">Loading Trip Timing &amp; Gap Report…</p>}><OperationsReports session={session} reportId="timing" ReportSection={ReportSection}/></Suspense></SrPanel>}
   {data&&shown(3)&&<section className="lb-dashboard lb-sites" role="tabpanel" id="lb-sr-3" aria-label="Site comparison" data-print-title="Site comparison" data-print-subtitle="Saved log book cards by site" data-print-note={siteHours?windowLabel(siteHours):displayDay(applied.from)+' to '+displayDay(applied.to)}>
    <article className="lb-panel"><div className="lb-panel-heading"><div><h3>Site comparison</h3><p>{siteHours?'Cards saved in the '+windowLabel(siteHours).toLowerCase():'Saved cards by site · '+datesLabel} · lowest entry first<span data-print-hide=""> · click a bar to view</span></p></div>
     <div className="lb-site-controls"><div className="lb-window-pick" role="group" aria-label="Period for the site comparison" data-print-hide=""><button type="button" aria-pressed={!siteHours} onClick={()=>setSiteHours(0)}>Selected dates</button>{RECENT_WINDOWS.map(hours=><button key={hours} type="button" aria-pressed={siteHours===hours} onClick={()=>setSiteHours(hours)}>{windowLabel(hours)}</button>)}</div><Legend/>
      {/* The bars as figures: one line per site, in the order on screen. */}
      {rankedSites.length>0&&<span data-print-hide=""><TableSmartPrint title={'Site comparison · '+(siteHours?windowLabel(siteHours):displayDay(applied.from)+' to '+displayDay(applied.to))} rows={rankedSites} columns={[{key:'site',label:'Site',value:r=>r.site},...['vehicle','equipment'].filter(k=>data.kinds.includes(k)).map(kind=>({key:kind,label:(kind==='vehicle'?'VLB':'ELB')+' cards',value:r=>number(r[kind])})),{key:'total',label:'Total cards',value:r=>number(['vehicle','equipment'].filter(k=>data.kinds.includes(k)).reduce((sum,kind)=>sum+Number(r[kind]||0),0))}]}/></span>}</div></div>
     {siteHours>0&&!live.recent?<p role={live.error?'alert':'status'} className="lb-muted lb-site-wait">{live.error||'Reading the last 24 hours…'}</p>
     :<div className="lb-bars">{rankedSites.map(r=><div className="lb-site-row" key={r.site}><span title={r.site}>{r.site}</span><div>{['vehicle','equipment'].filter(k=>data.kinds.includes(k)).map(kind=><button key={kind} className={'lb-bar lb-'+(kind==='vehicle'?'purple':'coral')} disabled={!r[kind]} onClick={()=>choose(kind,{location:r.site,...(siteHours?{hours:siteHours}:{})})} aria-label={`${r.site}, ${kind==='vehicle'?'VLB':'ELB'}, ${r[kind]} saved cards`} title={`${kind==='vehicle'?'VLB':'ELB'}: ${number(r[kind])}`}><i style={{width:r[kind]/max*85+'%'}}/><b>{number(r[kind])}</b></button>)}</div></div>)}</div>}
     <div className="lb-panel-foot">Lowest total (VLB + ELB) on top, highest at the bottom. A shared scale compares VLB and ELB fairly. Zero-entry sites stay visible.{siteHours?' The hours are counted by the time each card was saved, whatever the date on the card.':''}</div></article>
   </section>}
   {ReportSection&&<SrPanel sr={4} chosen={sr} opened={opened}><BatchStatusReport session={session} ReportSection={ReportSection} embedded paused={!shown(4)}/></SrPanel>}
   {ReportSection&&<SrPanel sr={5} chosen={sr} opened={opened}><ManpowerReports session={session} reportId="ot" ReportSection={ReportSection} embedded initialFrom={monthToDate().from}/></SrPanel>}
   {ReportSection&&<SrPanel sr={6} chosen={sr} opened={opened}><Suspense fallback={<p role="status" className="lb-muted">Loading the Loading Equipment-wise Report…</p>}><OperationsReports session={session} reportId="loading" ReportSection={ReportSection}/></Suspense></SrPanel>}
  </div></div>
}
