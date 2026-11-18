// Where a scan entry read spends its time, step by step, for /api/health.
// On 14 Nov 2026 an entry read held its connection for about 9.6 s while the
// same 19 queries ran in milliseconds on a test database, so the slow step had
// to be measured on the live server. Only step names and milliseconds are kept,
// never card or entry details, because /api/health is public.
//
// Saves in the first warmupMs after the server starts run on cold memory (the
// first 4 saves after the 16 Nov 2026 12:57 release took 6 s on average, 13.9 s
// at worst), so stats() also gives afterWarmup: the same figures without them.
// The speed report uses afterWarmup; /api/health keeps showing every save.
export function createEntryReadSteps({keep=40,slowest=3,warmupMs=10*60*1000,clock=()=>performance.now()}={}){
 const reads=[],createdAt=clock();
 const round=ms=>Math.round(ms);
 const summarise=list=>{
  const steps={};
  for(const read of list)for(const [name,ms] of Object.entries(read.steps)){
   const step=steps[name]??={count:0,totalMs:0,maxMs:0};
   step.count+=1;step.totalMs+=ms;step.maxMs=Math.max(step.maxMs,ms);
  }
  const totals=list.map(read=>read.totalMs);
  return {
   reads:list.length,
   // The whole save, all steps: average and slowest of the kept reads (speed report, 16 Nov 2026).
   total:totals.length?{avgMs:round(totals.reduce((sum,ms)=>sum+ms,0)/totals.length),maxMs:round(Math.max(...totals))}:null,
   steps:Object.fromEntries(Object.entries(steps).sort((a,b)=>b[1].totalMs-a[1].totalMs)
    .map(([name,step])=>[name,{avgMs:round(step.totalMs/step.count),maxMs:round(step.maxMs)}])),
   slowest:[...list].sort((a,b)=>b.totalMs-a.totalMs).slice(0,slowest).map(read=>({
    totalMs:round(read.totalMs),cards:read.cards,partial:read.partial,
    ...(Object.keys(read.fillSteps).length?{fillSteps:Object.fromEntries(Object.entries(read.fillSteps).map(([name,ms])=>[name,round(ms)]))}:{}),
    steps:Object.fromEntries(Object.entries(read.steps).filter(([,ms])=>ms>=1).sort((a,b)=>b[1]-a[1]).map(([name,ms])=>[name,round(ms)])),
   })),
  };
 };
 return {
  // start() returns lap(name): it adds the time since the previous lap to that
  // step (a step inside the card loop adds up over every card), and done(extra)
  // records the read with its total.
  start(now=clock){
   const steps={},fillSteps={},began=now();let last=began;
   const warm=began-createdAt>=warmupMs;
   const lap=name=>{const at=now();steps[name]=(steps[name]||0)+(at-last);last=at;};
   // These timings sit inside card-fill and must not advance the main lap clock.
   lap.measureFill=async(name,work)=>{
    const started=now();
    try{return await work();}
    finally{fillSteps[name]=(fillSteps[name]||0)+(now()-started);}
   };
   lap.done=(extra={})=>{
    const totalMs=now()-began;
    reads.push({totalMs,steps,fillSteps,warm,...extra});
    if(reads.length>keep)reads.shift();
   };
   return lap;
  },
  stats(){
   return {...summarise(reads),afterWarmup:{...summarise(reads.filter(read=>read.warm)),warmupMinutes:round(warmupMs/60000),
    // Cold saves still among the kept ones (they drop out as newer saves come in).
    warmupSkipped:reads.filter(read=>!read.warm).length}};
  },
 };
}
