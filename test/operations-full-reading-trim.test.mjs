import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {sendJsonInChunks} from '../server/services/chunked-json.mjs';
import {logBooksForOperations,scanCardsForOperations,OPERATIONS_UNUSED_CARD_FIELDS} from '../server/routes/log-book.mjs';
import {operationReports,normalise,filterRecords,buildOperationReport} from '../src/operations-report-model.mjs';

// 16 Nov 2026: month-to-date of the Operations report was hundreds of MB and froze the live server for 2.6 s.

const scanDetails={hoursSource:{source:'pulse',rows:[{hours:7.5}]},scanMachineSummary:[{equipmentName:'EX9',tripCount:40}],meterCorrectionHistory:[{field:'closingHmr',from:999,to:106}],
 machineSummary:[{equipmentName:'EX9'}],meterRuleErrors:['x'],autoSavedBy:'automatic',autoSavedAt:'2026-12-14T06:00:00.000Z',scanSaveMode:'auto',scanBatchId:'b',siteHolds:[{site:'Site B'}],pulseBreakdowns:[{reference:'BD-1',hours:2}]};
const trip=(equipmentName,extra={})=>({equipmentName,loadingTime:'05:10',unloadingTime:'05:30',durationMinutes:20,gapMinutes:5,equipmentSite:'Site A',originalEquipmentName:equipmentName,handoverLinks:[{row:3}],...extra});
const card=(id,kind,data)=>({id,book_no:(kind==='vehicle'?'VLB_':'ELB_')+id,book_type:kind,data:{bookDate:'2026-12-14',location:id%2?'Site A':'Site B',shiftId:1+(id%2),shiftName:'Shift I',shiftHours:8,
 assetId:100+id,door:'D'+id,employeeId:200+id,employeeName:'SAMPLE DRIVER '+id,caliberId:'CMPL'+id,workOrderContract:'WO-'+(id%3),remark:'r'+id,openingHmr:100,closingHmr:100+id%7,
 openingKmr:1000,closingKmr:1000+id*3,breakdownHours:id%2?1:null,breakdownHoursSource:id%4?'pulse':'manual',hoursWarning:'',masterShiftStart:'05:00',timeMode:'with',...scanDetails,...data}});
const records=[
 card(1,'vehicle',{trips:[trip('EX1',{tripCount:2}),trip('EX2',{completedTrips:3})]}),
 card(2,'vehicle',{completedTrips:7,trips:[trip('EX1',{tripCount:1})]}),
 card(3,'vehicle',{totalTrips:4,trips:[trip('EX2',{tripCount:9})]}),
 card(4,'vehicle',{trips:[]}),
 card(5,'equipment',{}),
 card(6,'vehicle',{trips:[trip('EX3',{tripCount:'2'}),trip('EX3',{completedTrips:null,tripCount:null})],closingHmr:null}),
];
const scanned=[1,2,3].map(n=>({id:'card-'+n,filename:'scan'+n+'.png',status:n===3?'error':'review',error:n===3?'Could not read':null,logbook_id:n===1?1:null,book_no:n===1?'VLB_1':null,kind:'vehicle',
 scanned_date:'2026-12-14',ocr_text:'long text '.repeat(50),raw_fields:{door:'D'+n,box:'x'.repeat(500)},
 draft:{bookDate:n===2?undefined:'2026-12-14',location:'Site A',caliberId:'CMPL'+n,employeeName:'SAMPLE DRIVER '+n,employeeId:200+n,shiftId:2,shiftName:'Shift I',assetId:100+n,door:'D'+n,workOrderContract:'WO-1',
  trips:[trip('EX1')],hoursSource:scanDetails.hoursSource}}));

test('every report of the full reading shows the same rows from the trimmed log books and scanned cards',()=>{
 const trimmed=logBooksForOperations(records),cards=scanCardsForOperations(scanned);
 assert.ok(JSON.stringify(trimmed).length<JSON.stringify(records).length/2,'the trimmed log books are less than half the size');
 assert.ok(JSON.stringify(cards).length<JSON.stringify(scanned).length/4,'the trimmed cards are under a quarter of the size');
 const filters=[{},{site:'Site A'},{shift:'2'},{asset:'101'},{employee:'203'},{workOrder:'WO-1'},{from:'2026-12-14',to:'2026-12-14'}];
 const ids=operationReports.map(r=>r.id).filter(id=>!['timing','loading'].includes(id));
 assert.ok(ids.includes('scans')&&ids.includes('daily')&&ids.includes('breakdown')&&ids.includes('meters'));
 for(const id of ids)for(const f of filters){
  const before=buildOperationReport(id,filterRecords(normalise(records),f),{cards:scanned,assets:[],shifts:[],filters:f});
  const after=buildOperationReport(id,filterRecords(normalise(trimmed),f),{cards,assets:[],shifts:[],filters:f});
  assert.deepEqual(after,before,id+' '+JSON.stringify(f));
 }
 // The filter lists of the screen read these fields of each card's box.
 for(const key of ['location','shiftId','shiftName','assetId','door','employeeId','employeeName','workOrderContract'])assert.equal(cards[0].draft[key],scanned[0].draft[key],key);
 assert.equal(cards[1].draft.bookDate,undefined);assert.equal(cards[1].scanned_date,'2026-12-14');
 assert.ok(!('raw_fields' in cards[0])&&!('ocr_text' in cards[0])&&!('trips' in cards[0].draft));
});

test('the report model reads none of the fields the full reading leaves out',()=>{
 const model=readFileSync(new URL('../src/operations-report-model.mjs',import.meta.url),'utf8');
 for(const field of OPERATIONS_UNUSED_CARD_FIELDS)assert.doesNotMatch(model,new RegExp('\\b'+field+'\\b'),field);
});

const listen=async(t,handler)=>{
 const app=express();app.get('/x',handler);
 const server=await new Promise(resolve=>{const s=app.listen(0,()=>resolve(s));});t.after(()=>server.close());
 return 'http://127.0.0.1:'+server.address().port+'/x';
};

test('the answer in pieces is the same JSON as res.json and lets other work run between the pieces',async t=>{
 const body={records:Array.from({length:1203},(_,i)=>({id:i,text:'ü'+i,date:new Date(Date.UTC(2026,10,16)),gone:undefined})),empty:[],nothing:null,skip:undefined,
  holes:[1,undefined,()=>1,3],nested:{a:[1,2]},label:'Saved "records"',scanConnected:false};
 let ticks=0,timer;
 const url=await listen(t,async(req,res)=>{timer=setInterval(()=>{ticks++;},0);res.set('Cache-Control','no-store');await sendJsonInChunks(res,body,{chunk:100});clearInterval(timer);});
 const response=await fetch(url);const text=await response.text();
 assert.equal(text,JSON.stringify(body));
 assert.match(response.headers.get('content-type'),/application\/json/);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.ok(ticks>=3,'other work ran between the pieces ('+ticks+')');
});

test('the answer in pieces stops when the screen goes away',async t=>{
 let finished=null;
 const url=await listen(t,async(req,res)=>{
  const records=Array.from({length:20000},(_,i)=>({id:i,pad:'x'.repeat(2000)}));
  await sendJsonInChunks(res,{records},{chunk:50});finished=res.writableEnded;
 });
 const controller=new AbortController();
 const response=await fetch(url,{signal:controller.signal});
 const reader=response.body.getReader();await reader.read();controller.abort();
 await new Promise(resolve=>setTimeout(resolve,300));
 assert.notEqual(finished,null,'the writer returned instead of waiting for ever');
});
