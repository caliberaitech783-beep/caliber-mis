// Heavy reports (Batch Status, Manpower / OT) read every saved card in their range plus the whole
// Equipment and Employee masters, and hold a database connection while they do it. The pool has 10
// connections, and the dashboard opens two of these reports for every user. Without a limit a few
// people opening MIS fill the pool, and sign-in, card saves and every page queue behind reports.
//
// The lane keeps reports to a few connections, lets identical requests (same report, same filters,
// same site access) share one read, and reuses a finished result for a few seconds, which covers
// everyone reloading at once after a release.
export function createReportLane({slots=3,cacheMs=15_000,maxCached=200,now=()=>Date.now()}={}){
 let active=0,served=0,shared=0,cached=0;
 const queue=[],inflight=new Map(),results=new Map();
 const acquire=()=>{if(active<slots){active++;return Promise.resolve();}return new Promise(resolve=>queue.push(resolve));};
 const release=()=>{const next=queue.shift();if(next)next();else active--;};
 const remember=(key,value)=>{
  if(cacheMs<=0)return;
  const time=now();
  for(const [k,entry] of results)if(entry.until<=time)results.delete(k);
  while(results.size>=maxCached)results.delete(results.keys().next().value);
  results.set(key,{value,until:time+cacheMs});
 };
 async function run(key,compute){
  const hit=results.get(key);
  if(hit&&hit.until>now()){cached++;return hit.value;}
  const running=inflight.get(key);
  if(running){shared++;return running;}
  const job=(async()=>{
   await acquire();
   try{const value=await compute();served++;remember(key,value);return value;}
   finally{release();}
  })();
  inflight.set(key,job);
  try{return await job;}finally{if(inflight.get(key)===job)inflight.delete(key);}
 }
 return {run,stats:()=>({slots,active,waiting:queue.length,served,shared,cached})};
}

// Every report request is keyed by its path, its filters and the caller's site access, so two
// people only share a result when they would have been shown exactly the same report.
export const reportKey=(path,req,extra={})=>JSON.stringify([path,req.query||{},req.logBookScope?.sites??null,extra]);

const configuredSlots=Number(process.env.REPORT_DB_SLOTS);
export const reportLane=createReportLane({slots:Number.isInteger(configuredSlots)&&configuredSlots>0?configuredSlots:3});
// Tests and callers that pass no lane get the old behaviour: no limit, no sharing.
export const directLane={run:(_key,compute)=>compute(),stats:()=>null};
