import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createCanvas} from '@napi-rs/canvas';
import {registerBulkCardScanning} from '../bulk-card-scanning.mjs';
import {LOG_BOOK_SCHEMA} from '../log-book.mjs';
import {canAutoSaveScanCard} from '../scan-auto-save.mjs';

async function fixture(t,options={}){
 const db=new PGlite(),calls=[];
 await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const query=(sql,args)=>{calls.push(sql);return !args&&sql.includes(';')?db.exec(sql):db.query(sql,args);};
 const pool={query,connect:async()=>({query,release(){}})},app=express();app.use(express.json());
 const auth=(req,res,next)=>{req.session={login:'test-admin'};next();};
 const service=registerBulkCardScanning(app,{pool,requireSession:auth,requireAdministrator:auth,scanConcurrency:1,ocr:{recognize:async()=>({text:'Door No: V1\nSite: Sasti OC'}),close(){}},...options});
 await service.start();
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{options.cleanup?.();server.closeAllConnections();server.close();await service.stop();await db.close();});
 const batchId=randomUUID();
 await db.query("INSERT INTO mis_scan_batches(id,kind,name,created_by,created_at) VALUES($1,'equipment','Sustained upload test','test-admin','2026-12-01')",[batchId]);
 const add=async(ordinal,status='review')=>{
  const id=randomUUID();await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,draft,status,created_at) VALUES($1,$2,$3,'card.png',$4,$5,$6,$7,'2026-12-01')",[id,batchId,ordinal,Buffer.from('scan fixture'),'hash-'+ordinal,JSON.stringify({location:'Sasti OC'}),status]);return id;
 };
 return {db,calls,service,add,url:'http://127.0.0.1:'+server.address().port+'/api/scan-batches/'+batchId};
}

test('upload progress reads stay constant-size in database work and cannot mark unchecked cards ready',async t=>{
 const {db,calls,service,add,url}=await fixture(t);await service.stop();
 for(let n=1;n<=40;n++)await add(n);
 calls.length=0;
 const response=await fetch(url+'?progress=1');assert.equal(response.status,200);
 const progress=await response.json(),lightweightCalls=calls.length;
 assert.equal(progress.cards.length,40);
 assert.ok(progress.cards.every(card=>card.checks===null&&!canAutoSaveScanCard(card,'equipment')));
 assert.ok(!calls.some(sql=>sql.includes('UPDATE mis_scan_cards')||sql.includes('FROM master_records')));
 assert.equal(lightweightCalls,3,'one batch read, one queue-priority update and one card read');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_scan_cards WHERE revision=1')).rows[0].n,40);
 calls.length=0;
 const complete=await (await fetch(url)).json();
 assert.equal(complete.cards.length,40);assert.ok(complete.cards.every(card=>card.checks.errors.length>0));
 assert.ok(calls.length>=80,'normal refresh still validates every card against current data');
 console.log(`40-card polling: ${calls.length} database calls for full review; ${lightweightCalls} for upload progress`);
});

test('a slow Pulse fleet response does not hold the only extraction worker',async t=>{
 let releaseFleet,startFleet;
 const gate=new Promise(resolve=>releaseFleet=resolve),started=new Promise(resolve=>startFleet=resolve);
 let reads=0;
 const {db,service,add}=await fixture(t,{readPulseFleet:async()=>{reads++;startFleet();await gate;return [{door:'V1',currentLocation:'Sasti OC'}];},cleanup:()=>releaseFleet()});
 await add(1,'queued');await add(2,'queued');
 const pumping=service.pump();
 await Promise.race([started,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Fleet verification did not start')),3000);timer.unref();})]);
 let reviewed=0;
 for(let i=0;i<100;i++){
  reviewed=(await db.query("SELECT count(*)::int AS n FROM mis_scan_cards WHERE status='review'")).rows[0].n;
  if(reviewed===2)break;await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.equal(reviewed,2,'second card finishes extraction while the first fleet request is unresolved');
 assert.ok(reads>=1&&reads<=2);
 const response=(await db.query('SELECT raw_fields FROM mis_scan_cards')).rows;
 assert.ok(response.every(row=>!row.raw_fields.fleetReview),'pending fleet work has not been mistaken for verification');
 releaseFleet();await pumping;
});

test('concurrent upload metadata preserves printed order when requests arrive out of order',async t=>{
 const {db,service,url}=await fixture(t);await service.stop();
 const upload=async(ordinal,colour)=>{
  const canvas=createCanvas(2,2),ctx=canvas.getContext('2d');ctx.fillStyle=colour;ctx.fillRect(0,0,2,2);
  const base64=canvas.toBuffer('image/png').toString('base64');
  return fetch(url+'/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploadKey:randomUUID(),ordinal,filename:'page-'+ordinal,base64})});
 };
 for(const [ordinal,colour] of [[3,'red'],[1,'blue'],[2,'green']]){
  const response=await upload(ordinal,colour);assert.equal(response.status,201,await response.text());
 }
 assert.deepEqual((await db.query('SELECT ordinal,filename FROM mis_scan_cards ORDER BY ordinal')).rows,[{ordinal:1,filename:'page-1'},{ordinal:2,filename:'page-2'},{ordinal:3,filename:'page-3'}]);
 const conflict=await upload(2,'yellow');assert.equal(conflict.status,409);assert.match((await conflict.json()).error,/order conflict/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_scan_cards')).rows[0].n,3);
});
