import {prepareVlbFixture} from './operational-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import express from 'express';import {PGlite} from '@electric-sql/pglite';import {randomUUID} from 'node:crypto';
import {registerBulkCardScanning} from '../bulk-card-scanning.mjs';import {LOG_BOOK_SCHEMA} from '../log-book.mjs';
import {manualScanIssues} from '../src/scan-manual-fields.mjs';
process.env.VLB_TWO_STAGE_BATCHES='0';

// Card 39 on 2 Nov 2026: the operator picked "TPC50- 05008" from the loading-equipment dropdown and the
// printed summary reads "T 50". With the Equipment Master both name the same machine, so the browser
// showed the card as ready; the server judged without the master and refused it on every trip row.
const valid={doorText:'V321',bookDate:'2026-12-19',location:'Sasti OC',cardShift:'I',assetId:'1',employeeId:'2',shiftId:'3',workOrderId:'5',shiftHours:8,openingHmr:0,closingHmr:6,openingKmr:0,closingKmr:20,aFormNo:'75',timeMode:'with',machineNotationRuleVersion:1,
 trips:[{rowNumber:1,equipmentName:'TPC50- 05008',equipmentId:'6',equipmentSource:'master-selection',loadingTime:'09:02',unloadingTime:'09:09',tripCount:1}],
 scanMachineSummary:[{equipmentName:'T 50',tripCount:1}]};
const masters=[[1,'Equipment master',{category:'Vehicle',door:'V321',currentLocation:'Sasti OC'}],[2,'C-Dir Employee master',{name:'TEST DRIVER',empId:'EMP100'}],[3,'Shift Master',{site:'Sasti OC',shiftName:'Shift I'}],[5,'Work Order master',{site:'Sasti OC',workOrderNo:'WO1'}],[6,'Equipment master',{category:'Equipment',door:'TPC50- 05008',equipmentType:'TPC',equipmentNo:'05008',currentLocation:'Sasti OC'}]];

test('the browser rule set sees the card as complete only when the Equipment Master is supplied',()=>{
 const raw={machineNotation:{version:1}},assets=masters.filter(([,name])=>name==='Equipment master').map(([id,,data])=>({...data,id:String(id),kind:data.category==='Vehicle'?'vehicle':'equipment',site:data.currentLocation}));
 assert.deepEqual(manualScanIssues(valid,'vehicle',raw,{assets,employees:[{id:'2'}],shifts:[{id:'3'}],workOrders:[]}),{});
 assert.ok(manualScanIssues(valid,'vehicle',raw,null).scanMachineSummary,'without the master the names cannot be matched');
});

test('automatic saving judges completeness with the same master lists as the browser',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 for(const [id,name,data]of masters)await db.query('INSERT INTO master_records VALUES($1,$2,$3)',[id,name,JSON.stringify(data)]);
 let tail=Promise.resolve();const query=(q,a)=>q.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!a&&q.includes(';')?db.exec(q):db.query(q,a);
 const pool={query,connect:async()=>{const previous=tail;let done;tail=new Promise(r=>done=r);await previous;return {query,release(){done()}}}};
 const app=express();app.use(express.json());const session=(q,s,n)=>{if(!q.headers.authorization)return s.sendStatus(401);q.session={login:'test-admin'};n()},admin=(q,s,n)=>q.headers.authorization==='admin'?n():s.sendStatus(403);
 const service=registerBulkCardScanning(app,{pool,requireSession:session,requireAdministrator:admin,readHours:async()=>({breakdownHours:0}),ocr:{close(){}},archiveSavedBatch:async()=>({status:'saved'})});await service.start();await prepareVlbFixture(db,valid);t.after(()=>service.stop());app.use((e,q,s,n)=>s.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close()});
 const root='http://127.0.0.1:'+server.address().port,headers={Authorization:'admin','Content-Type':'application/json'};
 const batch=randomUUID();await db.query('INSERT INTO mis_scan_batches(id,kind,name,created_by) VALUES($1,$2,$3,$4)',[batch,'vehicle','Master options test','test-admin']);
 for(const [route,body] of [['/context',{expectedContext:{bookDate:valid.bookDate,location:valid.location,cardShift:valid.cardShift}}],['/validate-context',{action:'proceed'}]]){const checked=await fetch(root+'/api/scan-batches/'+batch+route,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(checked.status,200,await checked.text())}
 const add=async(ordinal,draft)=>{const id=randomUUID();await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,draft,raw_fields,status) VALUES($1,$2,$3,'test.png',$4,$5,$6,$7::jsonb,'review')",[id,batch,ordinal,Buffer.from('retained image'),randomUUID(),JSON.stringify(draft),JSON.stringify({extractionDraft:draft,machineNotation:{version:1}})]);return id};
 const call=async id=>{const r=await fetch(root+'/api/scan-cards/'+id+'/auto-save',{method:'POST',headers,body:JSON.stringify({revision:1})});return {status:r.status,data:await r.json()}};
 const saved=await call(await add(1,valid));
 assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.status,'posted');
 // A genuine conflict is still refused, and each reason is stated once rather than once per trip row.
 const refused=await call(await add(2,{...valid,aFormNo:'76',trips:[valid.trips[0],{...valid.trips[0],rowNumber:2,loadingTime:'09:20',unloadingTime:'09:30'}]}));
 assert.equal(refused.status,409);
 assert.equal(refused.data.error.split('Check the machine assignment against the summary.').length-1,1,refused.data.error);
});
