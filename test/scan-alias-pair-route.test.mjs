import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {registerBulkCardScanning} from '../bulk-card-scanning.mjs';
import {LOG_BOOK_SCHEMA} from '../log-book.mjs';
process.env.VLB_TWO_STAGE_BATCHES='0';
delete process.env.EQUIPMENT_ALIAS_OTP;
const context={bookDate:'2026-11-01',location:'Sasti OC',cardShift:'I'};

// The mismatch box pairs a written machine (body L21) with the Pulse record no door matches
// (DEMO21-00179). The route must accept a numeric master id and apply the pair to every
// unsaved row written that way.
test('apply-pair accepts a numeric equipment id, rewrites the written rows and clears the mismatch',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);CREATE TABLE pulse_master_links(master_name TEXT NOT NULL,source_id TEXT NOT NULL,local_id BIGINT NOT NULL,PRIMARY KEY(master_name,source_id));'+LOG_BOOK_SCHEMA);
 for(const [id,data] of [[1,{category:'Vehicle',door:'V321',currentLocation:'Sasti OC'}],[2,{category:'Equipment',door:'DEMO21-00179',currentLocation:'Sasti OC'}],[3,{category:'Equipment',door:'VPC131',currentLocation:'Sasti OC'}]])await db.query('INSERT INTO master_records VALUES($1,$2,$3)',[id,'Equipment master',JSON.stringify(data)]);
 let tail=Promise.resolve();const query=(q,a)=>q.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!a&&q.includes(';')?db.exec(q):db.query(q,a);
 const pool={query,connect:async()=>{const old=tail;let release;tail=new Promise(r=>release=r);await old;return {query,release}}};
 const app=express();app.use(express.json());const auth=(req,res,next)=>{req.session={login:'reviewer'};next()};
 const service=registerBulkCardScanning(app,{pool,requireSession:auth,requireAdministrator:auth,ocr:{recognize:async()=>({text:''}),close(){}}});await service.start();await service.stop();
 app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));const server=app.listen(0);t.after(()=>new Promise(r=>server.close(r)));const root='http://127.0.0.1:'+server.address().port;
 const call=async(path,method='GET',body)=>{const r=await fetch(root+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const batch=(await call('/api/scan-batches','POST',{kind:'vehicle',expectedContext:{...context,confirmed:true}})).data.id;
 const draft={...context,doorText:'V321',assetId:'1',machineNotationRuleVersion:1,tripBodyRuleVersion:2,trips:[{equipmentName:'VPC131',loadingTime:'10:24',unloadingTime:'10:45',tripCount:1},{equipmentName:'L21',loadingTime:'12:01',unloadingTime:'12:18',tripCount:1}],scanMachineSummary:[{equipmentName:'L21',tripCount:1}]};
 const card=randomUUID();
 await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,draft,raw_fields,status) VALUES($1,$2,1,'card 1',$3,$4,$5::jsonb,$6::jsonb,'review')",[card,batch,Buffer.from('scan'),'hash-1',JSON.stringify(draft),JSON.stringify({extractionDraft:draft,door:'V321'})]);

 const before=await call('/api/scan-batches/'+batch+'/mismatches');
 assert.equal(before.status,200,JSON.stringify(before.data));
 const body=before.data.categories.find(c=>c.id==='body');
 assert.equal(body.right.length,1);assert.equal(body.right[0].written,'L21');assert.equal(body.right[0].rows,2);assert.equal(body.right[0].cards,1);
 assert.ok(body.left.some(a=>a.id==='2'),'DEMO21-00179 is the Pulse record no card names');
 assert.equal(body.right[0].suggestions[0],'2','the closest number is suggested first');
 assert.equal(before.data.current.pair.key,'LPC21');

 assert.equal((await call('/api/scan-batches/'+batch+'/apply-pair','POST',{kind:'equipment',writtenKey:'LPC21',writtenText:'L21',equipmentId:'abc'})).status,400);
 const paired=await call('/api/scan-batches/'+batch+'/apply-pair','POST',{kind:'equipment',writtenKey:'LPC21',writtenText:'L21',equipmentId:'2'});
 assert.equal(paired.status,200,JSON.stringify(paired.data));
 assert.deepEqual(paired.data.applied,{rows:2,cards:1});
 assert.equal(paired.data.alias.status,'active','with the OTP rule off the alias is active at once');
 assert.equal(paired.data.otpRequired,false);

 const saved=(await db.query('SELECT draft,revision FROM mis_scan_cards WHERE id=$1',[card])).rows[0];
 assert.equal(saved.revision,2);
 assert.equal(saved.draft.trips[1].equipmentId,'2');assert.equal(saved.draft.trips[1].equipmentSource,'master-selection');assert.equal(saved.draft.trips[1].originalEquipmentName,'L21');
 assert.equal(saved.draft.trips[0].equipmentName,'VPC131','matching rows are untouched');
 assert.equal(saved.draft.scanMachineSummary[0].equipmentNotation.original,'L21');

 const after=await call('/api/scan-batches/'+batch+'/mismatches');
 assert.equal(after.data.pending,0);assert.equal(after.data.current,null);
});
