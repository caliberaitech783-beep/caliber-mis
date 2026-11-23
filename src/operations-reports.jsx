import './log-book-readability.css';
import SmartSelect from './smart-select.jsx';
import ManpowerReports from './manpower-reports.jsx';
import ProductionReports from './production-reports.jsx';
import MeterContinuityReport from './meter-continuity-report.jsx';
import BatchStatusReport from './batch-status-report.jsx';
import SavedReportSteps,{CLOSED_STEPS} from './saved-report-steps.jsx';
import {hasReportSteps} from './saved-report-steps-model.mjs';
import TripTimingReport from './trip-timing-report.jsx';
import LoadingMachineReport from './loading-machine-report.jsx';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {operationReports,requirements,normalise,filterRecords,buildOperationReport} from './operations-report-model.mjs';
import './operations-reports.css';
import {encodeDateRange,parseDateRange} from './date-range-filter.mjs';
import {monthStartDate} from '../shared/operational-start.mjs';
import {shiftDisplayName} from '../shared/shift-master.mjs';
import {sameSite,shiftChoices,siteChoices} from '../shared/report-filter-options.mjs';
import {loadClockText,loadTimeKey,loadedText,rangeDays,rememberLoadTime,usualLoadTime} from './report-load-clock.mjs';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
// The dashboard shows two of these reports at once (Trip Timing & Gap and Loading Equipment-wise). They ask for the same
// dates, so the second one shares the first one's reading of the log books instead of reading the month again. A reading
// is shared for one minute; Refresh always reads again. It is stopped only when no screen is waiting for it any more.
const sharedReadings=new Map();
// parts 'logbooks': the log books with their trip rows, without the scanned cards (Trip Timing & Gap, Loading Equipment-wise);
// '' reads the other reports' data. Since 16 Nov 2026 the full reading keeps only the trip counts of each trip row, so it can
// no longer serve a screen that needs the log books with their trip rows: each kind of reading is held apart.
const OPERATIONS_LOGBOOKS_ONLY=new Set(['timing','loading']);
// The answer is read piece by piece so the loading clock can say how much has arrived (16 Nov 2026). A browser without
// a readable stream reads it whole, as before.
async function readReportJson(response,onBytes){
 const reader=response.body?.getReader?.();
 try{
  if(!reader)return await response.json();
  const pieces=[];let received=0;
  for(;;){const {done,value}=await reader.read();if(done)break;pieces.push(value);received+=value.byteLength;onBytes(received);}
  return JSON.parse(await new Blob(pieces).text());
 }catch(error){
  // A refused request may carry no JSON (a gateway page): say the report is unavailable, not a parse error.
  if(response.ok||error?.name==='AbortError')throw error;
  return {};
 }
}
function operationsData(from,to,token,fresh,parts=''){
 const base=from+'|'+to+'|'+token,usable=held=>held&&Date.now()-held.at<=60000;
 const key=base+'|'+parts;let entry=sharedReadings.get(key);
 if(!entry||fresh||!usable(entry)){
  const controller=new AbortController(),reading={at:Date.now(),users:0,done:false,controller,progress:{phase:'waiting',received:0},stats:null,listeners:new Set()};
  // Each change of step (waiting → receiving → building) is told to the loading clocks at once; the bytes they read every half second.
  const step=phase=>{reading.progress={...reading.progress,phase};for(const listener of reading.listeners){try{listener();}catch{/* a closed screen */}}};
  reading.promise=fetch('/api/reports/operations?'+new URLSearchParams(parts?{from,to,parts}:{from,to}),{headers:{Authorization:`Bearer ${token}`},signal:controller.signal}).then(async response=>{
   step('receiving');
   const result=await readReportJson(response,received=>{reading.progress={phase:'receiving',received};});
   if(!response.ok)throw Error(result?.error||'Report data unavailable ('+response.status+')');
   reading.stats={ms:Date.now()-reading.at,bytes:reading.progress.received};
   // A month of trip rows takes the screen a moment to draw: let the clock say so before the drawing holds the page.
   step('building');await new Promise(resolve=>setTimeout(resolve,80));
   return result;
  }).finally(()=>{reading.done=true;});
  reading.promise.catch(()=>{if(sharedReadings.get(key)===reading)sharedReadings.delete(key);});
  sharedReadings.set(key,reading);entry=reading;
 }
 const reading=entry;reading.users++;
 return {promise:reading.promise,startedAt:reading.at,progress:()=>reading.progress,stats:()=>reading.stats,
  watch(listener){reading.listeners.add(listener);return ()=>reading.listeners.delete(listener);},
  release(){if(--reading.users<=0&&!reading.done){reading.controller.abort();if(sharedReadings.get(key)===reading)sharedReadings.delete(key);}}};
}
// The line shown while the reading runs: the seconds so far, the step it is at and how long it took last time.
function LoadClock({reading,days,parts}){
 const [,redraw]=useState(0);
 useEffect(()=>{if(!reading)return undefined;const timer=setInterval(()=>redraw(n=>n+1),500),unwatch=reading.watch(()=>redraw(n=>n+1));return()=>{clearInterval(timer);unwatch();};},[reading]);
 const usualMs=useMemo(()=>usualLoadTime(loadTimeKey(parts,days)),[parts,days]);
 return <p role="status" className="op-load-clock">{loadClockText({...(reading?.progress()||{}),elapsedMs:reading?Date.now()-reading.startedAt:0,days,usualMs})}</p>;
}
export default function OperationsReports(props){
 if(['door-production','machine-production'].includes(props.reportId))return <ProductionReports {...props}/>;
 if(props.reportId==='meter-continuity')return <MeterContinuityReport {...props}/>;
 if(props.reportId==='batch-status')return <BatchStatusReport {...props}/>;
 if(['manpower','manpower-reconciliation','employee','attendance','ot','attendance-batch','attendance-month','attendance-sheet','attendance-site-sheet','attendance-trip-bio'].includes(props.reportId))return <ManpowerReports {...props}/>;
 return <SavedOperationReports {...props}/>;
}
// The twelve step reports (owner, 18 Nov 2026, second stage) ask the server only for the lines of the steps that are
// open: the server reads the dates once (stored closed days plus a live read of the rest), keeps that reading a few
// minutes and answers each press with a few kilobytes, instead of the browser downloading every card (121 MB for
// 1–18 Nov) and working the steps out itself. The filter choices come only when the dates or filters change.
const STEP_FILTER_KEYS=['site','shift','asset','employee','workOrder'];
function useStepReading({id,filters,monthly,open,token,reload,enabled}){
 const [state,setState]=useState({result:null,answered:CLOSED_STEPS,options:null,error:'',busy:false,startedAt:0,answeredFor:'',loadMs:0});
 const optionsFor=useRef(''),lastReload=useRef(reload);
 const filtersKey=JSON.stringify([id,filters.from,filters.to,...STEP_FILTER_KEYS.map(k=>filters[k]||''),monthly]);
 const openKey=JSON.stringify([open.site,open.slot?.key||'',open.slot?.siteKey||'',open.category?.key||'']);
 useEffect(()=>{
  if(!enabled)return undefined;
  const controller=new AbortController(),optionsKey=filtersKey+'|'+reload,withOptions=optionsFor.current!==optionsKey;
  const fresh=lastReload.current!==reload;lastReload.current=reload;
  const params={id,from:filters.from,to:filters.to,...Object.fromEntries(STEP_FILTER_KEYS.filter(k=>filters[k]).map(k=>[k,filters[k]])),...(monthly?{monthly:'1'}:{}),
   ...(open.site?{openSite:open.site}:{}),...(open.slot?{slot:open.slot.key,slotSite:open.slot.siteKey||''}:{}),...(open.category?{category:open.category.key}:{}),
   ...(withOptions?{options:'1'}:{}),...(fresh?{fresh:'1'}:{})};
  const startedAt=Date.now();
  setState(s=>({...s,busy:true,error:'',startedAt}));
  fetch('/api/reports/operations/steps?'+new URLSearchParams(params),{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
   .then(async response=>{const body=await response.json().catch(()=>({}));if(!response.ok)throw Error(body.error||'Report data unavailable ('+response.status+')');return body;})
   .then(body=>{if(withOptions)optionsFor.current=optionsKey;setState(s=>({...s,result:body,answered:open,options:body.options||s.options,busy:false,answeredFor:filtersKey,loadMs:withOptions?Date.now()-startedAt:s.loadMs}));})
   .catch(error=>{if(error?.name!=='AbortError')setState(s=>({...s,busy:false,error:error.message}));});
  return()=>controller.abort();
 },[enabled,filtersKey,openKey,token,reload]);
 return {...state,current:state.answeredFor===filtersKey};
}
// The clock while the step reading's first answer for these dates is on its way.
function StepClock({startedAt}){
 const [,redraw]=useState(0);
 useEffect(()=>{const timer=setInterval(()=>redraw(n=>n+1),500);return()=>clearInterval(timer);},[]);
 return <p role="status" className="op-load-clock">Loading the report… {Math.max(0,Math.round((Date.now()-startedAt)/1000))} s</p>;
}
function SavedOperationReports({session,reportId='daily',onSelect=()=>{},ReportSection}){
 const [filters,setFilters]=useState(()=>({from:monthStartDate(today()),to:today(),site:'',shift:'',asset:'',employee:'',workOrder:'',loading:''}));
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0),[monthly,setMonthly]=useState(false);
 const id=operationReports.some(r=>r.id===reportId)?reportId:'daily',definition=operationReports.find(r=>r.id===id);
 const parts=OPERATIONS_LOGBOOKS_ONLY.has(id)?'logbooks':'';
 const valid=filters.from&&filters.to&&filters.from>='2026-11-01'&&filters.to>='2026-11-01'&&filters.from<=filters.to&&(Date.parse(filters.to)-Date.parse(filters.from))/86400000<=365;
 const days=rangeDays(filters.from,filters.to),[loadReading,setLoadReading]=useState(null);
 const stepped=hasReportSteps(id);
 // What is open in the steps, for this report only: picking another report starts it again at Step 1.
 const [stepsOpen,setStepsOpen]=useState({id,open:CLOSED_STEPS});
 const open=stepsOpen.id===id?stepsOpen.open:CLOSED_STEPS,setOpen=next=>setStepsOpen({id,open:next});
 const step=useStepReading({id,filters,monthly,open,token:session.token,reload,enabled:stepped&&valid});
 useEffect(()=>{let stopped=false;setError('');if(!valid||stepped){setBusy(false);return;}
   // The commercial reports have no data source yet: they show what they need without reading any card.
   if(requirements[id]){setBusy(false);setData({records:[],cards:[],assets:[],shifts:[],reportRange:filters.from+'|'+filters.to});return;}
   setBusy(true);const reading=operationsData(filters.from,filters.to,session.token,reload>0,parts);setLoadReading(reading);reading.promise.then(result=>{
   // The time is kept once per reading, on this computer, so the next clock can say how long it took last time.
   const stats=reading.stats();if(stats&&!stats.kept){stats.kept=true;rememberLoadTime(loadTimeKey(parts,days),stats.ms);}
   if(!stopped)setData({...result,reportRange:filters.from+'|'+filters.to,loadStats:stats});}).catch(e=>{if(!stopped)setError(e.message);}).finally(()=>{if(!stopped)setBusy(false);});return()=>{stopped=true;reading.release();};},[filters.from,filters.to,session.token,reload,valid,parts,stepped,Boolean(requirements[id])]);
 const all=useMemo(()=>normalise(data?.records||[]),[data]);
 const effective=id==='missing'?{...filters,employee:'',workOrder:''}:filters;
 const selected=useMemo(()=>filterRecords(all,effective),[all,filters,id]);
 // The step reports are built on the server; only the other reports are built here.
 const report=useMemo(()=>stepped?{columns:[],rows:[]}:buildOperationReport(id,selected,{...data,filters:effective,monthly}),[id,selected,data,filters,monthly,stepped]);
 const set=(key,value)=>setFilters(f=>({...f,[key]:value}));
 const optionRows=[...all,...(data?.cards||[]).map(c=>c.draft?{...c.draft,shiftName:shiftDisplayName(c.draft.shiftName)}:{}),...(data?.assets||[]).map(a=>({location:a.site,assetId:a.id,door:a.door})),...(data?.shifts||[]).map(s=>({location:s.site,shiftId:s.id,shiftName:shiftDisplayName(s.name)}))];
 const options=(key,label)=>[...new Map(optionRows.filter(r=>!filters.site||sameSite(r.location,filters.site)).map(r=>[String(r[key]||''),r[label]||r[key]])).entries()].filter(([v])=>v).sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
 const field=(key,label,choices)=> <label>{label}<SmartSelect value={filters[key]} onChange={e=>set(key,e.target.value)} disabled={id==='missing'&&['employee','workOrder'].includes(key)}><option value="">All</option>{choices.map(([value,text])=><option key={value} value={value}>{text}</option>)}</SmartSelect></label>;
 const canExport=Boolean(data)&&!busy&&!error&&valid&&data.reportRange===filters.from+'|'+filters.to;
 const recordDateFilter={value:encodeDateRange(filters.from,filters.to),onChange:value=>{const range=parseDateRange(value);setFilters(current=>({...current,from:range?.from||monthStartDate(today()),to:range?.to||today()}));}};
 // The table of the chosen report. The Trip Timing tab shows it as its "All trip rows" view, beside the two delay views,
 // and the Loading Equipment-wise tab as its "All machines list" view, beside the working and idle time view.
 const table=<ReportSection key={id} reportKey={definition.title} recordDateFilter={recordDateFilter} dataReady={canExport} title={definition.title+' · '+filters.from+' to '+filters.to} category={'operations-'+id} description={'Filters: '+(Object.entries(effective).filter(([key,value])=>value&&!['from','to'].includes(key)).map(([key,value])=>key+': '+value).join(' · ')||'All assigned records')} columns={report.columns.map((label,index)=>({key:id+'-'+index,label,value:row=>row[index]}))} rows={report.rows} emptyMessage="No matching records or exceptions found."/>;
 return <section className="operations-reports">
  <header><div><small>MIS / REPORTS / {definition.group}</small><h1>{definition.title}</h1><p>Saved operational records · {filters.from} to {filters.to}{!busy&&data?.loadStats&&data.reportRange===filters.from+'|'+filters.to?' · '+loadedText(data.loadStats):''}</p></div><div className="op-actions"><button onClick={()=>setReload(v=>v+1)} disabled={busy}>Refresh</button></div></header>
  <div className="op-report-picker"><label>Report<SmartSelect value={id} onChange={e=>onSelect(e.target.value)}>{[...new Set(operationReports.map(r=>r.group))].map(group=><optgroup label={group} key={group}>{operationReports.filter(r=>r.group===group).map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</optgroup>)}</SmartSelect></label></div>
  <div className="op-filters"><label>From<input type="date" min="2026-11-01" value={filters.from} onChange={e=>set('from',e.target.value)}/></label><label>To<input type="date" min="2026-11-01" value={filters.to} onChange={e=>set('to',e.target.value)}/></label>{field('site','Site',stepped?step.options?.site||[]:siteChoices([...all.map(r=>r.location),...(data?.assets||[]).map(a=>a.site)]).map(v=>[v,v]))}{field('shift','Shift',stepped?step.options?.shift||[]:shiftChoices(optionRows.filter(r=>!filters.site||sameSite(r.location,filters.site)).map(r=>r.shiftName)).map(v=>[v,v]))}{field('asset','Vehicle / equipment',stepped?step.options?.asset||[]:options('assetId','door'))}{field('employee','Driver / operator',stepped?step.options?.employee||[]:options('employeeId','employeeName'))}{field('workOrder','Work order',stepped?step.options?.workOrder||[]:options('workOrderContract','workOrderContract'))}{['loading','timing'].includes(id)&&field('loading','Loading equipment',[...new Set(all.flatMap(r=>(r.trips||[]).map(t=>t.equipmentName)))].sort().map(v=>[v,v]))}{id==='trends'&&<label>Grouping<SmartSelect value={monthly?'monthly':'daily'} onChange={e=>setMonthly(e.target.value==='monthly')}><option value="daily">Daily</option><option value="monthly">Monthly</option></SmartSelect></label>}</div>
  {!valid&&<p role="alert">Choose a valid date range of at most 366 days.</p>}{(stepped?step.error:error)&&<p role="alert">{stepped?step.error:error}</p>}{!stepped&&busy&&<LoadClock reading={loadReading} days={days} parts={parts}/>}{stepped&&step.busy&&!step.current&&<StepClock startedAt={step.startedAt}/>}
  {stepped&&valid&&!step.error&&step.result&&<><p className="op-filter-summary">Filters: {Object.entries(effective).filter(([k,v])=>v&&!['from','to'].includes(k)).map(([k,v])=>k+': '+v).join(' · ')||'All sites, assets, shifts and employees'}</p><div className="op-totals"><span><b>{step.result.totals.logbooks}</b> logbooks</span><span><b>{step.result.totals.assets}</b> assets</span><span><b>{step.result.totals.trips}</b> trips</span><span><b>{step.result.totals.reportRows}</b> report rows</span></div>{step.result.note&&<p className="op-notice">{step.result.note}</p>}{id==='scans'&&step.result.scanConnected===false&&<p role="status">Scan data source is not available.</p>}
   <SavedReportSteps key={id} id={id} title={definition.title} period={filters.from+' to '+filters.to} levels={step.result.levels} answered={step.answered} open={open} onOpen={setOpen} busy={step.busy} ReportSection={ReportSection} dataReady={step.current&&!step.busy} recordDateFilter={recordDateFilter}/></>}
  {!stepped&&data&&valid&&!error&&<><p className="op-filter-summary">Filters: {Object.entries(effective).filter(([k,v])=>v&&!['from','to'].includes(k)).map(([k,v])=>k+': '+v).join(' · ')||'All sites, assets, shifts and employees'}</p><div className="op-totals"><span><b>{selected.length}</b> logbooks</span><span><b>{new Set(selected.map(r=>r.assetId)).size}</b> assets</span><span><b>{selected.reduce((s,r)=>s+r.tripsTotal,0)}</b> trips</span><span><b>{report.rows.length}</b> report rows</span></div>{requirements[id]&&<p className="op-notice"><b>Additional data required:</b> {requirements[id]}.</p>}{report.note&&id!=='timing'&&<p className="op-notice">{report.note}</p>}{id==='scans'&&data.scanConnected===false&&<p role="status">Scan data source is not available.</p>}{id==='timing'?<TripTimingReport records={selected} assets={data.assets} loading={filters.loading} period={filters.from+' to '+filters.to} ReportSection={ReportSection} dataReady={canExport} rowsView={<>{report.note&&<p className="op-notice">{report.note}</p>}{table}</>}/>:id==='loading'?<LoadingMachineReport records={selected} assets={data.assets} fleet={data.fleet} batches={data.batches} pulseBreakdowns={data.pulseBreakdowns??null} pulseBreakdownsError={data.pulseBreakdownsError||''} token={session?.token||''} filters={effective} loading={filters.loading} period={filters.from+' to '+filters.to} ReportSection={ReportSection} dataReady={canExport} rowsView={table}/>:table}</>}
 </section>;
}


