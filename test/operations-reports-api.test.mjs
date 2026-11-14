import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerLogBooks,LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
import {encodeScanJson} from '../server/rules/scan-text-storage.mjs';
import {createReportLane} from '../server/services/report-lane.mjs';
process.env.VLB_TWO_STAGE_BATCHES='0'; // legacy single-step batch expectations
test('read-only operations endpoint enforces access, validates dates, returns beyond 100 rows and decodes scans',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(LOG_BOOK_SCHEMA);await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB); CREATE TABLE mis_scan_batches(id TEXT PRIMARY KEY,kind TEXT); CREATE TABLE mis_scan_cards(id TEXT,batch_id TEXT,filename TEXT,status TEXT,draft JSONB,error TEXT,logbook_id BIGINT,created_at TIMESTAMPTZ,ordinal INTEGER)');
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Equipment master',$1)",[JSON.stringify({door:'V1',category:'Vehicle',site:'Sasti',password:'private-should-not-leak'})]);
 const data={bookDate:'2026-12-28',location:'Sasti',door:'V1',assetId:1,shiftId:3,employeeId:2,shiftHours:8,openingHmr:0,closingHmr:6,trips:[]};
 await db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,request_key,created_by) SELECT 'BOOK-'||n,'vehicle','2026-12-28','Sasti',1,$1,md5(n::text)::uuid,'fixture' FROM generate_series(1,105) AS n",[JSON.stringify(data)]);
 await db.exec("INSERT INTO mis_scan_batches VALUES('batch','vehicle')");
 await db.query("INSERT INTO mis_scan_cards VALUES('card','batch','scan.png','review',$1,NULL,NULL,'2026-11-01',1)",[JSON.stringify(encodeScanJson({bookDate:'2026-12-28',location:'सास्ती'}))]);
 const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const app=express();registerLogBooks(app,{pool:{query},requireSession:(req,res,next)=>{req.session={role:'super',permissions:{adminLevel:'Admin',separateMisCredentials:Boolean(req.headers['x-site'])},...(req.headers['x-site']?{site:req.headers['x-site']}:{})};return req.headers.authorization?next():res.status(401).json({error:'Sign in'});},requireAdministrator:(req,res,next)=>req.headers.authorization==='admin'?next():res.status(403).json({error:'Forbidden'}),lane:createReportLane({cacheMs:0})});app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 // A lane that keeps no finished result, so each call below reads the rows written just before it.
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));t.after(()=>{server.closeAllConnections();server.close();});const url=`http://127.0.0.1:${server.address().port}/api/reports/operations`;
 const call=(params,auth='admin')=>fetch(url+params,{headers:auth?{Authorization:auth}:{}});
 assert.equal((await call('?from=2026-12-28&to=2026-12-28','')).status,401);assert.equal((await call('?from=2026-12-28&to=2026-12-28','other')).status,403);
 for(const q of ['','?from=2026-02-31&to=2026-03-01','?from=2026-12-28&to=2026-12-01','?from=2024-01-01&to=2026-01-01'])assert.equal((await call(q)).status,400);
 const response=await call('?from=2026-12-28&to=2026-12-28');const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.records.length,105);assert.equal(result.cards[0].draft.location,'सास्ती');assert.ok(!JSON.stringify(result).includes('private-should-not-leak'));assert.match(response.headers.get('cache-control'),/no-store/);
 const scoped=await fetch(url+'?from=2026-12-28&to=2026-12-28',{headers:{Authorization:'admin','x-site':'Other'}});const scopedData=await scoped.json();assert.equal(scopedData.records.length,0);assert.equal(scopedData.cards.length,0);assert.equal(scopedData.assets.length,0);
 assert.equal((await db.query('SELECT count(*) AS n FROM mis_log_books')).rows[0].n,105);
 // Loading Equipment-wise Report: the stage of each batch in the dates and the site machines of those batches with no saved ELB.
 assert.deepEqual(result.batches,[]);assert.deepEqual(result.fleet,[]);
 const ids={open:'b0000000-0000-4000-8000-000000000001',closed:'b0000000-0000-4000-8000-000000000002',deleted:'b0000000-0000-4000-8000-000000000003',other:'b0000000-0000-4000-8000-000000000004',later:'b0000000-0000-4000-8000-000000000005'};
 const batch=(id,site,date,shift,stage,extra='NULL,NULL')=>db.query(`INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,sequence,request_key,stage,closed_at,deleted_at) VALUES($1,$2,$3,$4,$5,1,$6,$7,${extra})`,[id,'BATCH '+id.slice(-1),site,date,shift,id.replace(/^b/,'c'),stage]);
 await batch(ids.open,'Sasti','2026-12-28','S1','elb_open');await batch(ids.closed,'Sasti','2026-12-28','S2','elb_open','NOW(),NULL');await batch(ids.deleted,'Sasti','2026-12-28','S3','elb_open','NULL,NOW()');
 await batch(ids.other,'Other','2026-12-28','S1','vlb_open');await batch(ids.later,'Sasti','2026-12-29','S1','elb_open');
 const saved=(await db.query("SELECT id FROM mis_log_books ORDER BY id LIMIT 1")).rows[0].id;
 const machine=(batchId,asset,door,logbook=null)=>db.query("INSERT INTO mis_vlb_batch_fleet(batch_id,asset_id,door,equipment_name,equipment_group,trips,source_cards,logbook_id) VALUES($1,$2,$3,'SAMPLE EXCAVATOR','Excavator',0,0,$4)",[batchId,asset,door,logbook]);
 await machine(ids.open,11,'EX1');await machine(ids.open,12,'EX2',saved);await machine(ids.deleted,13,'EX3');await machine(ids.other,14,'EX4');await machine(ids.later,15,'EX5');
 const staged=await (await call('?from=2026-12-28&to=2026-12-28')).json();
 assert.deepEqual(staged.batches.map(b=>[b.site,b.date,b.shift,b.stage]).sort(),[['Other','2026-12-28','S1','vlb_open'],['Sasti','2026-12-28','S1','elb_open'],['Sasti','2026-12-28','S2','closed']],'deleted batches and other dates are left out; a closed batch says so');
 assert.deepEqual(staged.fleet.map(f=>[f.site,f.date,f.shift,f.assetId,f.door,f.name,f.group]).sort(),[['Other','2026-12-28','S1','14','EX4','SAMPLE EXCAVATOR','Excavator'],['Sasti','2026-12-28','S1','11','EX1','SAMPLE EXCAVATOR','Excavator']],'only machines with no saved ELB');
 const elsewhere=await (await fetch(url+'?from=2026-12-28&to=2026-12-28',{headers:{Authorization:'admin','x-site':'Other'}})).json();
 assert.deepEqual([elsewhere.batches.map(b=>b.site),elsewhere.fleet.map(f=>f.door)],[['Other'],['EX4']],'a site login sees only its own batches and machines');
});
