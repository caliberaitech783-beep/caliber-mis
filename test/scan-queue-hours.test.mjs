import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {LOG_BOOK_SCHEMA} from '../log-book.mjs';
import {registerBulkCardScanning} from '../bulk-card-scanning.mjs';
test('actual queue keeps derived shift hours when model tables contain an empty written-hours field',async()=>{
 const db=new PGlite();await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 let tail=Promise.resolve();const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>{const prior=tail;let done;tail=new Promise(resolve=>done=resolve);await prior;return {query,release:done}}};
 const app=express();app.use(express.json());const protect=(req,_res,next)=>{req.session={login:'fixture'};next()};let index=0;
 const shifts=['Day','III'];const service=registerBulkCardScanning(app,{pool,requireSession:protect,requireAdministrator:protect,ocr:{recognize:async()=>({text:'SHIFT [x] '+shifts[index++],handwrittenFields:{shiftHours:''},extraction:{rows:[],summary:[],issues:[]}}),close(){}},getSiteScope:async()=>({sites:null})});await service.start();
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port,post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok,await r.clone().text());return r.json()};
 try{const batch=await post('/api/scan-batches',{kind:'vehicle',expectedContext:{bookDate:'2026-10-30',location:'Sasti OC',cardShift:'I'}});const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBEkAAAAASUVORK5CYII=','base64');
  for(let i=0;i<2;i++)await post('/api/scan-batches/'+batch.id+'/cards',{uploadKey:randomUUID(),base64:Buffer.concat([image,Buffer.from('fixture'+i)]).toString('base64')});
  let rows=[];for(let i=0;i<200;i++){rows=(await db.query('SELECT draft,status FROM mis_scan_cards ORDER BY ordinal')).rows;if(rows.length===2&&rows.every(row=>row.status==='review'))break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.deepEqual(rows.map(row=>row.draft.shiftHours),[12,8]);assert.deepEqual(rows.map(row=>row.draft.cardShift),['Day','III']);assert.equal((await db.query('SELECT count(*)::int n FROM mis_log_books')).rows[0].n,0);
 }finally{await service.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await db.close();}
});
