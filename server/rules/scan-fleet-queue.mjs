// Fleet verification must not occupy OCR workers or start an unbounded set of
// remote requests. A key remains reserved while queued and while running.
export function createScanFleetQueue({concurrency=2,maxPending=100,onError=()=>{}}={}){
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>2)throw Error('Fleet verification concurrency must be between 1 and 2.');
 if(!Number.isInteger(maxPending)||maxPending<concurrency||maxPending>100)throw Error('Fleet verification pending limit must be between concurrency and 100.');
 let stopped=false;const waiting=[],keys=new Set(),running=new Set();
 function drain(){
  while(!stopped&&running.size<concurrency&&waiting.length){
   const job=waiting.shift();let task;
   task=Promise.resolve().then(()=>{if(!stopped)return job.work();}).catch(async error=>{
    // Reporting failures must not produce unhandled background rejections.
    try{await onError(error);}catch{}
   }).finally(()=>{running.delete(task);keys.delete(job.key);drain();});
   running.add(task);
  }
 }
 return {
  queue(key,work){
   // A later batch read reschedules pending verification; save checks also
   // verify directly. Do not retain unlimited card metadata during an outage.
   if(stopped||keys.has(key)||keys.size>=maxPending)return false;
   if(typeof work!=='function')throw TypeError('Fleet verification work must be a function.');
   keys.add(key);waiting.push({key,work});drain();return true;
  },
  async stop(){
   stopped=true;for(const job of waiting)keys.delete(job.key);waiting.length=0;
   await Promise.all(running);
  }
 };
}
