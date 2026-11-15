// Visual fingerprints of uploaded scans are worked out on worker threads.
//
// The fingerprint decodes the picture, scales it to 512 pixels and runs several
// pixel loops in JavaScript (about 0.3-1 s of CPU per card). On the server's
// main thread that froze every page and every database reply while a site
// uploaded a stack of cards: the 15 November 2026 load test (8 sites uploading
// 3,000 cards together) saw 95 freezes of 0.3-3.5 s. Workers keep the main
// thread free. If a worker cannot start, the fingerprint runs in-thread as
// before, so an upload never fails because of the pool.
import {Worker} from 'node:worker_threads';
import os from 'node:os';
import {fingerprintScanImage} from './scan-fingerprint.mjs';

const WORKER_URL=new URL('./scan-fingerprint-worker.mjs',import.meta.url);
export function fingerprintWorkerCount(env=process.env,cpus=os.availableParallelism?.()||os.cpus().length||1){
 const configured=Number(env.MIS_SCAN_FINGERPRINT_WORKERS);
 if(Number.isInteger(configured)&&configured>=0&&configured<=8)return configured;
 return Math.max(1,Math.min(2,cpus-1));
}

export function createFingerprintPool({size=fingerprintWorkerCount(),createWorker=()=>new Worker(WORKER_URL),fallback=fingerprintScanImage,idleMs=60000}={}){
 const idle=[],queue=[],all=new Set();let broken=size<1,nextId=1;
 const pending=new Map();
 function spawn(){
  let worker;
  try{worker=createWorker();}catch(error){broken=true;console.error('Scan fingerprint worker could not start; using the main thread:',error?.message||String(error));return null;}
  worker.unref?.();
  const entry={worker,job:null,timer:null};
  worker.on('message',({id,result,error})=>{
   const job=pending.get(id);pending.delete(id);entry.job=null;
   if(job)error?job.reject(Object.assign(Error(error),{fromWorker:true})):job.resolve(result);
   release(entry);
  });
  const lost=error=>{
   all.delete(entry);const index=idle.indexOf(entry);if(index>=0)idle.splice(index,1);clearTimeout(entry.timer);
   if(entry.job){const job=pending.get(entry.job);pending.delete(entry.job);entry.job=null;
    // Same work in this thread: the upload still gets its fingerprint.
    if(job)fallback(job.image).then(job.resolve,job.reject);}
   if(error)console.error('Scan fingerprint worker stopped:',error?.message||String(error));
   drain();
  };
  worker.on('error',lost);worker.on('exit',code=>{if(all.has(entry))lost(code?Error('exit code '+code):null);});
  all.add(entry);return entry;
 }
 function release(entry){
  if(!all.has(entry))return;
  const job=queue.shift();
  if(job){start(entry,job);return;}
  idle.push(entry);clearTimeout(entry.timer);
  // Idle workers close after a minute; the next upload starts one again.
  entry.timer=setTimeout(()=>{const index=idle.indexOf(entry);if(index>=0){idle.splice(index,1);all.delete(entry);void entry.worker.terminate();}},idleMs);
  entry.timer.unref?.();
 }
 function start(entry,job){
  clearTimeout(entry.timer);const id=nextId++;entry.job=id;pending.set(id,job);
  entry.worker.postMessage({id,image:job.image});
 }
 function drain(){
  while(queue.length){
   const entry=idle.pop()||(all.size<size&&!broken?spawn():null);
   if(!entry){if(broken&&!all.size){const job=queue.shift();fallback(job.image).then(job.resolve,job.reject);continue;}return;}
   start(entry,queue.shift());
  }
 }
 return {
  fingerprint(image){
   if(broken&&!all.size)return fallback(image);
   return new Promise((resolve,reject)=>{queue.push({image,resolve,reject});drain();});
  },
  status(){return {workers:all.size,busy:all.size-idle.length,waiting:queue.length,size,inThread:broken&&!all.size};},
  async close(){broken=true;for(const entry of all){clearTimeout(entry.timer);await entry.worker.terminate();}all.clear();idle.length=0;},
 };
}

let shared;
export function fingerprintInWorker(image){shared||=createFingerprintPool();return shared.fingerprint(image);}
export function fingerprintPoolStatus(){return shared?shared.status():{workers:0,busy:0,waiting:0,size:fingerprintWorkerCount(),inThread:false};}
