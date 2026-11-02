import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {registerBulkCardScanning} from '../bulk-card-scanning.mjs';
import {LOG_BOOK_SCHEMA} from '../log-book.mjs';
process.env.VLB_TWO_STAGE_BATCHES='0';
const context={bookDate:'2026-11-01',location:'Sasti OC',cardShift:'I'};

// Right-click on a Card status tile rejects every unsaved card in that group so the team can enter them
// by hand. The route must refuse stale or saved cards, skip cards already rejected, and leave the rest
// of the batch untouched.
test('reject-group rejects the listed review cards, skips rejected ones and refuses saved or stale cards',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);CREATE TABLE pulse_master_links(master_name TEXT NOT NULL,source_id TEXT NOT NULL,local_id BIGINT NOT NULL,PRIMARY KEY(master_name,source_id));'+LOG_BOOK_SCHEMA);
 await db.query('INSERT INTO master_records VALUES($1,$2,$3)',[1,'Equipment master',JSON.stringify({category:'Vehicle',door:'V321',currentLocation:'Sasti OC'})]);
 let tail=Promise.resolve();const query=(q,a)=>q.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!a&&q.includes(';')?db.exec(q):db.query(q,a);
 const pool={query,connect:async()=>{const old=tail;let release;tail=new Promise(r=>release=r);await old;return {query,release}}};
 const app=express();app.use(express.json());const auth=(req,res,next)=>{req.session={login:'reviewer'};next()};
 const service=registerBulkCardScanning(app,{pool,requireSession:auth,requireAdministrator:auth,ocr:{recognize:async()=>({text:''}),close(){}}});await service.start();await service.stop();
 app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));const server=app.listen(0);t.after(()=>new Promise(r=>server.close(r)));const root='http://127.0.0.1:'+server.address().port;
 const call=async(path,method='GET',body)=>{const r=await fetch(root+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const batch=(await call('/api/scan-batches','POST',{kind:'vehicle',expectedContext:{...context,confirmed:true}})).data.id;
 const other=(await call('/api/scan-batches','POST',{kind:'vehicle',expectedContext:{...context,confirmed:true}})).data.id;
 const draft={...context,doorText:'V321',assetId:'1',trips:[{equipmentName:'L01',loadingTime:'10:24',unloadingTime:'10:45',tripCount:1}],scanMachineSummary:[{equipmentName:'L01',tripCount:2}]};
 const ids={review:randomUUID(),second:randomUUID(),rejected:randomUUID(),posted:randomUUID(),foreign:randomUUID()};
 const insert=(id,batchId,ordinal,status)=>db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,draft,raw_fields,status) VALUES($1,$2,$3,'card',$4,$5,$6::jsonb,'{}'::jsonb,$7)",[id,batchId,ordinal,Buffer.from('scan'),'hash-'+ordinal,JSON.stringify(draft),status]);
 await insert(ids.review,batch,1,'review');await insert(ids.second,batch,2,'review');await insert(ids.rejected,batch,3,'rejected');await insert(ids.posted,batch,4,'posted');await insert(ids.foreign,other,1,'review');

 assert.equal((await call('/api/scan-batches/'+batch+'/reject-group','POST',{group:'',cards:[]})).status,400);
 assert.equal((await call('/api/scan-batches/'+batch+'/reject-group','POST',{group:'MWS / TED mismatch',cards:[{id:ids.review}]})).status,400,'revision is required');
 const foreign=await call('/api/scan-batches/'+batch+'/reject-group','POST',{group:'MWS / TED mismatch',cards:[{id:ids.foreign,revision:1}]});
 assert.equal(foreign.status,409);assert.match(foreign.data.error,/not in this batch/);
 const saved=await call('/api/scan-batches/'+batch+'/reject-group','POST',{group:'MWS / TED mismatch',cards:[{id:ids.posted,revision:1}]});
 assert.equal(saved.status,409);assert.match(saved.data.error,/already saved/);
 const stale=await call('/api/scan-batches/'+batch+'/reject-group','POST',{group:'MWS / TED mismatch',cards:[{id:ids.review,revision:7}]});
 assert.equal(stale.status,409);assert.match(stale.data.error,/changed/);
 assert.equal((await db.query("SELECT count(*) AS n FROM mis_scan_cards WHERE status='rejected'")).rows[0].n,1,'a refused request rejects nothing');

 const done=await call('/api/scan-batches/'+batch+'/reject-group','POST',{group:'MWS / TED mismatch',cards:[{id:ids.review,revision:1},{id:ids.rejected,revision:1}]});
 assert.equal(done.status,200,JSON.stringify(done.data));
 assert.deepEqual(done.data,{rejected:1,remaining:1},'the already-rejected card is skipped; the second review card still remains');
 const rows=Object.fromEntries((await db.query('SELECT id,status,revision,review_note,checked_by FROM mis_scan_cards')).rows.map(row=>[row.id,row]));
 assert.equal(rows[ids.review].status,'rejected');assert.equal(rows[ids.review].revision,2);assert.equal(rows[ids.review].checked_by,'reviewer');
 assert.equal(rows[ids.review].review_note,'Rejected with group "MWS / TED mismatch" for manual entry');
 assert.equal(rows[ids.second].status,'review');assert.equal(rows[ids.second].revision,1,'cards outside the request are untouched');
 assert.equal(rows[ids.posted].status,'posted');assert.equal(rows[ids.foreign].status,'review');
 const batchCards=(await call('/api/scan-batches/'+batch)).data.cards;
 assert.equal(batchCards.find(c=>c.id===ids.review).status,'rejected');
});
