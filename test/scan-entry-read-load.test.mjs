import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import {registerBulkCardScanning,SCAN_SCHEMA,scanReadSlots,scanProgressSlots} from '../server/routes/bulk-card-scanning.mjs';
import {LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
import {createReportLane} from '../server/services/report-lane.mjs';

// 14 November 2026: Admin > Diagnostics showed every one of the pool's 10 connections held by
// GET /api/scan-batches/:id while no card was being read. Two causes, both covered here: the
// scan entry list asked for every entry's progress separately (up to 100 requests at once), and
// whole entry reads each held a connection for as long as they ran, with no limit on how many.

test('entry read slots come from a setting, with a safe default',()=>{
 assert.equal(scanReadSlots({}),4);
 assert.equal(scanReadSlots({MIS_SCAN_READ_SLOTS:'2'}),2);
 for(const bad of ['0','51','x',''])assert.equal(scanReadSlots({MIS_SCAN_READ_SLOTS:bad}),4,bad);
 assert.equal(scanProgressSlots({}),4);
 assert.equal(scanProgressSlots({MIS_SCAN_PROGRESS_SLOTS:'6'}),6);
 assert.equal(scanProgressSlots({MIS_SCAN_PROGRESS_SLOTS:'0'}),4);
});

test('the scan screen takes trip totals from the entry list instead of reading every entry',()=>{
 const source=fs.readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 const list=source.slice(source.indexOf(' const list=async()=>{'),source.indexOf('setBatches(rows)'));
 assert.match(list,/Number\.isFinite\(b\.trip_total\)\?b\.trip_total:0/);
 assert.match(list,/if\(!Number\.isFinite\(b\.trip_total\)\)try\{const detail=await api\('\/api\/scan-batches\/'\+b\.id\+'\?progress=1'\)/);
});

test('the entry list carries trip totals and whole entry reads share a few connections',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 await db.exec(LOG_BOOK_SCHEMA);await db.exec(SCAN_SCHEMA);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 let held=0,mostHeld=0,checkouts=0;
 const pool={query,connect:async()=>{held++;checkouts++;mostHeld=Math.max(mostHeld,held);await new Promise(r=>setTimeout(r,30));return {query,release(){held--;}}}};
 const app=express();app.use(express.json());
 const session=(req,res,next)=>{req.session={login:'alice',name:'Alice',role:'super',permissions:{adminLevel:'Admin'}};next()};
 const authorized=(req,res,next)=>next();
 const readLane=createReportLane({slots:1,cacheMs:0}),progressLane=createReportLane({slots:1,cacheMs:2000});
 registerBulkCardScanning(app,{pool,requireSession:session,requireAdministrator:authorized,ocr:{recognize:async()=>{throw Error('Not used')}},readLane,progressLane});
 app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(route,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}`+route,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const first=(await call('/api/scan-batches','POST',{kind:'equipment',name:'First'})).data.id;
 const second=(await call('/api/scan-batches','POST',{kind:'equipment',name:'Second'})).data.id;
 assert.ok(first&&second);
 const trips=rows=>JSON.stringify({trips:rows.map(n=>({tripCount:n,loadingTime:'08:00',unloadingTime:'08:20'}))});
 const card=async(batch,ordinal,{status='posted',draft=trips([]),raw='{}',note='',duplicateOf=null,logbookId=null}={})=>{const id=randomUUID();await db.query('INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image_hash,status,draft,raw_fields,review_note,duplicate_of,logbook_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,batch,ordinal,'card'+ordinal+'.webp','hash'+id,status,draft,raw,note,duplicateOf,logbookId]);return id;};
 // Counted: two unsaved cards (2+3) and a saved card whose log book carries 7 trips (its draft says 1).
 await card(first,1,{draft:trips([2])});
 await card(first,2,{draft:trips([3])});
 const saved=(await db.query('INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,request_key,created_by) VALUES($1,$2,$3,$4,1,$5,$6,$7) RETURNING id',['SAVED-1','equipment','2026-11-14','Sasti OC',JSON.stringify({bookDate:'2026-11-14',location:'Sasti OC',trips:[{tripCount:7,loadingTime:'09:00',unloadingTime:'09:30'}]}),randomUUID(),'alice'])).rows[0].id;
 await card(first,3,{draft:trips([1]),logbookId:saved});
 // Not counted: a manually deleted card, an exact duplicate, a card removed from the batch, an unloading-only row.
 await card(first,4,{draft:trips([100]),raw:JSON.stringify({manualDeletion:{vehicle:'EQ1'}}),note:'Card deleted manually by user alice'});
 await card(first,5,{draft:trips([100]),duplicateOf:first});
 await card(first,6,{draft:trips([100]),note:'Removed from batch: wrong date, site or shift'});
 await card(first,7,{draft:JSON.stringify({trips:[{tripCount:100,unloadingTime:'10:00'}]})});
 const list=(await call('/api/scan-batches')).data.batches;
 const totals=Object.fromEntries(list.map(b=>[b.id,b.trip_total]));
 assert.equal(totals[first],12);
 assert.equal(totals[second],0);

 // Three whole reads at once, one slot: one connection at a time, every read answered.
 held=0;mostHeld=0;checkouts=0;
 const reads=await Promise.all([first,second,first].map(id=>call('/api/scan-batches/'+id)));
 for(const read of reads)assert.equal(read.status,200,JSON.stringify(read.data));
 assert.equal(reads[0].data.cards.length,4,'manually deleted, duplicate and removed cards stay out of the entry');
 assert.equal(checkouts,3);
 assert.equal(mostHeld,1,'one entry read holds a connection at a time');
 assert.deepEqual({slots:readLane.stats().slots,served:readLane.stats().served,active:readLane.stats().active,waiting:readLane.stats().waiting},{slots:1,served:3,active:0,waiting:0});
 // The progress poll answers outside the entry lane, on one held connection, and tabs asking for
 // the same entry at the same time share one read.
 held=0;mostHeld=0;checkouts=0;
 const polls=await Promise.all([first,first,first].map(id=>call('/api/scan-batches/'+id+'?progress=1')));
 for(const poll of polls){assert.equal(poll.status,200,JSON.stringify(poll.data));assert.equal(poll.data.progress,true);}
 assert.equal(checkouts,1,'three polls of one entry take one connection once');
 assert.equal(readLane.stats().served,3,'polls stay outside the entry read lane');
 assert.deepEqual({served:progressLane.stats().served,shared:progressLane.stats().shared},{served:1,shared:2});
 assert.equal(polls[0].data.cards.reduce((sum,row)=>sum+row.trip_total,0),12,'the list total is the one the progress read adds up');
 // A poll within the share window reuses the finished read; another entry is its own read.
 const again=await call('/api/scan-batches/'+first+'?progress=1');assert.equal(again.status,200);assert.equal(progressLane.stats().cached,1);
 const other=await call('/api/scan-batches/'+second+'?progress=1');assert.equal(other.status,200);assert.equal(progressLane.stats().served,2);assert.equal(checkouts,2);
});
