// Trip Card vs Bio-punch (owner, 24 Nov 2026): Reports > Manpower & OT, the tab after Site Sheet vs Trip Card.
// Step 1  your attendance Excel (optional): the P / A sheet the site keeps by hand
// Step 2  the site, a log book (VLB / ELB / LMV), a batch, From and To, then Check: Pulse-II's trip cards and the punches
//         it holds are read once; the log book, the batch and dates inside the ones read change the view at once.
// Then:   Summary; Date-wise (your sheet P · trip cards scanned / manual / zero-trip · bio-punch · all agree · each
//         difference), a date pressed opens its people side by side; the trip cards: "100 cards: 85 OK, need no
//         attention · 15 need attention", only the 15 listed; and a punch with no trip card.
// The Excel has the same, with the sheet Pulse-II would have written in the layout of yours, coloured against it.
// Nothing is changed in Pulse-II. Rules: src/trip-card-biopunch-run.mjs, shared/three-way-attendance.mjs.
import React,{useEffect,useMemo,useState} from 'react';
import {Fingerprint,Upload} from 'lucide-react';
import {dmy} from '../shared/attendance-sheet-check.mjs';
import {OPERATIONAL_START} from '../shared/operational-start.mjs';
import {DAY_DIFFERENCES} from '../shared/three-way-attendance.mjs';
import {readAttendanceFile,sheetApi,todayIst} from './attendance-sheet-run.mjs';
import {bioPunchSummary,bioPunchView,bioPunchWorkbook,defaultRange,rangeProblem,readBioPunchData,MAX_DAYS} from './trip-card-biopunch-run.mjs';
import {TripCardFilters,TripCardVerdict} from './trip-card-verdict.jsx';
import {downloadBlob} from './download-history.mjs';
import './attendance-sheet-check.css';
import './site-sheet-trip-card.css';

const many=(n,one,more=one+'s')=>n+' '+(n===1?one:more);
const col=(key,label,extra={})=>({key,label,value:r=>r[key]===''||r[key]===undefined||r[key]===null?'—':r[key],...extra});
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
// The dates of an uploaded sheet that can be compared: from 1 Nov 2026 to today, at most 31 days.
function sheetRange(sheet,today){
 const dates=sheet.filledDates.filter(d=>d>=OPERATIONAL_START&&d<=today);
 if(!dates.length)return null;
 const limit=addDays(dates[0],MAX_DAYS-1);
 return {from:dates[0],to:dates.at(-1)>limit?limit:dates.at(-1)};
}

export default function TripCardBioPunch({session,ReportSection}){
 const today=todayIst();
 const [sites,setSites]=useState({list:null,error:''}),[site,setSite]=useState('');
 const [file,setFile]=useState({busy:false,name:'',sheet:null,error:''});
 const [filter,setFilter]=useState(()=>({...defaultRange(today),logBook:'',batch:''}));
 const [run,setRun]=useState({busy:false,error:'',data:null});
 const [day,setDay]=useState({date:'',diff:'',onlyDiffs:true});
 useEffect(()=>{
  let live=true;
  sheetApi('/api/reports/manpower/attendance-sheet/sites',session).then(p=>{if(!live)return;setSites({list:p.sites||[],error:''});if(p.sites?.length===1)setSite(p.sites[0]);},e=>live&&setSites({list:[],error:e.message}));
  return()=>{live=false;};
 },[session.token]);
 const sheet=file.sheet,data=run.data;
 const choose=async event=>{
  const picked=event.target.files?.[0];event.target.value='';if(!picked)return;
  setRun({busy:false,error:'',data:null});setDay({date:'',diff:'',onlyDiffs:true});setFile({busy:true,name:picked.name,sheet:null,error:''});
  try{
   const read=await readAttendanceFile(picked),range=sheetRange(read,today);
   setFile({busy:false,name:picked.name,sheet:read,error:range?'':'No date of this sheet can be compared: Pulse-II holds attendance from 01-11-2026 up to today.'});
   if(range)setFilter(f=>({...f,...range,batch:''}));
  }catch(error){setFile({busy:false,name:picked.name,sheet:null,error:error.message});}
 };
 const removeFile=()=>{setFile({busy:false,name:'',sheet:null,error:''});setRun({busy:false,error:'',data:null});setDay({date:'',diff:'',onlyDiffs:true});};
 // Dates inside the ones read change the view at once; dates outside need Check again.
 const inside=Boolean(data)&&filter.from>=data.from&&filter.to<=data.to;
 const problem=rangeProblem(filter.from,filter.to,today);
 const view=useMemo(()=>data&&inside&&!problem?bioPunchView({data,sheet,...filter,today}):null,[data,sheet,inside,problem,filter,today]);
 const check=async()=>{
  setRun({busy:true,error:'',data:null});setDay({date:'',diff:'',onlyDiffs:true});
  try{
   const read=await readBioPunchData({site,from:filter.from,to:filter.to,sheet,session});
   setRun({busy:false,error:'',data:read});setFilter(f=>({...f,batch:''}));
  }catch(error){setRun({busy:false,error:error.message,data:null});}
 };
 const download=()=>{const book=bioPunchWorkbook(view);downloadBlob(book.blob,book.name,{title:book.title});};
 const period=view?dmy(view.from)+' to '+dmy(view.to):'';
 const choice=view?[view.logBook||'All log books',view.batch?'batch '+view.batch:''].filter(Boolean).join(' · '):'';
 const rows=view?bioPunchSummary(view):[];
 const all=view&&!view.logBook&&!view.batch;
 const diffs=view?DAY_DIFFERENCES.filter(d=>(view.sheet||!(d.key.startsWith('sheet')||d.key==='cardNotP'||d.key==='cardNotInSheet'))&&(all||!d.needsAll)):[];
 const pickDate=(date,diff='')=>setDay(d=>({...d,date:d.date===date&&d.diff===diff?'':date,diff}));
 const dayButton=(r,key,tone)=>r[key]?<button type="button" className={'ssc-num ssc-'+tone} aria-pressed={day.date===r.date&&day.diff===key} onClick={()=>pickDate(r.date,key)}>{r[key]}</button>:<span className="tcb-zero">0</span>;
 const TONE={orange:'orange',blue:'blue',purple:'purple',red:'orange',yellow:'purple'};
 const dateColumns=view?[col('dateLabel','Date'),col('locked','Locked'),...(view.sheet?[col('sheetP','Your sheet P')]:[]),col('cards','Trip card attendances'),col('scanned','Trip card – scanned'),
  col('manual','Trip card – manual'),col('zeroTrip','Zero-trip entry'),col('bio','Bio-punch present'),col('agree',view.sheet?'All three agree':'Card and punch agree'),
  ...diffs.map(d=>({key:d.key,label:d.label,value:r=>r[d.key],render:r=>r.id==='total'?r[d.key]:dayButton(r,d.key,TONE[d.tone])})),
  {key:'open',label:'People',value:r=>r.people,render:r=>r.id==='total'?r.people:<button type="button" className="asc-again" aria-pressed={day.date===r.date&&!day.diff} onClick={()=>pickDate(r.date)}>{r.people} · open</button>}]:[];
 const dayLines=view&&day.date?view.lines.filter(l=>l.date===day.date&&(day.diff?l.diffs.includes(day.diff):!day.onlyDiffs||l.diffs.length)):[];
 const dayColumns=view?[col('employeeId','EMP. ID'),col('name','Name'),col('designation','Designation'),...(view.sheet?[col('sheetSays','Your sheet')]:[]),col('cardSays','Trip card (shift · log book · how it came in)'),
  col('books','Card no.'),col('doors','Equipment'),col('bioSays','Bio-punch IN → OUT'),col('result','Result')]:[];
 const punchColumns=[col('dateLabel','Date'),col('employeeId','EMP. ID'),col('employeeName','Name'),col('designation','Designation'),col('inTime','Bio IN'),col('outTime','Bio OUT'),col('sourceLabel','Biometric source'),col('detail','Detail')];
 const machine=data?.biometric?.machine;
 const against=view?.sheet?'your sheet and the bio-punch':'the bio-punch';
 return <div className="asc-page ssc-page">
  <p className="asc-intro">Your attendance Excel, Pulse-II trip cards and the biometric punches Pulse-II holds (machine direct from HR Pulse and files imported on Attendance Management), side by side for drivers and operators. Upload your sheet (or skip it to compare only trip card and bio-punch), choose the site, a log book and the dates, press Check. You get, date by date, your sheet P, the trip cards scanned and manual, the bio-punches and every difference; the trip cards that agree are counted as <b>OK, need no attention</b> and only the ones that need attention are listed. Nothing is changed in Pulse-II.</p>
  <div className="asc-steps">
   <section className="asc-step"><h2>1 · Your attendance Excel (optional)</h2>
    <label className={'asc-upload'+(file.busy?' busy':'')}><Upload size={16}/>{file.busy?'Reading the file…':sheet?'Choose another file':'Choose the Excel file'}<input type="file" accept=".xlsx,.xlsm,.xlk" disabled={file.busy||run.busy} onChange={choose}/></label>
    {sheet&&<p className="asc-note" role="status"><strong>{file.name}</strong> · sheet “{sheet.sheetName}” · {many(sheet.people.length,'employee')} · {sheet.filledDates.length?'marks from '+dmy(sheet.filledDates[0])+' to '+dmy(sheet.filledDates.at(-1)):'no date is marked'} <button type="button" className="asc-again" disabled={run.busy} onClick={removeFile}>Remove</button></p>}
    {file.error&&<p className="asc-error" role="alert">{file.name}: {file.error}</p>}
    {!sheet&&!file.error&&<p className="asc-hint">One line per employee with EMP. ID, NAME and DESIGNATION, and one column per date marked P, A, PL or WO, the same file as Site Sheet vs Trip Card.</p>}
   </section>
  </div>
  <TripCardFilters filter={filter} onChange={change=>{setFilter(f=>({...f,...change}));setDay(d=>({...d,date:'',diff:''}));}} min="2026-11-01" max={today} logBooks={view?.logBooks} batches={view?.batches}
   disabled={run.busy} checked={Boolean(view)} onDownload={view?download:null}>
   <label>Site<select value={site} disabled={run.busy||!sites.list} onChange={e=>{setSite(e.target.value);setRun({busy:false,error:'',data:null});setFilter(f=>({...f,batch:''}));}}>
    <option value="">{sites.list?'Select the site':'Reading your sites…'}</option>{(sites.list||[]).map(name=><option key={name} value={name}>{name}</option>)}
   </select></label>
   <button type="button" className="asc-run tcv-check" disabled={!site||run.busy||Boolean(problem)||file.busy} onClick={check}><Fingerprint size={16}/>{run.busy?'Reading trip cards and punches…':view?'Check again':sheet?'Check: compare all three':'Check'}</button>
  </TripCardFilters>
  {sites.error&&<p className="asc-error" role="alert">{sites.error}</p>}
  {problem&&<p className="asc-hint">{problem}</p>}
  {data&&!view&&!problem&&<p className="asc-hint">These dates are outside the ones read ({dmy(data.from)} to {dmy(data.to)}). Press Check again.</p>}
  {run.busy&&<p className="asc-note" role="status">Reading trip cards and biometric punches of these dates. A full month takes up to a minute.</p>}
  {run.error&&<p className="asc-error" role="alert">{run.error}</p>}
  {view&&<>
   {machine?.asked&&!machine.connected&&<p className="asc-hint">Machine punches could not be read ({machine.error||'HR Pulse did not answer'}); only punches imported on Attendance Management are compared.</p>}
   <ReportSection key={'tcb-summary-'+view.site+view.from+view.to+choice+Boolean(view.sheet)} title={'Summary · '+view.site+' · '+choice+' · '+period}
    category="trip-card-biopunch-summary" description={'What was compared, how each attendance came into Pulse-II, and every difference between '+(view.sheet?'your sheet, ':'')+'trip card and bio-punch.'}
    rows={rows} columns={[col('label','Check'),col('value','Count'),col('note','Note')]} rowKey={r=>r.id} rowClassName={r=>r.tone?'tcb-row-'+r.tone:''} showSearch={false} recordDateFilter={false}/>
   <ReportSection key={'tcb-dates-'+view.site+view.from+view.to+choice+Boolean(view.sheet)} title={'Step 2 · Date-wise · '+(view.sheet?'your sheet vs trip card vs bio-punch':'trip card vs bio-punch')+' · '+choice}
    category="trip-card-biopunch-dates" description={'Each figure is people on that date (drivers and operators). Press a coloured number for those people, or "open" for everyone of the date side by side.'+(all?'':' "No trip card" figures show under All log books only: such a day has no card, so no log book.')}
    rows={[...view.dateRows,view.dateTotal]} columns={dateColumns} rowKey={r=>r.id} rowClassName={r=>r.id==='total'?'tcb-row-total':day.date===r.date?'report-row-picked':''} showSearch={false} recordDateFilter={false}/>
   {day.date?<ReportSection key={'tcb-day-'+day.date+day.diff+day.onlyDiffs+choice} title={'Step 3 · '+dmy(day.date)+' · '+(day.diff?DAY_DIFFERENCES.find(d=>d.key===day.diff).label:day.onlyDiffs?'people with a difference':'everyone')+' · '+dayLines.length}
    category="trip-card-biopunch-day" description={(view.sheet?'Your sheet, ':'')+'the trip card and the bio-punch of each person on this date, side by side.'}
    rows={dayLines} columns={dayColumns} rowKey={r=>r.id} rowClassName={r=>r.diffs.length?'tcv-row-bad':'tcb-row-ok'} recordDateFilter={false} emptyMessage="Nobody differs on this date.">
    {!day.diff&&<div className="ssc-kinds" role="group" aria-label="Who is shown"><button type="button" aria-pressed={day.onlyDiffs} onClick={()=>setDay(d=>({...d,onlyDiffs:true}))}>Only differences</button><button type="button" aria-pressed={!day.onlyDiffs} onClick={()=>setDay(d=>({...d,onlyDiffs:false}))}>Everyone of the date</button></div>}
   </ReportSection>:<p className="ssc-notice">Press a date in the date-wise table to see its people side by side.</p>}
   <TripCardVerdict key={'tcb-verdict-'+view.site+view.from+view.to+Boolean(view.sheet)} view={view} ReportSection={ReportSection} withBio withSheet={Boolean(view.sheet)} against={against} site={view.site} period={period}/>
   {all&&<ReportSection key={'tcb-punch-'+view.site+view.from+view.to} title={'Bio-punch, no trip card · '+view.site+' · '+view.punchOnly.length} category="trip-card-biopunch-other-way"
    description="Punched at this site on a locked date; Pulse-II has no trip card, log book or zero-trip entry for the person that day. Save the missing card or zero-trip entry, or correct the Caliber ID on the card."
    rows={view.punchOnly.map(f=>({...f,dateLabel:dmy(f.date)}))} columns={punchColumns} rowKey={r=>r.id} recordDateFilter={false} emptyMessage="Every punch of a driver or operator has its trip card."/>}
  </>}
 </div>;
}
