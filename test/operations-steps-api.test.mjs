// The step reading (owner, 18 Nov 2026, second stage): the server answers each press with the lines of the open steps,
// the same lines the screen used to work out from every card, from one reading kept a few minutes.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerOperationsSteps} from '../server/routes/operations-steps-api.mjs';
import {OPERATIONS_DAY_STORE_SCHEMA,operationsDayStoreSweep} from '../server/services/operations-day-store.mjs';
import {logBooksForOperations} from '../server/routes/log-book.mjs';
import {withVlbTripCounts} from '../shared/vlb-trip-handover.mjs';
import {normalise,filterRecords,buildOperationReport,effectiveOperationFilters,operationFilterOptions} from '../src/operations-report-model.mjs';
import {EVERY,stepItems,stepLevels} from '../src/saved-report-steps-model.mjs';

const SITE='Sasti OC',OTHER='Majri OB',D10='2026-11-10',D11='2026-11-11';
const assets=[{id:'1',door:'V101',site:SITE,group:'TIPPER'},{id:'2',door:'V102',site:SITE,group:'TIPPER'},{id:'3',door:'EX7',site:SITE,group:'EXCAVATOR'},{id:'4',door:'V9',site:OTHER,group:'WATER TANKER'}];
const shifts=[{id:'11',site:SITE,name:'Shift A',shiftCode:'A'},{id:'12',site:SITE,name:'Shift B',shiftCode:'B'},{id:'13',site:SITE,name:'Shift C',shiftCode:'C'},{id:'21',site:OTHER,name:'Shift A',shiftCode:'A'}];
const data=(type,date,asset,site,shift,extra={})=>({bookDate:date,location:site,shiftId:shift.id,shiftName:shift.name,assetId:asset.id,door:asset.door,caliberId:'C'+asset.id,employeeName:'SAMPLE '+asset.id,employeeId:'E'+asset.id,
 workOrderContract:'WO-1',openingKmr:100,closingKmr:140,openingHmr:10,closingHmr:16,shiftHours:8,breakdownHours:0,hoursSource:{big:'x'.repeat(50)},
 trips:type==='vehicle'?[{tripCount:2,loadingTime:'06:00',unloadingTime:'06:40'},{tripCount:1,loadingTime:'07:00'}]:[{tripCount:3}],...extra});

async function setup(t,{scope={sites:null}}={}){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_no TEXT,book_type TEXT NOT NULL,book_date DATE NOT NULL,site TEXT NOT NULL,asset_id BIGINT NOT NULL,
   data JSONB NOT NULL,deleted_at TIMESTAMPTZ,revision INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE mis_vlb_batches(id BIGSERIAL PRIMARY KEY,name TEXT,site TEXT,book_date DATE,shift TEXT,stage TEXT,closed_at TIMESTAMPTZ,closure_revision INTEGER NOT NULL DEFAULT 0,deleted_at TIMESTAMPTZ,archived_at TIMESTAMPTZ);
  CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);`+OPERATIONS_DAY_STORE_SCHEMA);
 for(const s of shifts)await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Shift Master',$1::jsonb)",[JSON.stringify({site:s.site,shiftCode:s.shiftCode,shiftName:s.name})]);
 const rows=[];
 const add=async(type,date,asset,site,shift,extra)=>{const d=data(type,date,asset,site,shift,extra);const r=(await db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id",['B'+(rows.length+1),type,date,site,Number(asset.id),JSON.stringify(d)])).rows[0];rows.push({id:r.id,book_no:'B'+(rows.length+1),book_type:type,data:d});};
 await add('vehicle',D10,assets[0],SITE,shifts[0]);await add('vehicle',D10,assets[1],SITE,shifts[0],{closingHmr:40});await add('equipment',D10,assets[2],SITE,shifts[1]);
 await add('vehicle',D11,assets[0],SITE,shifts[0],{openingHmr:20});await add('vehicle',D10,assets[3],OTHER,shifts[3]);
 for(const shift of ['S1','S2','S3'])await db.query("INSERT INTO mis_vlb_batches(site,book_date,shift,closed_at,closure_revision) VALUES($1,$2,$3,NOW(),1)",[SITE,D10,shift]);
 let masterReads=0;
 const query=(sql,params)=>db.query(sql,params);
 const app=express();
 const runner=registerOperationsSteps(app,{pool:{query},protect:[(req,res,next)=>{req.logBookScope=scope;next();}],
  readMasters:async s=>{masterReads++;return {assets:assets.filter(a=>s.sites===null||s.sites.includes(a.site.toLowerCase())),shifts};},
  readScanCards:async()=>({cards:[{id:9,status:'pending',scanned_date:D10,card_shift:'I',draft:{bookDate:D10,location:SITE,door:'V101'}}],scanConnected:true})});
 app.use((err,req,res,next)=>res.status(500).json({error:err.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}/api/reports/operations/steps?`;
 const get=async params=>{const r=await fetch(base+new URLSearchParams({from:D10,to:D11,...params}));return {status:r.status,body:await r.json(),bytes:Number(r.headers.get('content-length'))};};
 return {db,get,rows,runner,masterReads:()=>masterReads,pool:{connect:async()=>({query,release(){}}),query}};
}
// The lines the screen used to work out itself from every card of the full reading.
function before(id,rows,open,filters={}){
 const all=normalise(logBooksForOperations([...withVlbTripCounts(rows.filter(r=>r.book_type==='vehicle')),...rows.filter(r=>r.book_type!=='vehicle')]));
 const f=effectiveOperationFilters(id,{from:D10,to:D11,site:'',shift:'',asset:'',employee:'',workOrder:'',loading:'',...filters});
 const selected=filterRecords(all,f),report=buildOperationReport(id,selected,{assets,shifts,filters:f,monthly:false});
// What the screen gets is JSON: an empty cell (undefined) arrives as null, which it shows the same way.
 return JSON.parse(JSON.stringify(stepLevels(id,{items:stepItems(id,{records:selected,report,assets,shifts}),report,build:opened=>buildOperationReport(id,opened,{assets,shifts,filters:f,monthly:false})},open)));
}

test('each press gets the same step lines the screen worked out from every card, without reading the dates again',async t=>{
 const {get,rows,masterReads}=await setup(t);
 for(const id of ['daily','vehicle','meters','missing','vehicle-trips']){
  let r=await get({id,options:'1'});
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual(r.body.levels,before(id,rows,{}),id+' Step 1');
  assert.ok(r.body.options.site.length&&r.body.options.asset.length,'the filter choices come with the first answer');
  const site=r.body.levels.sites.rows[0].key;
  r=await get({id,openSite:site});assert.equal(r.body.options,undefined,'not again on a press');
  assert.deepEqual(r.body.levels,before(id,rows,{site}),id+' Step 2');
  const slot=r.body.levels.slots.rows[0];
  r=await get({id,openSite:site,slot:slot.date+'|'+slot.shift});
  assert.deepEqual(r.body.levels,before(id,rows,{site,slot:{key:slot.date+'|'+slot.shift}}),id+' Step 3');
  r=await get({id,openSite:site,slot:slot.date+'|'+slot.shift,category:EVERY});
  assert.deepEqual(r.body.levels,before(id,rows,{site,slot:{key:slot.date+'|'+slot.shift},category:EVERY}),id+' Step 4');
  assert.ok(r.body.levels.table.rows.length>0,id);
 }
 assert.equal(masterReads(),1,'one reading served every report and every press');
 // Over All sites, a box opens one site's date and shift.
 const all=await get({id:'daily',openSite:EVERY,slot:D10+'|Shift A',slotSite:'majri ob',category:EVERY});
 assert.deepEqual(all.body.levels,before('daily',rows,{site:EVERY,slot:{key:D10+'|Shift A',siteKey:'majri ob'},category:EVERY}));
 assert.equal(all.body.totals.logbooks,5);
 // A filter narrows the same reading.
 const filtered=await get({id:'daily',site:OTHER});
 assert.deepEqual(filtered.body.levels.sites.rows.map(r=>r.site),[OTHER]);
 // Refresh reads again.
 await get({id:'daily',fresh:'1'});assert.equal(masterReads(),2);
});

test('the reading is built in a worker thread; when the worker stops, the same answer is built on this thread',async t=>{
 const {get,rows,runner,masterReads}=await setup(t);
 let r=await get({id:'meters',openSite:'sasti ob'});
 assert.equal(r.body.stats.worker,true,'built off the main thread');
 assert.deepEqual(r.body.levels,before('meters',rows,{site:'sasti ob'}));
 await runner.close();
 r=await get({id:'meters',openSite:'sasti ob'});
 assert.equal(r.status,200);assert.equal(r.body.stats.worker,false,'no worker: built here, as before');
 assert.deepEqual(r.body.levels,before('meters',rows,{site:'sasti ob'}),'the same lines');
 assert.equal(masterReads(),2,'the reading the stopped worker held is read again once');
});

test('the step reading uses stored closed days and gives the same answer; Scan Review gets the cards with their batch shift',async t=>{
 const {get,rows,pool}=await setup(t);
 const sweep=operationsDayStoreSweep({pool,now:()=>Date.parse('2026-11-16T10:00:00Z'),log:{error(){}}});
 assert.equal((await sweep.runOnce()).saved,1,'Sasti 10 Nov is locked');
 const r=await get({id:'meters',openSite:'sasti ob',fresh:'1'});
 assert.equal(r.body.stats.stored,1);
 assert.deepEqual(r.body.levels,before('meters',rows,{site:'sasti ob'}));
 const scans=await get({id:'scans',openSite:'sasti ob'});
 assert.equal(scans.body.scanConnected,true);
 assert.deepEqual(scans.body.levels.slots.rows.map(r=>[r.date,r.shift,r.count]),[[D10,'Shift A',1]]);
});

test('the step reading refuses reports without steps and bad dates, and keeps to the caller’s sites',async t=>{
 const {get}=await setup(t,{scope:{sites:['sasti ob']}});
 assert.equal((await get({id:'timing'})).status,400);
 assert.equal((await get({id:'daily',from:'2026-10-31'})).status,400);
 assert.equal((await get({id:'daily',to:'2026-11-09'})).status,400);
 const r=await get({id:'daily',options:'1'});
 assert.deepEqual(r.body.levels.sites.rows.map(r=>r.site),[SITE]);
 assert.ok(!r.body.options.site.some(([v])=>v===OTHER));
});
