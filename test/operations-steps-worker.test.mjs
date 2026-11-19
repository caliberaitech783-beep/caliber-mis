// The step reading's worker thread (19 Nov 2026): on 18 Nov the first opening of 1–18 Nov held the server's main thread
// for 2.3 s while it parsed and built about 70,000 cards. The work now runs in a worker; the main thread stays free.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createStepsEngine,createStepsRunner} from '../server/services/operations-steps-engine.mjs';

const SITES=['Sasti OC','Majri OC','Jayant OC','Dudhichua OC'];
// A reading the size of a few days of every site: stored days as the database's JSON text.
function texts(days=12,perSitePerDay=1500){
 const storedTexts=[];let id=1;
 for(let d=1;d<=days;d++)for(const site of SITES){
  const date='2026-11-'+String(d).padStart(2,'0'),records=[];
  for(let i=0;i<perSitePerDay;i++){const asset=String(1+i%300);records.push({id:id++,book_no:'B'+id,book_type:i%5?'vehicle':'equipment',data:{bookDate:date,location:site,shiftName:['Shift A','Shift B','Shift C'][i%3],shiftId:String(1+i%3),assetId:asset,door:'V'+asset,
   caliberId:'C'+i,employeeName:'SAMPLE '+i,employeeId:'E'+i,workOrderContract:'WO-1',openingKmr:100+i,closingKmr:140+i,openingHmr:10,closingHmr:16+(i%9===0?30:0),shiftHours:8,breakdownHours:0,completedTrips:5}});}
  storedTexts.push(JSON.stringify(records));
 }
 return {storedTexts,liveRows:[],stored:storedTexts.length,live:0};
}
const press={key:'k',id:'meters',filters:{from:'2026-11-01',to:'2026-11-30',site:'',shift:'',asset:'',employee:'',workOrder:'',loading:''},open:{site:'sasti ob'}};
// The longest stretch this thread could not run anything while `work` ran.
async function longestHold(work){
 let last=performance.now(),longest=0;
 const timer=setInterval(()=>{const now=performance.now();longest=Math.max(longest,now-last);last=now;},5);
 try{await work();await new Promise(r=>setTimeout(r,20));}finally{clearInterval(timer);}
 return Math.round(longest);
}

test('a month-sized reading is built without holding this thread, and gives the same answer as building it here',async t=>{
 const input={key:'k',texts:texts(),scope:{sites:null},assets:[],shifts:[]};
 const runner=createStepsRunner();t.after(()=>runner.close());
 let inWorker;
 const workerHold=await longestHold(async()=>{await runner.run('load',input);inWorker=await runner.run('answer',press);});
 const engine=createStepsEngine();let here;
 const hereHold=await longestHold(async()=>{engine.load(input);here=engine.answer(press);});
 assert.notEqual(inWorker.thread,0,'answered by the worker');
 assert.deepEqual({...inWorker,thread:0},{...here,thread:0},'the same lines, totals and notes');
 assert.ok(hereHold>250,'building it here holds this thread ('+hereHold+' ms), so the check below means something');
 assert.ok(workerHold<hereHold/3,'with the worker this thread is held '+workerHold+' ms, not '+hereHold+' ms');
});

test('a worker that cannot start or stops mid-build leaves the work to this thread, and the answer still comes',async()=>{
 const input={key:'k',texts:texts(1,50),scope:{sites:null}};
 const noStart=createStepsRunner({createWorker:async()=>{throw new Error('no threads');},log:{error(){}}});
 await noStart.run('load',input);
 assert.equal((await noStart.run('answer',press)).thread,0);
 // A worker that dies on its first job: the job runs here; its readings are gone, so the next press says missing.
 const dying=createStepsRunner({createWorker:async()=>{const w=new EventEmitter();w.postMessage=()=>setImmediate(()=>w.emit('exit',1));w.terminate=async()=>{};w.unref=()=>{};return w;},log:{error(){}}});
 assert.deepEqual(await dying.run('load',input),{loaded:true,thread:0});
 const after=await dying.run('answer',press);
 assert.ok(after.missing||after.levels,'answered here: either the reading here, or missing so the route reads again');
 assert.equal(dying.status().failures,2,'each stopped worker is counted; after three the work stays on this thread');
});

test('an engine keeps a reading three minutes and then lets it go',()=>{
 let clock=0;const engine=createStepsEngine({now:()=>clock});
 engine.load({key:'k',texts:texts(1,10),scope:{sites:null}});
 assert.ok(engine.answer(press).levels);
 clock+=3*60000+1;
 assert.deepEqual(engine.answer(press),{missing:true});
 assert.equal(engine.held(),0);
});
