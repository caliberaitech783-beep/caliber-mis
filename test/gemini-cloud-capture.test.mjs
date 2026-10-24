import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {PGlite} from '@electric-sql/pglite';import {randomUUID} from 'node:crypto';
import {registerBulkCardScanning} from '../bulk-card-scanning.mjs';import {LOG_BOOK_SCHEMA} from '../log-book.mjs';
test('local connector retains VLB/ELB images for online extraction without a local model request or log-book posting',async t=>{
 const previous=process.env.MIS_LOCAL_SCANNER_DATABASE;process.env.MIS_LOCAL_SCANNER_DATABASE='true';t.after(()=>{if(previous===undefined)delete process.env.MIS_LOCAL_SCANNER_DATABASE;else process.env.MIS_LOCAL_SCANNER_DATABASE=previous});
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const query=(q,a)=>q.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!a&&q.includes(';')?db.exec(q):db.query(q,a),pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());const auth=(q,s,n)=>{q.session={login:'pc-scanner:test'};n()};let calls=0;
 const service=registerBulkCardScanning(app,{pool,requireSession:auth,requireAdministrator:auth,ocr:{recognize(){calls++;throw Error('Do not extract twice')},close(){}}});await service.start();t.after(()=>service.stop());
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(path,body)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok);return r.json()};
 for(const kind of ['vehicle','equipment']){
  const batch=await call('/api/scan-batches',{kind}),id=randomUUID();
  await call('/api/scan-batches/'+batch.id+'/cards',{uploadKey:id,filename:'Scanner.png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBEkAAAAASUVORK5CYII='});
  let row;for(let i=0;i<100;i++){row=(await db.query('SELECT status,raw_fields,image FROM mis_scan_cards WHERE id=$1',[id])).rows[0];if(row.status==='review')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(row.status,'review');assert.equal(row.raw_fields.connectorCaptureOnly,true);assert.ok(row.image.length>24);
 }
 assert.equal(calls,0);assert.equal(Number((await db.query('SELECT count(*) n FROM mis_log_books')).rows[0].n),0);
});
