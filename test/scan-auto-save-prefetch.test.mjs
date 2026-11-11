import {prepareVlbFixture} from './operational-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import express from 'express';import {PGlite} from '@electric-sql/pglite';import {randomUUID} from 'node:crypto';
import {registerBulkCardScanning} from '../server/routes/bulk-card-scanning.mjs';import {LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
import {scanFleetSignature} from '../shared/scan-fleet-assignment.mjs';
process.env.VLB_TWO_STAGE_BATCHES='0'; // legacy single-step batch expectations
const valid={doorText:'V321',bookDate:'2026-12-19',location:'Sasti OC',cardShift:'I',assetId:'1',employeeId:'2',shiftId:'3',workOrderId:'5',shiftHours:8,openingHmr:0,closingHmr:6,openingKmr:0,closingKmr:20,aFormNo:'75',jobCardNo:'E75',timeMode:'with',trips:[{equipmentName:'D19',loadingTime:'09:02',unloadingTime:'09:09',tripCount:1}],scanMachineSummary:[{equipmentName:'D19',tripCount:1}]};

// Automatic saving used to call Pulse for breakdown hours while holding the exclusive scan
// lock, so every other user's save waited on a remote call. The feed is now read once before
// the transaction, the lock is shared, and the master reads use the transaction connection.
test('automatic saving reads Pulse once before its locks and holds the scan lock shared',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const masters=[[1,'Equipment master',{category:'Vehicle',door:'V321',currentLocation:'Sasti OC'}],[2,'C-Dir Employee master',{name:'TEST DRIVER',empId:'EMP100'}],[3,'Shift Master',{site:'Sasti OC',shiftName:'Shift I'}],[4,'Equipment master',{category:'Equipment',door:'E1',currentLocation:'Sasti OC'}],[5,'Work Order master',{site:'Sasti OC',workOrderNo:'WO1'}],[6,'Equipment master',{category:'Equipment',door:'D19',currentLocation:'Sasti OC'}]];
 for(const [id,name,data]of masters)await db.query('INSERT INTO master_records VALUES($1,$2,$3)',[id,name,JSON.stringify(data)]);
 const events=[];let tail=Promise.resolve();
 const query=(q,a)=>{if(q==='BEGIN')events.push('BEGIN');if(q.includes('pg_advisory_xact_lock')){events.push(q);return Promise.resolve({rows:[]})}return !a&&q.includes(';')?db.exec(q):db.query(q,a)};
 const pool={query,connect:async()=>{const previous=tail;let done;tail=new Promise(r=>done=r);await previous;return {query,release(){done()}}}};
 const app=express();app.use(express.json());const session=(q,s,n)=>{if(!q.headers.authorization)return s.sendStatus(401);q.session={login:'test-admin'};n()},admin=(q,s,n)=>q.headers.authorization==='admin'?n():s.sendStatus(403);
 const feed=[{id:'pulse-row'}],inputs=[];let fleetReads=0;
 const service=registerBulkCardScanning(app,{pool,requireSession:session,requireAdministrator:admin,readBreakdownRows:async actor=>{events.push('prefetch:'+actor);return feed},readHours:async input=>{inputs.push(input);return {breakdownHours:0}},readPulseFleet:async()=>{fleetReads++;return []},ocr:{close(){}}});
 await service.start();await prepareVlbFixture(db,valid);t.after(()=>service.stop());app.use((e,q,s,n)=>s.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close()});
 const root='http://127.0.0.1:'+server.address().port;
 const post=async(path,body)=>{const r=await fetch(root+path,{method:'POST',headers:{Authorization:'admin','Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json().catch(()=>null)}};
 const batch=randomUUID(),context={bookDate:valid.bookDate,location:valid.location,cardShift:valid.cardShift};
 await db.query('INSERT INTO mis_scan_batches(id,kind,name,created_by) VALUES($1,$2,$3,$4)',[batch,'vehicle','Prefetch test','test-admin']);
 const card=randomUUID();
 await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,draft,raw_fields,status) VALUES($1,$2,1,'test.png',$3,$4,$5,$6::jsonb,'review')",[card,batch,Buffer.from('retained image'),randomUUID(),JSON.stringify(valid),JSON.stringify({extractionDraft:valid,fleetReview:{signature:scanFleetSignature(valid),issues:[],error:'',checkedAt:new Date().toISOString()}})]);
 for(const [route,body] of [['/context',{expectedContext:context}],['/validate-context',{action:'proceed'}]]){const r=await post('/api/scan-batches/'+batch+route,body);assert.equal(r.status,200,JSON.stringify(r));}
 events.length=0;
 const saved=await post('/api/scan-cards/'+card+'/auto-save',{revision:1});
 assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.data.status,'posted');
 assert.deepEqual(events.filter(e=>e.startsWith('prefetch:')),['prefetch:test-admin'],'the feed is read exactly once');
 assert.ok(events.indexOf('prefetch:test-admin')<events.indexOf('BEGIN'),'Pulse is read before the transaction opens');
 assert.equal(inputs.length,1);assert.equal(inputs[0].breakdownRows,feed,'the saved feed reaches the hours reader');assert.ok(inputs[0].client,'master reads use the transaction connection');
 assert.equal(fleetReads,0,'automatic save reuses the matching fleet review already shown as okay');
 assert.ok(events.includes('SELECT pg_advisory_xact_lock_shared(709224102)'),'the scan lock is shared');
 assert.ok(!events.includes('SELECT pg_advisory_xact_lock(709224102)'),'no exclusive scan lock remains');
 assert.ok(events.includes('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))'),'the site, date and shift scope is locked');
 assert.ok(!events.includes("SELECT pg_advisory_xact_lock(hashtext('mis_vlb_saved_batches'))"),'the whole batch table is not locked');
 const stored=(await db.query('SELECT data FROM mis_log_books WHERE id=$1',[saved.data.record.id])).rows[0].data;
 assert.equal(stored.breakdownHoursSource,'pulse');
});

test('the slim progress poll carries identity, status and trip totals without drafts or validation',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const calls=[];const query=(q,a)=>{calls.push(q);return q.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!a&&q.includes(';')?db.exec(q):db.query(q,a)};
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());const session=(q,s,n)=>{if(!q.headers.authorization)return s.sendStatus(401);q.session={login:'test-admin'};n()},admin=(q,s,n)=>n();
 const service=registerBulkCardScanning(app,{pool,requireSession:session,requireAdministrator:admin,readHours:async()=>({breakdownHours:0}),ocr:{close(){}}});
 await service.start();await service.stop();app.use((e,q,s,n)=>s.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close()});
 const batch=randomUUID();await db.query('INSERT INTO mis_scan_batches(id,kind,name,created_by) VALUES($1,$2,$3,$4)',[batch,'vehicle','Progress test','test-admin']);
 const add=async(ordinal,status,draft,rawFields={})=>{const id=randomUUID();await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,draft,raw_fields,status) VALUES($1,$2,$3,'test.png',$4,$5,$6,$7::jsonb,$8)",[id,batch,ordinal,Buffer.from('retained image'),randomUUID(),JSON.stringify(draft),JSON.stringify(rawFields),status]);return id};
 const review=await add(1,'review',{...valid,trips:[{equipmentName:'D19',tripCount:3},{equipmentName:'D19',tripCount:2}]},{extraction:{originalResponse:'x'.repeat(5000)},fleetReview:{checkedAt:'2026-11-08T10:00:00.000Z',signature:'sig',issues:[]}});
 const reading=await add(2,'reading',{},{scanProgress:{stage:'retrying',attempt:2}});
 const deleted=await add(3,'review',{},{manualDeletion:{vehicle:'V-200'}});
 const read=async suffix=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/scan-batches/'+batch+suffix,{headers:{Authorization:'admin'}});return {status:r.status,bytes:Number(r.headers.get('content-length')||0),data:await r.json()}};
 calls.length=0;
 const progress=await read('?progress=1');assert.equal(progress.status,200);
 assert.ok(progress.data.progress);assert.deepEqual(progress.data.cards.map(c=>c.id),[review,reading]);
 assert.deepEqual(progress.data.batch.deletedCards,[{id:deleted,ordinal:3,vehicle:'V-200'}]);
 const [first,second]=progress.data.cards;
 assert.equal(first.status,'review');assert.equal(first.revision,1);assert.equal(first.trip_total,5);assert.equal(first.checks,null);
 assert.equal(first.draft,undefined,'no draft travels in the progress poll');assert.equal(first.raw_fields.extraction,undefined,'no extraction text travels either');
 assert.equal(first.raw_fields.fleetReview.checkedAt,'2026-11-08T10:00:00.000Z');
 assert.deepEqual(second.raw_fields,{scanProgress:{stage:'retrying',attempt:2}});
 assert.ok(!calls.some(q=>q.includes('UPDATE mis_scan_cards')),'a progress poll rewrites nothing');
 const full=await read('');assert.equal(full.status,200);
 assert.ok(full.data.cards[0].draft.trips.length===2,'the full read still carries the draft');
 assert.ok(progress.bytes<full.bytes/4,`progress ${progress.bytes} B should be far smaller than the full ${full.bytes} B`);
});
