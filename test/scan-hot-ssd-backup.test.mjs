import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {manualBackupWindow,registerScanBackup,DAY} from '../scan-backup.mjs';
import {scanBlobConfig,createScanBlobStorage,imageHash} from '../scan-blob-storage.mjs';
import {copyBackup,verifiedFile,sha256} from '../src/scan-backup-files.mjs';
import {misPageAllowed,misRequestAllowed} from '../mis-application-access.mjs';
import {registerBulkCardScanning} from '../bulk-card-scanning.mjs';

test('manual backup includes recent scans without a scheduled waiting period',()=>{
 const first='2026-01-01T00:00:00Z',now=new Date(Date.parse(first)+DAY);
 assert.deepEqual(manualBackupWindow(first,now),{from:new Date(first).toISOString(),to:new Date(now.getTime()+1).toISOString()});
 assert.equal(manualBackupWindow(null),null);
});
test('private Hot uploads verify bytes and never overwrite or change tiers on retries',async()=>{
 const image=Buffer.from([255,216,255,1]),id=randomUUID(),batchId=randomUUID(),calls=[];let conflict=false;
 const store=createScanBlobStorage({account:'testscanstorage',container:'scanned-cards'},{env:{IDENTITY_ENDPOINT:'http://identity/token',IDENTITY_HEADER:'identity-header'},fetchImpl:async(url,options)=>{
  calls.push({url:String(url),...options});
  if(String(url).startsWith('http://identity'))return Response.json({access_token:'test-token',expires_on:Date.now()/1000+3600});
  return options.method==='PUT'?new Response(null,{status:conflict?412:201}):new Response(image);
 }});
 const blob=await store.put({id,batchId,kind:'vehicle',image});assert.equal(blob.bytes,image.length);
 const put=calls.find(call=>call.method==='PUT');assert.equal(put.headers['x-ms-access-tier'],'Hot');assert.equal(put.headers['If-None-Match'],'*');
 conflict=true;await store.put({id,batchId,kind:'vehicle',image});
 const existing={image:Buffer.from('legacy')};assert.equal(await store.hydrate(existing),existing);
 assert.equal(calls.filter(call=>call.url.startsWith('http://identity')).length,1);
 assert.equal(scanBlobConfig({MIS_LOCAL_SCANNER_DATABASE:'true',MIS_SCAN_BLOB_ENABLED:'true'}),null);
 assert.throws(()=>scanBlobConfig({MIS_SCAN_BLOB_ENABLED:'true',WEBSITE_SITE_NAME:'other'}));
 const corrupt=createScanBlobStorage({account:'testscanstorage',container:'scanned-cards'},{env:{IDENTITY_ENDPOINT:'http://identity',IDENTITY_HEADER:'x'},fetchImpl:async url=>String(url).startsWith('http:')?Response.json({access_token:'x',expires_on:Date.now()/1000+3600}):new Response('wrong')});
 await assert.rejects(()=>corrupt.read(blob.key,imageHash(image)),/checksum/);
});

function memoryDirectory(name='SSD'){
 const files=new Map(),folders=new Map();
 return {name,files,async getDirectoryHandle(name){if(!folders.has(name))folders.set(name,memoryDirectory(name));return folders.get(name)},async getFileHandle(name,options={}){
  if(!files.has(name)){if(!options.create)throw Object.assign(Error('missing'),{name:'NotFoundError'});files.set(name,new Uint8Array());}
  return {async getFile(){const bytes=files.get(name);return {size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer}},async createWritable(){let pending;return {async write(bytes){pending=new Uint8Array(bytes)},async close(){files.set(name,pending)},async abort(){}}}};
 }};
}
test('SSD copy rereads files, verifies image and metadata, safely resumes, and refuses conflicting contents',async()=>{
 const directory=memoryDirectory(),image=new Uint8Array([255,216,1,2]),hash=await sha256(image),id=randomUUID(),cardId=randomUUID();
 const job={id,window_start:'2026-01-01T00:00:00Z',window_end:'2026-01-31T00:00:00Z'};
 const calls=[],api=async(url,body)=>{calls.push({url,body});return url.endsWith('/items')?{items:[{card_id:cardId,image_hash:hash,image_bytes:image.length,metadata:{logbookId:4,savedLogbookData:{openingHmr:123}}}],next:null}:{}};
 const run=()=>copyBackup({job,directory,api,image:async()=>image.buffer});
 assert.equal((await run()).count,1);assert.equal((await run()).count,1);
 const folder=await directory.getDirectoryHandle('Pulse-II-'+id);assert.equal(folder.files.size,3);
 assert.ok(calls.some(call=>call.url.endsWith('/complete')));
 folder.files.set(cardId+'.jpg',new Uint8Array([0]));const prior=calls.length;
 await assert.rejects(run,/different contents/);assert.equal(calls.slice(prior).some(call=>call.url.endsWith('/complete')),false);
 await assert.rejects(()=>verifiedFile(folder,cardId+'.jpg',image,hash),/different contents/);
});

test('backup API snapshots only new Blob images and cannot complete before every SSD receipt',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE mis_scan_batches(id UUID PRIMARY KEY,kind TEXT);CREATE TABLE mis_log_books(id BIGINT PRIMARY KEY,book_no TEXT,data JSONB);
 CREATE TABLE mis_scan_cards(id UUID PRIMARY KEY,batch_id UUID,filename TEXT,image BYTEA,image_hash TEXT,image_blob_key TEXT,image_bytes BIGINT,blob_uploaded_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW(),draft JSONB,raw_fields JSONB,checked_by TEXT,checked_at TIMESTAMPTZ,logbook_id BIGINT);`);
 const batchId=randomUUID(),cardId=randomUUID(),legacyId=randomUUID(),image=Buffer.from('new image'),hash=imageHash(image);
 await db.query('INSERT INTO mis_scan_batches VALUES($1,$2)',[batchId,'vehicle']);
 await db.query("INSERT INTO mis_log_books VALUES(1,'VLB-1','{\"reading\":123}')");
 await db.query("INSERT INTO mis_scan_cards(id,batch_id,filename,image_hash,image_blob_key,image_bytes,blob_uploaded_at,draft,raw_fields,logbook_id) VALUES($1,$2,'new.jpg',$3,'vehicle/new/image.jpg',$4,'2026-01-01','{}','{}',1)",[cardId,batchId,hash,image.length]);
 await db.query("INSERT INTO mis_scan_cards(id,batch_id,filename,image,image_hash,draft) VALUES($1,$2,'legacy.png',$3,'legacy','{}')",[legacyId,batchId,Buffer.from('existing original')]);
 const before=await db.query('SELECT * FROM mis_log_books');const legacyBefore=await db.query('SELECT * FROM mis_scan_cards WHERE id=$1',[legacyId]);
 const pool={query:(sql,args)=>!args&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args),connect:async()=>({query:(sql,args)=>sql.includes('pg_advisory')?Promise.resolve({rows:[]}):db.query(sql,args),release(){}})};
 const app=express();app.use(express.json());const auth=(req,res,next)=>{req.session={login:'admin'};next()};
 const service=registerScanBackup(app,{pool,requireSession:auth,requireAdministrator:auth,imageStorage:{read:async()=>image},now:()=>new Date('2026-03-02T00:00:00Z')});await service.start();
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const base='http://127.0.0.1:'+server.address().port;const post=(url,body={})=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const created=await post('/api/scan-backups');assert.equal(created.status,200,await created.clone().text());const {job}=await created.json();
 const items=await (await fetch(base+'/api/scan-backups/'+job.id+'/items')).json();assert.deepEqual(items.items.map(item=>item.card_id),[cardId]);assert.deepEqual(items.items[0].metadata.savedLogbookData,{reading:123});
 assert.equal((await post('/api/scan-backups/'+job.id+'/complete',{destination:'SSD'})).status,409);
 assert.equal((await post('/api/scan-backups/'+job.id+'/verified',{cardId,sha256:'0'.repeat(64)})).status,409);
 assert.equal((await post('/api/scan-backups/'+job.id+'/verified',{cardId,sha256:hash})).status,200);
 assert.equal((await post('/api/scan-backups/'+job.id+'/complete',{destination:'SSD'})).status,200);
 assert.deepEqual((await db.query('SELECT * FROM mis_log_books')).rows,before.rows);assert.deepEqual((await db.query('SELECT * FROM mis_scan_cards WHERE id=$1',[legacyId])).rows,legacyBefore.rows);
 assert.equal((await (await fetch(base+'/api/scan-backups')).json()).due.length,0);
});

test('backup permission is separate from deletion and fail-closed for limited MIS users',()=>{
 const session=pages=>({permissions:{separateMisCredentials:true,misDesktopAccess:pages}});
 assert.equal(misPageAllowed(session(['Deletion']),'Scan Backup','desktop'),false);
 assert.equal(misRequestAllowed(session(['Scan Backup']),{path:'/api/scan-backups',method:'GET'}),true);
 assert.equal(misRequestAllowed(session(['Trip Card Bulk Scan']),{path:'/api/scan-backups',method:'GET'}),false);
});

test('new uploads store verified Blob references, legacy images still open, and upload failures create no card',async t=>{
 const batchId=randomUUID(),cardId=randomUUID(),legacyId=randomUUID();
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBEkAAAAASUVORK5CYII=','base64');
 const rows=new Map([[legacyId,{id:legacyId,batch_id:batchId,image,raw_fields:{},draft:{}}]]);let fail=false,puts=0;
 const query=async(sql,args=[])=>{
  if(sql.startsWith('SELECT * FROM mis_scan_batches'))return {rows:[{id:batchId,kind:'vehicle',expected_context:{bookDate:'2026-10-30',location:'Sasti OC',cardShift:'I'}}]};
  if(sql.startsWith('SELECT * FROM mis_scan_cards'))return {rows:rows.has(args[0])?[rows.get(args[0])]:[]};
  if(sql.includes('count(*) AS n'))return {rows:[{n:rows.size}]};
  if(sql.startsWith('SELECT id FROM mis_scan_cards'))return {rows:rows.has(args[0])?[{id:args[0]}]:[]};
  if(sql.startsWith('INSERT INTO mis_scan_cards'))rows.set(args[0],{id:args[0],batch_id:args[1],image:args[4],image_hash:args[5],image_blob_key:args[9],image_bytes:args[10],blob_uploaded_at:args[11],raw_fields:{},draft:{}});
  return {rows:[]};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const imageStorage={async put(){puts++;if(fail)throw Error('Blob unavailable');return {key:'vehicle/'+batchId+'/'+cardId+'.png',bytes:image.length,uploadedAt:new Date()}},async hydrate(card){return {...card,image:card.image_blob_key?image:card.image}}};
 const app=express();app.use(express.json());const auth=(req,res,next)=>{req.session={login:'admin'};next()};
 const service=registerBulkCardScanning(app,{pool,requireSession:auth,requireAdministrator:auth,imageStorage,ocr:{close(){}}});t.after(()=>service.stop());
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const base='http://127.0.0.1:'+server.address().port;
 const upload=id=>fetch(base+'/api/scan-batches/'+batchId+'/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploadKey:id,base64:image.toString('base64')})});
 assert.equal((await upload(cardId)).status,201);assert.equal(rows.get(cardId).image,null);assert.equal(rows.get(cardId).image_bytes,image.length);
 assert.deepEqual(Buffer.from(await (await fetch(base+'/api/scan-cards/'+cardId+'/image')).arrayBuffer()),image);
 assert.deepEqual(Buffer.from(await (await fetch(base+'/api/scan-cards/'+legacyId+'/image')).arrayBuffer()),image);
 assert.equal((await upload(cardId)).status,200);assert.equal(puts,1);
 fail=true;assert.equal((await upload(randomUUID())).status,500);assert.equal(rows.size,2);assert.deepEqual(rows.get(legacyId).image,image);
});
