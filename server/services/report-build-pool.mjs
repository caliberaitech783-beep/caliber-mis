// Heavy report builds run on worker threads.
//
// Manpower by Category for a month of every site (17 Nov 2026, live) built three weeks of about 20,000 cards each on the
// server's main thread: the server stopped answering for up to 6.7 s at a time and card saves and auto-saves waited
// behind it. A worker keeps the main thread free. If a worker cannot start or stops during a build, the build runs
// in-thread as before, so a report never fails because of the pool. A build's own error (a 400 with its message) is passed on.
import {Worker} from 'node:worker_threads';
import os from 'node:os';
import {REPORT_BUILDS} from './report-builds.mjs';

const WORKER_URL=new URL('./report-build-worker.mjs',import.meta.url);
export function reportWorkerCount(env=process.env,cpus=os.availableParallelism?.()||os.cpus().length||1){
 const configured=Number(env.MIS_REPORT_BUILD_WORKERS);
 if(env.MIS_REPORT_BUILD_WORKERS!==undefined&&env.MIS_REPORT_BUILD_WORKERS!==''&&Number.isInteger(configured)&&configured>=0&&configured<=4)return configured;
 return Math.max(1,Math.min(2,cpus-1));
}
const inThread=(task,input)=>new Promise((resolve,reject)=>{try{resolve(REPORT_BUILDS[task](input));}catch(error){reject(error);}});

export function createReportBuildPool({size=reportWorkerCount(),createWorker=()=>new Worker(WORKER_URL),fallback=inThread,idleMs=120000}={}){
 const idle=[],queue=[],all=new Set(),pending=new Map();let broken=size<1,nextId=1;
 function spawn(){
  let worker;
  try{worker=createWorker();}catch(error){broken=true;console.error('Report build worker could not start; using the main thread:',error?.message||String(error));return null;}
  worker.unref?.();
  const entry={worker,job:null,timer:null};
  worker.on('message',({id,result,error,status})=>{
   const job=pending.get(id);pending.delete(id);entry.job=null;
   if(job)error?job.reject(Object.assign(new Error(error),status?{status}:{},{fromWorker:true})):job.resolve(result);
   release(entry);
  });
  const lost=error=>{
   all.delete(entry);const index=idle.indexOf(entry);if(index>=0)idle.splice(index,1);clearTimeout(entry.timer);
   if(entry.job){const job=pending.get(entry.job);pending.delete(entry.job);entry.job=null;
    // The same build in this thread: the report still opens.
    if(job)fallback(job.task,job.input).then(job.resolve,job.reject);}
   if(error)console.error('Report build worker stopped:',error?.message||String(error));
   drain();
  };
  worker.on('error',lost);worker.on('exit',code=>{if(all.has(entry))lost(code?new Error('exit code '+code):null);});
  all.add(entry);return entry;
 }
 function release(entry){
  if(!all.has(entry))return;
  const job=queue.shift();
  if(job){start(entry,job);return;}
  idle.push(entry);clearTimeout(entry.timer);
  // An idle worker closes after two minutes and gives its memory back; the next report starts one again.
  entry.timer=setTimeout(()=>{const index=idle.indexOf(entry);if(index>=0){idle.splice(index,1);all.delete(entry);void entry.worker.terminate();}},idleMs);
  entry.timer.unref?.();
 }
 function start(entry,job){
  clearTimeout(entry.timer);const id=nextId++;entry.job=id;pending.set(id,job);
  try{entry.worker.postMessage({id,task:job.task,input:job.input});}
  catch(error){pending.delete(id);entry.job=null;fallback(job.task,job.input).then(job.resolve,job.reject);release(entry);}
 }
 function drain(){
  while(queue.length){
   const entry=idle.pop()||(all.size<size&&!broken?spawn():null);
   if(!entry){if(broken&&!all.size){const job=queue.shift();fallback(job.task,job.input).then(job.resolve,job.reject);continue;}return;}
   start(entry,queue.shift());
  }
 }
 return {
  run(task,input){
   if(!REPORT_BUILDS[task])return Promise.reject(new Error('Unknown report build '+task));
   if(broken&&!all.size)return fallback(task,input);
   return new Promise((resolve,reject)=>{queue.push({task,input,resolve,reject});drain();});
  },
  status(){return {workers:all.size,busy:all.size-idle.length,waiting:queue.length,size,inThread:broken&&!all.size};},
  // Closing is not a lost worker: each leaves the pool before it is stopped, so no build reruns and nothing is logged.
  async close(){broken=true;const closing=[...all];all.clear();idle.length=0;for(const entry of closing){clearTimeout(entry.timer);await entry.worker.terminate();}},
 };
}

let shared;
export function buildReportInWorker(task,input){shared||=createReportBuildPool();return shared.run(task,input);}
export function reportBuildPoolStatus(){return shared?shared.status():{workers:0,busy:0,waiting:0,size:reportWorkerCount(),inThread:false};}
