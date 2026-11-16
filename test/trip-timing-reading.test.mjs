import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {transformWithOxc} from 'vite';
import path from 'node:path';
import {registerLogBooks,LOG_BOOK_SCHEMA,logBooksForTiming,TIMING_UNUSED_CARD_FIELDS,TIMING_UNUSED_TRIP_FIELDS,OPERATIONS_UNUSED_CARD_FIELDS} from '../server/routes/log-book.mjs';
import {encodeScanJson} from '../server/rules/scan-text-storage.mjs';
import {createReportLane} from '../server/services/report-lane.mjs';
import {normalise,buildOperationReport} from '../src/operations-report-model.mjs';
import * as tripTiming from '../shared/trip-timing-report.mjs';
import * as loadingReport from '../shared/loading-machine-report.mjs';
process.env.VLB_TWO_STAGE_BATCHES='0';

// Trip Timing & Gap took 59 s on average on 14 Nov 2026 (longest 113 s): it read a month of cards plus every scanned card,
// and each person opening it read it again. It now leaves out the scanned cards it never shows, and goes through the
// report lane, so people asking for the same dates and sites at the same time share one reading.
async function server(t,lane,extra={}){
 const db=new PGlite();t.after(()=>db.close());await db.exec(LOG_BOOK_SCHEMA);
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB); CREATE TABLE mis_scan_batches(id TEXT PRIMARY KEY,kind TEXT); CREATE TABLE mis_scan_cards(id TEXT,batch_id TEXT,filename TEXT,status TEXT,draft JSONB,error TEXT,logbook_id BIGINT,created_at TIMESTAMPTZ,ordinal INTEGER)');
 const data={bookDate:'2026-11-12',location:'Sasti',door:'V1',assetId:1,shiftId:3,employeeId:2,shiftHours:8,openingHmr:0,closingHmr:6,trips:[],...extra};
 await db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,request_key,created_by) SELECT 'BOOK-'||n,'vehicle','2026-11-12','Sasti',1,$1,md5(n::text)::uuid,'fixture' FROM generate_series(1,3) AS n",[JSON.stringify(data)]);
 await db.exec("INSERT INTO mis_scan_batches VALUES('batch','vehicle')");
 await db.query("INSERT INTO mis_scan_cards VALUES('card','batch','scan.png','review',$1,NULL,NULL,'2026-11-12',1)",[JSON.stringify(encodeScanJson({bookDate:'2026-11-12',location:'Sasti'}))]);
 // Every statement the route sends, so a test can count the readings and see which tables they touch.
 const statements=[];let hold=null;
 const query=async(sql,args)=>{statements.push(sql);if(hold&&/FROM mis_log_books WHERE deleted_at IS NULL AND book_date/.test(sql))await hold;return !args&&sql.includes(';')?db.exec(sql):db.query(sql,args);};
 const app=express();
 registerLogBooks(app,{pool:{query},lane,
  requireSession:(req,res,next)=>{req.session={role:'super',permissions:{adminLevel:'Admin',separateMisCredentials:Boolean(req.headers['x-site'])},...(req.headers['x-site']?{site:req.headers['x-site']}:{})};next();},
  requireAdministrator:(req,res,next)=>next()});
 app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const listener=app.listen(0,'127.0.0.1');await new Promise(r=>listener.on('listening',r));t.after(()=>{listener.closeAllConnections();listener.close();});
 const url=`http://127.0.0.1:${listener.address().port}/api/reports/operations?from=2026-11-01&to=2026-11-14`;
 return {statements,url,
  holdReadings(){let release;hold=new Promise(r=>{release=r;});return ()=>{hold=null;release();};},
  get:async(extra='',headers={})=>{const response=await fetch(url+extra,{headers:{Authorization:'admin',...headers}});return {status:response.status,body:await response.json()};}};
}
const readings=statements=>statements.filter(sql=>/FROM mis_log_books WHERE deleted_at IS NULL AND book_date/.test(sql)).length;
const scanReads=statements=>statements.filter(sql=>/mis_scan_cards/.test(sql)).length;

test('Trip Timing and Loading Equipment-wise read the log books without the scanned cards',async t=>{
 const app=await server(t,createReportLane({cacheMs:0}));
 const full=await app.get();
 assert.equal(full.status,200,JSON.stringify(full.body));
 assert.equal(full.body.records.length,3);assert.equal(full.body.cards.length,1);assert.equal(full.body.scanConnected,true);
 assert.ok(scanReads(app.statements)>0,'the Scans report and the other reports still read the scanned cards');
 app.statements.length=0;
 const logbooks=await app.get('&parts=logbooks');
 assert.equal(logbooks.status,200,JSON.stringify(logbooks.body));
 assert.equal(logbooks.body.records.length,3,'the same log books');
 assert.deepEqual(logbooks.body.cards,[]);
 assert.equal(logbooks.body.scanConnected,null,'not read, which is not the same as not connected');
 assert.deepEqual([logbooks.body.batches,logbooks.body.fleet],[full.body.batches,full.body.fleet],'Loading Equipment-wise keeps its batches and machines');
 assert.equal(scanReads(app.statements),0,'no statement touches the scanned cards');
 app.statements.length=0;
 const unknown=await app.get('&parts=everything');
 assert.equal(unknown.body.cards.length,1,'any other value reads everything, as before');
});

test('people asking for the same dates and sites at the same time share one reading; other site access reads its own',async t=>{
 const app=await server(t,createReportLane({cacheMs:0}));
 const release=app.holdReadings();
 const asked=[app.get('&parts=logbooks'),app.get('&parts=logbooks'),app.get('&parts=logbooks')];
 const otherSite=app.get('&parts=logbooks',{'x-site':'Other'});
 await new Promise(r=>setTimeout(r,150));
 release();
 const [first,second,third]=await Promise.all(asked),elsewhere=await otherSite;
 for(const answer of [first,second,third])assert.equal(answer.status,200,JSON.stringify(answer.body));
 assert.deepEqual(second.body,first.body);assert.deepEqual(third.body,first.body);
 assert.equal(readings(app.statements),2,'one reading for the three people with all sites, one for the site login');
 assert.equal(elsewhere.body.records.length,0,'a site login never receives the reading of another site access');
});

test('the shared reading is kept for the lane\'s short window only',async t=>{
 let clock=1_000_000;
 const app=await server(t,createReportLane({cacheMs:15000,now:()=>clock}));
 await app.get('&parts=logbooks');await app.get('&parts=logbooks');
 assert.equal(readings(app.statements),1,'within 15 s the finished reading is reused');
 clock+=15001;await app.get('&parts=logbooks');
 assert.equal(readings(app.statements),2,'after 15 s it is read again');
 await app.get();
 assert.equal(readings(app.statements),3,'the full reading with scanned cards is a reading of its own');
});

test('the screens ask for the log books only for Trip Timing and Loading Equipment-wise, each kind of reading held apart',async()=>{
 const source=fs.readFileSync(new URL('../src/operations-reports.jsx',import.meta.url),'utf8');
 assert.match(source,/const OPERATIONS_LOGBOOKS_ONLY=new Set\(\['timing','loading'\]\);/);
 assert.match(source,/const parts=OPERATIONS_LOGBOOKS_ONLY\.has\(id\)\?'logbooks':'';/);
 assert.match(source,/operationsData\(filters\.from,filters\.to,session\.token,reload>0,parts\)/);
 assert.match(source,/\},\[filters\.from,filters\.to,session\.token,reload,valid,parts\]\);/,'moving from Trip Timing to the Scans report reads the scanned cards');
 assert.match(source,/id==='scans'&&data\.scanConnected===false&&/,'a reading without scanned cards does not say the scan source is down');
 const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function'),'operations-reports.jsx',{jsx:{runtime:'classic'}});
 const urls=[];
 const fetch=url=>{urls.push(String(url));return Promise.resolve({ok:true,json:async()=>({records:[],url:String(url)})});};
 const operationsData=new Function('fetch',code+';return operationsData')(fetch);
 const timing=operationsData('2026-11-01','2026-11-14','token',false,'logbooks'),loading=operationsData('2026-11-01','2026-11-14','token',false,'logbooks');
 assert.deepEqual(urls,['/api/reports/operations?from=2026-11-01&to=2026-11-14&parts=logbooks'],'the dashboard\'s two reports still share one reading');
 assert.equal(timing.promise,loading.promise);
 const daily=operationsData('2026-11-01','2026-11-14','token',false);
 assert.equal(urls.at(-1),'/api/reports/operations?from=2026-11-01&to=2026-11-14','other reports read everything');
 assert.equal(urls.length,2,'a reading without scanned cards cannot serve them');
 await daily.promise;
 const other=operationsData('2026-11-02','2026-11-14','token',false);await other.promise;
 const reuse=operationsData('2026-11-02','2026-11-14','token',false,'logbooks');
 assert.equal(urls.length,4,'since 16 Nov 2026 the full reading keeps only trip counts, so it cannot serve Trip Timing');
 assert.notEqual(reuse.promise,other.promise);
 assert.equal(urls.at(-1),'/api/reports/operations?from=2026-11-02&to=2026-11-14&parts=logbooks');
 const refreshed=operationsData('2026-11-02','2026-11-14','token',true,'logbooks');
 assert.equal(urls.at(-1),'/api/reports/operations?from=2026-11-02&to=2026-11-14&parts=logbooks','Refresh reads again, without the scanned cards');
 for(const reading of [timing,loading,daily,other,reuse,refreshed])reading.release();
});

// The scan and entry details of a saved card: on 5 Nov 2026 they were 7.4 of the 18 MB of a day's reading. Each value here
// differs from what the reports work out, so a report that started reading one of them would change its figures.
const scanDetails={hoursSource:{source:'pulse',rows:[{hours:7.5,from:'05:00',to:'12:30'}]},scanMachineSummary:[{equipmentName:'EX9',tripCount:40}],
 meterCorrectionHistory:[{field:'closingHmr',from:999,to:106}],machineSummary:[{equipmentName:'EX9',tripCount:40}],meterRuleErrors:['Closing HMR below opening'],
 autoSavedBy:'automatic',autoSavedAt:'2026-12-14T06:00:00.000Z',scanSaveMode:'auto',scanBatchId:'batch-1',siteHolds:[{site:'Site B'}]};
const handover={handoverLinks:[{card:'VLB_S9',row:24,equipmentName:'EX9'}]};

test('the log-books-only reading leaves out the scan and entry details and keeps everything else',async t=>{
 const trips=[{equipmentName:'EX1',loadingTime:'05:10',unloadingTime:'05:30',tripCount:1,...handover}];
 const saved={...scanDetails,scanCardId:'card',statusReason:'Kept for Loading',pulseBreakdowns:[{reference:'BD-1'}],trips};
 const app=await server(t,createReportLane({cacheMs:0}),saved);
 const full=(await app.get()).body.records[0],slim=(await app.get('&parts=logbooks')).body.records[0];
 const without=(row,fields)=>Object.fromEntries(Object.entries(row).filter(([key])=>!fields.includes(key)));
 for(const field of TIMING_UNUSED_CARD_FIELDS)assert.ok(!(field in slim.data),field+' is left out');
 assert.ok(!('handoverLinks' in slim.data.trips[0]));
 assert.deepEqual(without(slim.data,['trips']),{...without(full.data,['trips']),...without(saved,[...TIMING_UNUSED_CARD_FIELDS,'trips'])},'every other field, including scanCardId, statusReason and pulseBreakdowns, is kept');
 assert.deepEqual(slim.data.trips.map(trip=>without(trip,['completedTrips','tripStatus'])),trips.map(trip=>without(trip,TIMING_UNUSED_TRIP_FIELDS)));
 // The full reading (16 Nov 2026): the same details and the copied breakdowns left out, trip rows down to their counts.
 for(const field of OPERATIONS_UNUSED_CARD_FIELDS)assert.ok(!(field in full.data),field+' is left out of the full reading');
 assert.equal(full.data.scanCardId,'card');assert.equal(full.data.statusReason,'Kept for Loading');
 assert.deepEqual(full.data.trips,slim.data.trips.map(({completedTrips,tripCount})=>({completedTrips,tripCount})));
});

test('Trip Timing & Gap and Loading Equipment-wise show the same figures from the trimmed reading',()=>{
 const trip=(equipmentName,loadingTime,unloadingTime,extra={})=>({equipmentName,loadingTime,unloadingTime,tripCount:1,...handover,...extra});
 const shift={shiftId:1,shiftName:'Shift I',shiftHours:8,masterShiftStart:'05:00',bookShiftCode:'S1'};
 const vlb=(id,door,trips,extra={})=>({id,book_no:'VLB_S'+id,book_type:'vehicle',data:{bookDate:'2026-12-14',location:'Site A',assetId:id,door,employeeName:'SAMPLE DRIVER 0'+id,caliberId:'CMPL9000'+id,timeMode:'with',trips,...shift,...scanDetails,...extra}});
 const elb=(id,assetId,door,extra={})=>({id,book_no:'ELB'+id,book_type:'equipment',data:{bookDate:'2026-12-14',location:'Site A',assetId,door,assetName:'SAMPLE EXCAVATOR',employeeName:'SAMPLE OPERATOR '+id,openingHmr:100,closingHmr:106,breakdownHours:0,trips:[],...shift,...scanDetails,...extra}});
 const raw=[
  vlb(1,'V9001',[trip('EX1','05:10','05:30'),trip('EX1','05:22','05:40'),trip('EX2','05:52','06:40')]),
  vlb(2,'V9002',[trip('EX1','05:14','05:31'),trip('EX1','05:34','06:20'),trip('EX1','06:40','07:10'),trip('EX1','','07:25')]),
  vlb(3,'V9003',[trip('EX2','05:20','05:50',{completedTrips:2}),trip('EX2','06:30','07:00')],{shiftId:3,shiftName:'Shift III',masterShiftStart:'21:00',bookShiftCode:'S3'}),
  elb(11,101,'EX1'),elb(12,102,'EX2',{closingHmr:104,breakdownHours:2,shiftStatus:'working_partial_breakdown',statusReason:'Hose',pulseBreakdowns:[{reference:'BD-1',description:'Hose',start:'2026-12-14T00:30:00.000Z',end:'2026-12-14T02:30:00.000Z'}]})];
 const assets=[{id:'101',door:'EX1',site:'Site A',kind:'equipment',group:'Excavator',name:'SAMPLE EXCAVATOR'},{id:'102',door:'EX2',site:'Site A',kind:'equipment',group:'Excavator',name:'SAMPLE EXCAVATOR'}];
 const figures=records=>{
  const rows=normalise(records),entries=tripTiming.tripEntries(rows),machines=loadingReport.machineShifts(rows,{assets});
  return {
   entries,timing:Object.keys(tripTiming.MODES).flatMap(mode=>['site','shift',...Object.keys(tripTiming.GROUPS)].map(group=>tripTiming.summarise(entries,mode,group))),
   delayed:Object.keys(tripTiming.MODES).map(mode=>tripTiming.delayedEntries(entries,mode)),
   loading:['site','shift','machine'].map(group=>loadingReport.summarise(machines,group)),
   lines:loadingReport.loadingLines(machines),timelines:machines.map(entry=>loadingReport.shiftTimeline(entry)),notWorked:loadingReport.shiftsNotWorked(machines),
   tables:['timing','loading'].map(id=>buildOperationReport(id,rows,{assets}).rows)};
 };
 const before=figures(raw),after=figures(logBooksForTiming(raw));
 assert.ok(before.timing[0].rows.length>0&&before.loading[0].rows.length>0&&before.tables[0].length>0,'the fixture produces figures to compare');
 assert.deepEqual(after,before);
 assert.ok(JSON.stringify(logBooksForTiming(raw)).length<JSON.stringify(raw).length*0.75,'the trimmed reading is much smaller');
 assert.equal(raw[0].data.hoursSource.source,'pulse','the cards it was given are not changed');
});

test('no file behind Trip Timing & Gap or Loading Equipment-wise reads a field the trimmed reading leaves out',()=>{
 // Every module the two report screens and the report model load, followed through their imports, plus the screen that
 // hands them the reading. A new import is followed automatically; a field read anywhere in them fails this test.
 const root=new URL('..',import.meta.url),files=new Set(),queue=['src/trip-timing-report.jsx','src/loading-machine-report.jsx','src/operations-report-model.mjs'];
 while(queue.length){
  const file=queue.shift();if(files.has(file))continue;files.add(file);
  const source=fs.readFileSync(new URL(file,root),'utf8');
  for(const [,spec] of source.matchAll(/^import\s[^'"]*['"](\.{1,2}\/[^'"]+\.(?:mjs|jsx|js))['"]/gm))queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file),spec)));
 }
 files.add('src/operations-reports.jsx');
 assert.ok(files.has('shared/trip-card-rules.mjs')&&files.has('shared/scan-machine-rules.mjs'),'imports are followed');
 // Scan review functions that rewrite or check a scan draft's machine rows. Their files are loaded for door matching
 // (Loading Equipment-wise: fleetDoorKey -> identifyCardMachine), but nothing behind the reports calls these functions.
 const scanDraftOnly=new Set(['correctMatchingTripEquipment','normalizeScanEquipmentRows','scanEquipmentMatchIssues','validateTripEquipment']);
 const lines=Object.fromEntries([...files].map(file=>[file,fs.readFileSync(new URL(file,root),'utf8').split(/\r?\n/)]));
 const enclosing=(file,index)=>{for(let i=index;i>=0;i--){const found=lines[file][i].match(/^(?:export\s+)?function\s+(\w+)/);if(found)return found[1];}return '';};
 for(const name of scanDraftOnly)for(const file of files)lines[file].forEach((line,index)=>{
  if(new RegExp('(?<!function\\s)\\b'+name+'\\(').test(line))assert.ok(scanDraftOnly.has(enclosing(file,index)),`${file}:${index+1} calls ${name}, which reads scan details the trimmed reading leaves out`);
 });
 for(const field of [...TIMING_UNUSED_CARD_FIELDS,...TIMING_UNUSED_TRIP_FIELDS]){
  // A function of the same name (trip-card-rules has machineSummary(trips)) is not a field.
  const read=new RegExp('(?<!function\\s)\\b'+field+'\\b(?!\\s*\\()');
  const readers=[...files].flatMap(file=>lines[file].map((line,index)=>read.test(line)&&!scanDraftOnly.has(enclosing(file,index))?file+':'+(index+1):'').filter(Boolean));
  assert.deepEqual(readers,[],field+' is read by the reports, so it must stay in the log-books-only reading');
 }
});
