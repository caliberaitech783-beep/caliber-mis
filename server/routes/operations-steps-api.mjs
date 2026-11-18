// The step reading of the Operations reports (owner, 18 Nov 2026, second stage). The twelve step reports used to download
// every card of the dates (121 MB for 1–18 Nov) and work Steps 1–4 out in the browser. The server now works them out with
// the same report code (src/operations-report-model.mjs, src/saved-report-steps-model.mjs) and sends only the lines of the
// steps that are open: a few kilobytes per press.
//
// The cards come from the stored closed days (operations-day-store.mjs) plus a live read of the days not stored. One
// reading of the dates is kept for three minutes per site access, so pressing through the steps, changing a filter or
// switching between the step reports does not read again; Refresh (fresh=1) reads again.
import {siteAllowed} from '../../shared/log-book-access.mjs';
import {normalise,filterRecords,buildOperationReport,effectiveOperationFilters,operationFilterOptions} from '../../src/operations-report-model.mjs';
import {hasReportSteps,stepItems,stepLevels} from '../../src/saved-report-steps-model.mjs';
import {operationsDayRecords,operationsDayStoreEnabled} from '../services/operations-day-store.mjs';

export const STEP_READING_MS=3*60000;
const MAX_READINGS=4,MAX_REPORTS=8;
export const STEP_FILTER_KEYS=['site','shift','asset','employee','workOrder'];
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const directLane={run:(_key,compute)=>compute()};

export function registerOperationsSteps(app,{pool,protect,ensure=async()=>{},lane=directLane,readMasters,readScanCards,useStore=operationsDayStoreEnabled(),now=()=>Date.now()}){
 const readings=new Map();
 // One reading of the dates for one site access (and the scanned cards when Scan Review asks), kept a few minutes.
 const readingOf=(req,{from,to,withCards,fresh})=>{
  const scope=req.logBookScope,key=JSON.stringify([from,to,scope?.sites??null,withCards]);
  for(const [k,held] of readings)if(now()-held.at>STEP_READING_MS)readings.delete(k);
  const kept=readings.get(key);
  if(kept&&!fresh)return kept.promise;
  const held={at:now()};
  held.promise=lane.run('operations-steps'+JSON.stringify([key,fresh?held.at:0]),async()=>{
   const started=now();
   const read=await operationsDayRecords(pool,{from,to},{useStore});
   const records=read.records.filter(r=>siteAllowed(scope,r.data.location));
   const masters=await readMasters(scope);
   const scans=withCards?await readScanCards({from,to},scope):{cards:[],scanConnected:null};
   return {all:normalise(records),...masters,...scans,stored:read.stored,live:read.live,readMs:now()-started,reports:new Map()};
  });
  readings.set(key,held);
  while(readings.size>MAX_READINGS)readings.delete(readings.keys().next().value);
  held.promise.catch(()=>{if(readings.get(key)===held)readings.delete(key);});
  return held.promise;
 };
 // One report with one set of filters, built once per reading: Step 1 to Step 4 presses only narrow it.
 const reportOf=(reading,id,filters,monthly)=>{
  const key=JSON.stringify([id,filters,monthly]);
  let built=reading.reports.get(key);
  if(built)return built;
  const effective=effectiveOperationFilters(id,filters),data={assets:reading.assets,shifts:reading.shifts,cards:reading.cards};
  const selected=filterRecords(reading.all,effective);
  const report=buildOperationReport(id,selected,{...data,filters:effective,monthly});
  const items=stepItems(id,{records:selected,cards:reading.cards,report,assets:reading.assets,shifts:reading.shifts});
  const build=opened=>buildOperationReport(id,id==='scans'?selected:opened,{...data,...(id==='scans'?{cards:opened}:{}),filters:effective,monthly});
  built={selected,report,items,build};
  reading.reports.set(key,built);
  while(reading.reports.size>MAX_REPORTS)reading.reports.delete(reading.reports.keys().next().value);
  return built;
 };
 app.get('/api/reports/operations/steps',...protect,async(req,res,next)=>{
  try{
   const q=req.query,id=String(q.id||''),from=String(q.from||''),to=String(q.to||'');
   if(!hasReportSteps(id))return res.status(400).json({error:'This report has no steps.'});
   if(!validDate(from)||!validDate(to)||from<'2026-11-01'||to<from||(Date.parse(to)-Date.parse(from))/86400000>365)return res.status(400).json({error:'Choose a valid date range of at most 366 days.'});
   await ensure();
   const started=now();
   const reading=await readingOf(req,{from,to,withCards:id==='scans',fresh:q.fresh==='1'});
   const filters={from,to,...Object.fromEntries(STEP_FILTER_KEYS.map(k=>[k,String(q[k]||'')])),loading:''};
   const monthly=q.monthly==='1';
   const {selected,report,items,build}=reportOf(reading,id,filters,monthly);
   const slot=String(q.slot||'');
   const levels=stepLevels(id,{items,report,build},{site:String(q.openSite||''),slot:slot?{key:slot,siteKey:String(q.slotSite||'')}:null,category:String(q.category||'')});
   res.set('Cache-Control','no-store');
   res.json({id,range:from+'|'+to,
    totals:{logbooks:selected.length,assets:new Set(selected.map(r=>r.assetId)).size,trips:selected.reduce((s,r)=>s+r.tripsTotal,0),reportRows:report.rows.length},
    note:report.note||'',scanConnected:reading.scanConnected,
    ...(q.options==='1'?{options:operationFilterOptions(reading.all,{cards:reading.cards,assets:reading.assets,shifts:reading.shifts},filters)}:{}),
    levels,stats:{stored:reading.stored,live:reading.live,readMs:reading.readMs,ms:now()-started}});
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error)}
 });
}
