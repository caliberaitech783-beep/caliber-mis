import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {registerBulkCardScanning} from '../bulk-card-scanning.mjs';
import {LOG_BOOK_SCHEMA} from '../log-book.mjs';
import {scanBatchReport} from '../scan-batch-report.mjs';

test('rejecting a blank card remains visible to its batch and increments the report count',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql):db.query(sql,args),pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());const auth=(req,res,next)=>{req.session={login:'test-admin'};next();};
 const service=registerBulkCardScanning(app,{pool,requireSession:auth,requireAdministrator:auth,ocr:{recognize:async()=>({text:''}),close(){}}});
 await service.start();t.after(()=>service.stop());
 const batchId=randomUUID(),cardId=randomUUID(),context={bookDate:'2026-10-30',location:'Sasti OC',cardShift:'I',confirmed:true};
 await db.query("INSERT INTO mis_scan_batches(id,kind,name,created_by,expected_context) VALUES($1,'vehicle','test','test-admin',$2)",[batchId,JSON.stringify(context)]);
 await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image_hash,status,draft,raw_fields) VALUES($1,$2,1,'blank.png','test','review','{}','{}')",[cardId,batchId]);
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const base='http://127.0.0.1:'+server.address().port;
 const result=await fetch(base+'/api/scan-cards/'+cardId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reject',revision:1,draft:{}})});
 assert.equal(result.status,200,await result.text());
 const response=await fetch(base+'/api/scan-batches/'+batchId),batch=await response.json();
 assert.equal(response.status,200);assert.equal(batch.cards.length,1);assert.equal(batch.cards[0].status,'rejected');
 const report=scanBatchReport(batch.batch,batch.cards);assert.equal(report.counts.rejected,1);assert.equal(report.counts.saved,0);assert.equal(report.counts.pending,0);
 const exported=await fetch(base+'/api/scan-batches/'+batchId+'/report'),json=await exported.json();
 assert.equal(exported.status,200);assert.equal(json.counts.rejected,1);
});
