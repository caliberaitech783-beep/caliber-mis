// Trip Card vs Bio-punch (owner, 24 Nov 2026): Reports > Manpower & OT, the tab after Site Sheet vs Trip Card.
// Choose the site, a log book (VLB / ELB / LMV), From and To, press Check: Pulse-II's trip cards of the site set beside the
// biometric punches it already holds. On screen:
//   Summary       what was compared, how each attendance came in (trip card scanned / manual / zero-trip entry, with
//                 biometric) and each difference
//   Trip cards    "100 trip cards: 85 OK, need no attention · 15 need attention", then only the 15 with their problems
//   Other way     punched at the site on a locked date, no trip card
// The Excel has the same. Nothing is changed in Pulse-II. Rules: src/trip-card-biopunch-run.mjs.
import React,{useEffect,useMemo,useState} from 'react';
import {Fingerprint} from 'lucide-react';
import {dmy} from '../shared/attendance-sheet-check.mjs';
import {sheetApi,todayIst} from './attendance-sheet-run.mjs';
import {bioPunchSummary,bioPunchView,bioPunchWorkbook,defaultRange,rangeProblem,readBioPunchData} from './trip-card-biopunch-run.mjs';
import {TripCardFilters,TripCardVerdict} from './trip-card-verdict.jsx';
import {downloadBlob} from './download-history.mjs';
import './attendance-sheet-check.css';
import './site-sheet-trip-card.css';

const col=(key,label,extra={})=>({key,label,value:r=>r[key]===''||r[key]===undefined||r[key]===null?'—':r[key],...extra});

export default function TripCardBioPunch({session,ReportSection}){
 const today=todayIst();
 const [sites,setSites]=useState({list:null,error:''}),[site,setSite]=useState('');
 const [filter,setFilter]=useState(()=>({...defaultRange(today),logBook:'',batch:''}));
 const [run,setRun]=useState({busy:false,error:'',data:null});
 useEffect(()=>{
  let live=true;
  sheetApi('/api/reports/manpower/attendance-sheet/sites',session).then(p=>{if(!live)return;setSites({list:p.sites||[],error:''});if(p.sites?.length===1)setSite(p.sites[0]);},e=>live&&setSites({list:[],error:e.message}));
  return()=>{live=false;};
 },[session.token]);
 const data=run.data;
 // Dates inside the ones read change the view at once; dates outside need Check again.
 const inside=Boolean(data)&&filter.from>=data.from&&filter.to<=data.to;
 const problem=rangeProblem(filter.from,filter.to,today);
 const view=useMemo(()=>data&&inside&&!problem?bioPunchView({data,...filter,today}):null,[data,inside,problem,filter,today]);
 const check=async()=>{
  setRun({busy:true,error:'',data:null});
  try{
   const read=await readBioPunchData({site,from:filter.from,to:filter.to,session});
   setRun({busy:false,error:'',data:read});setFilter(f=>({...f,batch:''}));
  }catch(error){setRun({busy:false,error:error.message,data:null});}
 };
 const download=()=>{const book=bioPunchWorkbook(view);downloadBlob(book.blob,book.name,{title:book.title});};
 const period=view?dmy(view.from)+' to '+dmy(view.to):'';
 const rows=view?bioPunchSummary(view):[];
 const punchColumns=[col('dateLabel','Date'),col('employeeId','EMP. ID'),col('employeeName','Name'),col('designation','Designation'),col('inTime','Bio IN'),col('outTime','Bio OUT'),col('sourceLabel','Biometric source'),col('detail','Detail')];
 const machine=data?.biometric?.machine;
 return <div className="asc-page ssc-page">
  <p className="asc-intro">The difference between the trip cards of a site and the biometric punches Pulse-II already holds (machine direct from HR Pulse and files imported on Attendance Management), for drivers and operators. Choose the site, a log book and the dates, press Check. Every trip card attendance is set beside that day's punch: the ones that agree are counted as <b>OK, need no attention</b>, and only the ones that need attention are listed, each with its problem. Nothing is changed in Pulse-II.</p>
  <TripCardFilters filter={filter} onChange={change=>setFilter(f=>({...f,...change}))} min="2026-11-01" max={today} logBooks={view?.logBooks} batches={view?.batches}
   disabled={run.busy} checked={Boolean(view)} onDownload={view?download:null}>
   <label>Site<select value={site} disabled={run.busy||!sites.list} onChange={e=>{setSite(e.target.value);setRun({busy:false,error:'',data:null});setFilter(f=>({...f,batch:''}));}}>
    <option value="">{sites.list?'Select the site':'Reading your sites…'}</option>{(sites.list||[]).map(name=><option key={name} value={name}>{name}</option>)}
   </select></label>
   <button type="button" className="asc-run tcv-check" disabled={!site||run.busy||Boolean(problem)} onClick={check}><Fingerprint size={16}/>{run.busy?'Reading trip cards and punches…':view?'Check again':'Check'}</button>
  </TripCardFilters>
  {sites.error&&<p className="asc-error" role="alert">{sites.error}</p>}
  {problem&&<p className="asc-hint">{problem}</p>}
  {data&&!view&&!problem&&<p className="asc-hint">These dates are outside the ones read ({dmy(data.from)} to {dmy(data.to)}). Press Check again.</p>}
  {run.busy&&<p className="asc-note" role="status">Reading trip cards and biometric punches of these dates. A full month takes up to a minute.</p>}
  {run.error&&<p className="asc-error" role="alert">{run.error}</p>}
  {view&&<>
   {machine?.asked&&!machine.connected&&<p className="asc-hint">Machine punches could not be read ({machine.error||'HR Pulse did not answer'}); only punches imported on Attendance Management are compared.</p>}
   <ReportSection key={'tcb-summary-'+view.site+view.from+view.to+view.logBook+view.batch} title={'Summary · '+view.site+' · '+(view.logBook||'All log books')+(view.batch?' · batch '+view.batch:'')+' · '+period}
    category="trip-card-biopunch-summary" description="What was compared, how each attendance came into Pulse-II, and every difference between trip card and bio-punch."
    rows={rows} columns={[col('label','Check'),col('value','Count'),col('note','Note')]} rowKey={r=>r.id} rowClassName={r=>r.tone?'tcb-row-'+r.tone:''} showSearch={false} recordDateFilter={false}/>
   <TripCardVerdict key={'tcb-verdict-'+view.site+view.from+view.to} view={view} ReportSection={ReportSection} withBio against="the bio-punch" site={view.site} period={period}/>
   {!view.logBook&&!view.batch&&<ReportSection key={'tcb-punch-'+view.site+view.from+view.to} title={'Bio-punch, no trip card · '+view.site+' · '+view.punchOnly.length} category="trip-card-biopunch-other-way"
    description="Punched at this site on a locked date; Pulse-II has no trip card, log book or zero-trip entry for the person that day. Save the missing card or zero-trip entry, or correct the Caliber ID on the card."
    rows={view.punchOnly.map(f=>({...f,dateLabel:dmy(f.date)}))} columns={punchColumns} rowKey={r=>r.id} recordDateFilter={false} emptyMessage="Every punch of a driver or operator has its trip card."/>}
  </>}
 </div>;
}
