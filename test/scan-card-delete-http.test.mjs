import {enforceContentDeletionPolicy} from '../content-deletion-policy.mjs';
import {prepareVlbFixture} from './operational-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {PGlite} from '@electric-sql/pglite';import {randomUUID} from 'node:crypto';
import {registerBulkCardScanning} from '../bulk-card-scanning.mjs';import {LOG_BOOK_SCHEMA} from '../log-book.mjs';
import {remainingScanCards,scanReviewPosition} from '../src/scan-review-queue.mjs';

process.env.VLB_TWO_STAGE_BATCHES='0'; // legacy single-step batch expectations
test('Delete card works directly without approval or OTP and preserves other cards',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 for(const [id,name,data]of [[1,'Equipment master',{category:'Vehicle',door:'V321',currentLocation:'Sasti OC'}],[2,'C-Dir Employee master',{name:'TEST DRIVER',empId:'EMP100'}],[3,'Shift Master',{site:'Sasti OC',shiftName:'Shift I'}],[4,'Equipment master',{category:'Equipment',door:'E5',currentLocation:'Sasti OC'}],[5,'Work Order master',{site:'Sasti OC',workOrderNo:'WO1'}]])await db.query('INSERT INTO master_records VALUES($1,$2,$3)',[id,name,JSON.stringify(data)]);
 const query=(q,a)=>q.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!a&&q.includes(';')?db.exec(q):db.query(q,a);let tail=Promise.resolve();const pool={query,connect:async()=>{const prior=tail;let done;tail=new Promise(r=>done=r);await prior;return {query,release:done}}};
 const app=express();app.use(express.json());app.use(enforceContentDeletionPolicy);const auth=(req,res,next)=>{req.session={login:req.get('X-Test-Actor')||'test-admin'};next()};const service=registerBulkCardScanning(app,{pool,requireSession:auth,requireAdministrator:auth,readPulseFleet:async()=>[{door:'V321',currentLocation:'Sasti OC'},{door:'E5',currentLocation:'Sasti OC'}],readHours:async()=>({breakdownHours:0}),ocr:{close(){}}});await service.start();await service.stop();app.use((e,q,s,n)=>s.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close()});const base='http://127.0.0.1:'+server.address().port;
 const call=async(url,body,method='POST',actor='test-admin')=>{const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json','X-Test-Actor':actor},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text()}};
 const batch=randomUUID(),id=randomUUID(),other=randomUUID();
 await db.query("INSERT INTO mis_scan_batches(id,kind,name,created_by,expected_context) VALUES($1,'vehicle','Deletion fixture','test-admin',$2::jsonb)",[batch,JSON.stringify({bookDate:'2026-12-30',location:'Sasti OC',cardShift:'I',confirmed:true})]);
 for(const [index,cardId] of [id,other].entries())await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,draft,status) VALUES($1,$2,$3,'fixture.png',$4,$5,$6::jsonb,'review')",[cardId,batch,index+1,Buffer.from('test image'),randomUUID(),JSON.stringify({bookDate:'2026-12-30',location:'Sasti OC'})]);
 const path='/api/scan-cards/'+id;
 assert.equal((await call(path+'/delete',{})).status,409,'current revision is required');
 assert.equal((await call(path+'/delete',{revision:0})).status,409,'stale revisions cannot delete');
 assert.equal((await call(path+'/deletion-otp',{revision:1})).status,404,'OTP route is no longer used');
 assert.equal((await call(path+'/fleet-review',{action:'delete',revision:1})).status,409,'legacy route directs clients to Delete card');
 assert.equal((await db.query('SELECT image FROM mis_scan_cards WHERE id=$1',[id])).rows[0].image.length,10);
 const deleted=await call(path+'/delete',{revision:1});assert.equal(deleted.status,200,JSON.stringify(deleted));assert.equal(deleted.data.deleted,true);
 assert.equal((await call(path+'/delete',{revision:1})).status,409,'repeat requests cannot change the tombstone');
 const rows=(await db.query('SELECT * FROM mis_scan_cards ORDER BY ordinal')).rows;
 assert.equal(rows[0].image,null);assert.equal(rows[0].status,'rejected');assert.deepEqual(rows[0].draft,{});assert.equal(rows[0].raw_fields.manualDeletion.by,'test-admin');assert.ok(rows[0].raw_fields.manualDeletion.deletedAt);assert.equal(rows[1].image.length,10);assert.equal(rows[1].status,'review');
 await db.query("UPDATE mis_scan_cards SET status='posted' WHERE id=$1",[other]);
 assert.equal((await call('/api/scan-cards/'+other+'/delete',{revision:1})).status,409,'saved cards cannot be deleted from review');
 assert.equal((await db.query('SELECT image FROM mis_scan_cards WHERE id=$1',[other])).rows[0].image.length,10);
});

test('the delete click sends the current card revision directly without prompts or OTP',async()=>{
 const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 const handler=source.slice(source.indexOf(' const deleteReviewCard='),source.indexOf(' const resolveFleet='));
 assert.doesNotMatch(handler,/window\.(prompt|confirm)|deletion-otp|approval|requestId/);
 assert.match(handler,/body:JSON\.stringify\(\{revision:target.revision\}\)/);
 assert.match(handler,/nextScanReviewCard/);
});
