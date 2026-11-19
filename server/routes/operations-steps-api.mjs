// The step reading of the Operations reports (owner, 18 Nov 2026, second stage). The twelve step reports used to download
// every card of the dates (121 MB for 1–18 Nov) and work Steps 1–4 out in the browser. The server now works them out with
// the same report code (src/operations-report-model.mjs, src/saved-report-steps-model.mjs) and sends only the lines of the
// steps that are open: a few kilobytes per press.
//
// The cards come from the stored closed days (operations-day-store.mjs) plus a live read of the days not stored. One
// reading of the dates is kept for three minutes per site access, so pressing through the steps, changing a filter or
// switching between the step reports does not read again; Refresh (fresh=1) reads again.
//
// Since 19 Nov 2026 the reading is parsed, built and kept in a worker thread (operations-steps-engine.mjs): this thread
// only reads the database as text and passes it on, so the first opening of a month no longer holds the whole server.
import {hasReportSteps} from '../../src/saved-report-steps-model.mjs';
import {operationsDayTexts,operationsDayStoreEnabled} from '../services/operations-day-store.mjs';
import {createStepsRunner,STEP_READING_MS} from '../services/operations-steps-engine.mjs';

export {STEP_READING_MS};
export const STEP_FILTER_KEYS=['site','shift','asset','employee','workOrder'];
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const directLane={run:(_key,compute)=>compute()};

export function registerOperationsSteps(app,{pool,protect,ensure=async()=>{},lane=directLane,readMasters,readScanCards,useStore=operationsDayStoreEnabled(),now=()=>Date.now(),runner=createStepsRunner()}){
 // A reading being loaded, so that people asking for the same dates and sites at once share one database read.
 const loading=new Map();
 const load=(req,{key,from,to,withCards,fresh})=>{
  if(loading.has(key))return loading.get(key);
  const scope={sites:req.logBookScope?.sites??null};
  const job=lane.run('operations-steps'+JSON.stringify([key,fresh?now():0]),async()=>{
   const started=now();
   const texts=await operationsDayTexts(pool,{from,to},{useStore});
   const masters=await readMasters(req.logBookScope);
   const scans=withCards?await readScanCards({from,to},req.logBookScope):{cards:[],scanConnected:null};
   return runner.run('load',{key,texts,scope,...masters,...scans,stats:{stored:texts.stored,live:texts.live,readMs:now()-started}});
  }).finally(()=>loading.delete(key));
  loading.set(key,job);
  return job;
 };
 app.get('/api/reports/operations/steps',...protect,async(req,res,next)=>{
  try{
   const q=req.query,id=String(q.id||''),from=String(q.from||''),to=String(q.to||'');
   if(!hasReportSteps(id))return res.status(400).json({error:'This report has no steps.'});
   if(!validDate(from)||!validDate(to)||from<'2026-11-01'||to<from||(Date.parse(to)-Date.parse(from))/86400000>365)return res.status(400).json({error:'Choose a valid date range of at most 366 days.'});
   await ensure();
   const started=now(),withCards=id==='scans',fresh=q.fresh==='1';
   const key=JSON.stringify([from,to,req.logBookScope?.sites??null,withCards]);
   const filters={from,to,...Object.fromEntries(STEP_FILTER_KEYS.map(k=>[k,String(q[k]||'')])),loading:''};
   const slot=String(q.slot||'');
   const press={key,id,filters,monthly:q.monthly==='1',options:q.options==='1',open:{site:String(q.openSite||''),slot:slot?{key:slot,siteKey:String(q.slotSite||'')}:null,category:String(q.category||'')}};
   let answer=fresh?{missing:true}:await runner.run('answer',press);
   // Not held (first opening, older than three minutes, Refresh, or a restarted thread): read once, then answer.
   if(answer.missing){await load(req,{key,from,to,withCards,fresh});answer=await runner.run('answer',press);}
   if(answer.missing)throw Object.assign(new Error('The report reading could not be kept. Press Refresh.'),{status:503});
   const {stats,thread,...body}=answer;
   res.set('Cache-Control','no-store');
   res.json({id,range:from+'|'+to,...body,stats:{...stats,ms:now()-started,worker:thread!==0}});
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error)}
 });
 return runner;
}
