// The step reading's work, off the server's main thread (19 Nov 2026). On 18 Nov the first opening of 1–18 Nov parsed and
// built about 70,000 cards on the main thread and held the server for 2.3 s: card saves, auto-saves and every screen
// waited. The engine below does that work and keeps each reading (three minutes, a few at a time) so every press of a
// step only narrows it. It runs in its own worker thread (operations-steps-worker.mjs); the main thread reads the
// database as unparsed text and passes it on. If no worker can run, the same engine runs on the main thread, as before.
import {threadId} from 'node:worker_threads';
import {siteAllowed} from '../../shared/log-book-access.mjs';
import {normalise,filterRecords,reportRecords,buildOperationReport,effectiveOperationFilters,operationFilterOptions} from '../../src/operations-report-model.mjs';
import {stepItems,stepLevels} from '../../src/saved-report-steps-model.mjs';
import {operationsRecordsFromTexts} from './operations-day-store.mjs';

export const STEP_READING_MS=3*60000;
const MAX_READINGS=3,MAX_REPORTS=8;

export function createStepsEngine({now=()=>Date.now(),readingMs=STEP_READING_MS}={}){
 const readings=new Map();
 const prune=()=>{for(const [key,reading] of readings)if(now()-reading.at>readingMs)readings.delete(key);};
 // A reading: the texts read from the database for one date range and one site access, parsed and kept.
 function load({key,texts,scope,assets=[],shifts=[],cards=[],scanConnected=null,stats={}}){
  prune();
  const records=operationsRecordsFromTexts(texts).filter(r=>siteAllowed(scope,r.data.location));
  readings.delete(key);
  readings.set(key,{at:now(),all:normalise(records),assets,shifts,cards,scanConnected,stats,reports:new Map()});
  while(readings.size>MAX_READINGS)readings.delete(readings.keys().next().value);
  return {loaded:true,thread:threadId};
 }
 // One report with one set of filters, built once per reading: Step 1 to Step 4 presses only narrow it.
 function reportOf(reading,id,filters,monthly){
  const key=JSON.stringify([id,filters,monthly]);
  let built=reading.reports.get(key);
  if(built)return built;
  const effective=effectiveOperationFilters(id,filters),data={assets:reading.assets,shifts:reading.shifts,cards:reading.cards};
  const selected=reportRecords(id,filterRecords(reading.all,effective));
  const report=buildOperationReport(id,selected,{...data,filters:effective,monthly});
  const items=stepItems(id,{records:selected,cards:reading.cards,report,assets:reading.assets,shifts:reading.shifts});
  const build=opened=>buildOperationReport(id,id==='scans'?selected:opened,{...data,...(id==='scans'?{cards:opened}:{}),filters:effective,monthly});
  built={selected,report,items,build};
  reading.reports.set(key,built);
  while(reading.reports.size>MAX_REPORTS)reading.reports.delete(reading.reports.keys().next().value);
  return built;
 }
 // The answer to one press: the lines of the open steps, the totals, and the filter choices when asked. A reading that
 // is not held (never loaded, too old, or this thread was restarted) answers {missing:true}: the caller loads it.
 function answer({key,id,filters,monthly=false,open={},options=false}){
  prune();
  const reading=readings.get(key);
  if(!reading)return {missing:true};
  const {selected,report,items,build}=reportOf(reading,id,filters,monthly);
  return {
   totals:{logbooks:selected.length,assets:new Set(selected.map(r=>r.assetId)).size,trips:selected.reduce((s,r)=>s+r.tripsTotal,0),reportRows:report.rows.length},
   note:report.note||'',scanConnected:reading.scanConnected,
   ...(options?{options:operationFilterOptions(reading.all,{cards:reading.cards,assets:reading.assets,shifts:reading.shifts},filters)}:{}),
   levels:stepLevels(id,{items,report,build},open),stats:reading.stats,thread:threadId};
 }
 return {load,answer,prune,held:()=>readings.size};
}

// The main thread's side: one worker thread holding the engine, started on first use. A worker that cannot start or
// stops sends the work to an engine on this thread (the old way), so a report never fails because of the thread; a
// worker that stopped is started again on the next press, up to three times.
const WORKER_URL=new URL('./operations-steps-worker.mjs',import.meta.url);
export function createStepsRunner({createWorker=async()=>{const {Worker}=await import('node:worker_threads');return new Worker(WORKER_URL);},useWorker=process.env.OPERATIONS_STEPS_WORKER!=='0',log=console}={}){
 let worker=null,starting=null,failures=0,local=null,nextId=1;
 const pending=new Map();
 const here=(op,input)=>new Promise((resolve,reject)=>{try{local||=createStepsEngine();resolve(local[op](input));}catch(error){reject(error);}});
 const lost=(which,error)=>{
  if(worker!==which)return;
  worker=null;failures++;
  if(error)log.error?.('Operations step worker stopped:',error?.message||String(error));
  // Work it was doing runs here; its readings are gone, so their next press loads them again.
  for(const [id,job] of pending){pending.delete(id);here(job.op,job.input).then(job.resolve,job.reject);}
 };
 const ready=async()=>{
  if(!useWorker||failures>=3)return null;
  if(worker)return worker;
  starting||=(async()=>{
   try{
    const started=await createWorker();
    started.on('message',({id,result,error,status})=>{const job=pending.get(id);if(!job)return;pending.delete(id);error?job.reject(Object.assign(new Error(error),status?{status}:{})):job.resolve(result);});
    started.on('error',error=>lost(started,error));
    started.on('exit',code=>lost(started,code?new Error('exit code '+code):null));
    // After the listeners (adding one holds the thread again): the worker never keeps the server process alive.
    started.unref?.();
    worker=started;return started;
   }catch(error){failures=3;log.error?.('Operations step worker could not start; building on the main thread:',error?.message||String(error));return null;}
   finally{starting=null;}
  })();
  return starting;
 };
 return {
  async run(op,input){
   const target=await ready();
   if(!target)return here(op,input);
   return new Promise((resolve,reject)=>{
    const id=nextId++;pending.set(id,{op,input,resolve,reject});
    try{target.postMessage({id,op,input});}catch(error){pending.delete(id);here(op,input).then(resolve,reject);}
   });
  },
  status:()=>({worker:Boolean(worker),failures,waiting:pending.size}),
  async close(){const w=worker;worker=null;failures=3;if(w)await w.terminate();},
 };
}
