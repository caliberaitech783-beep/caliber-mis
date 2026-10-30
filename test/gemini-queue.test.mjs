import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {registerBulkCardScanning} from '../bulk-card-scanning.mjs';
import {LOG_BOOK_SCHEMA} from '../log-book.mjs';

test('a later upload finishes while an earlier Gemini card is slow, with distinct database claims',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const query=(q,a)=>!a&&q.includes(';')?db.exec(q):db.query(q,a),pool={query,connect:async()=>({query,release(){}})};
 let releaseFirst,firstStarted;const firstGate=new Promise(r=>releaseFirst=r),started=new Promise(r=>firstStarted=r);let calls=0;
 const app=express();app.use(express.json());const auth=(q,s,n)=>{q.session={login:'test-admin'};n()};
 const service=registerBulkCardScanning(app,{pool,requireSession:auth,requireAdministrator:auth,scanConcurrency:2,ocr:{async recognize(){if(++calls===1){firstStarted();await firstGate;}return {text:'Door No: S/14',confidence:90};},close(){}}});await service.start();t.after(async()=>{releaseFirst();await service.stop()});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close()});
 const post=async(path,body)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok);return r.json()};
 const batch=await post('/api/scan-batches',{kind:'vehicle',expectedContext:{bookDate:'2026-10-30',location:'Sasti OC',cardShift:'I'}}),one=randomUUID(),two=randomUUID(),base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBEkAAAAASUVORK5CYII=';
 await post('/api/scan-batches/'+batch.id+'/cards',{uploadKey:one,base64});await started;
 // The second worker initially saw an empty queue; a new upload must wake it.
 await post('/api/scan-batches/'+batch.id+'/cards',{uploadKey:two,base64});
 let status;for(let i=0;i<100;i++){status=(await db.query('SELECT status FROM mis_scan_cards WHERE id=$1',[two])).rows[0].status;if(status==='review')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(status,'review');assert.equal(calls,2);assert.equal((await db.query('SELECT status FROM mis_scan_cards WHERE id=$1',[one])).rows[0].status,'reading');
 releaseFirst();for(let i=0;i<100;i++){if((await db.query('SELECT status FROM mis_scan_cards WHERE id=$1',[one])).rows[0].status==='review')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_scan_cards WHERE status=$1',['review'])).rows[0].n,2);
});
