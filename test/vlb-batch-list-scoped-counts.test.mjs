import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {readVlbBatchListCounts} from '../server/rules/vlb-card-counts.mjs';
import {registerVlbBatches} from '../server/routes/vlb-batches.mjs';

test('scoped list counts retain the original active VLB/ELB predicates without changing snapshots',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE mis_log_books(id INT,book_type TEXT,book_date DATE,deleted_at TIMESTAMPTZ); CREATE TABLE mis_vlb_batch_entries(batch_id UUID,logbook_id INT); CREATE TABLE mis_elb_batch_entries(batch_id UUID,logbook_id INT)');
 const ids=[randomUUID(),randomUUID(),randomUUID()];
 for(const [id,type,date,deleted] of [[1,'vehicle','2026-11-02',null],[2,'vehicle','2026-11-02','2026-11-03'],[3,'equipment','2026-11-02',null],[4,'vehicle','2026-10-31',null],[5,'equipment','2026-11-02',null],[6,'equipment','2026-11-02','2026-11-03'],[7,'vehicle','2026-11-02',null]])await db.query('INSERT INTO mis_log_books VALUES($1,$2,$3,$4)',[id,type,date,deleted]);
 for(const id of [1,2,3,4])await db.query('INSERT INTO mis_vlb_batch_entries VALUES($1,$2)',[ids[0],id]);
 for(const id of [5,6])await db.query('INSERT INTO mis_elb_batch_entries VALUES($1,$2)',[ids[0],id]);
 await db.query('INSERT INTO mis_vlb_batch_entries VALUES($1,7)',[ids[1]]);
 const counts=await readVlbBatchListCounts(db,[ids[0],ids[2]]);
 assert.deepEqual(new Map(counts.map(r=>[r.id,[r.entry_count,r.elb_entry_count]])),new Map([[ids[0],[1,1]],[ids[2],[0,0]]]));
 assert.deepEqual(await readVlbBatchListCounts({query(){throw Error('empty scope must not read counts')}},[]),[]);
 await db.query('UPDATE mis_log_books SET deleted_at=NULL WHERE id=2');
 assert.equal((await readVlbBatchListCounts(db,[ids[0]]))[0].entry_count,2);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_vlb_batch_entries')).rows[0].n,5);
});

test('list count sharing isolates sites, preserves restricted-owner notices, and clears after batch actions',async t=>{
 const rows=[{id:randomUUID(),name:'Sasti batch',site:'Sasti OC',report_date:'2026-11-02',stage:'vlb_open',closed_at:null,created_by:'moved'}, {id:randomUUID(),name:'Jayant batch',site:'Jayant OC',report_date:'2026-11-02',stage:'vlb_open',closed_at:null,created_by:'other'}];
 let metadataReads=0;const counted=[];
 const pool={query:async(sql,args)=>{
  if(sql.includes('SELECT b.*,b.book_date::text AS report_date')){metadataReads++;return {rows:structuredClone(rows)};}
  if(sql.includes('SELECT unnest($1::uuid[])')){counted.push(args[0]);return {rows:args[0].map(id=>({id,entry_count:id===rows[0].id?7:2,elb_entry_count:1}))};}
  return {rows:[]};
 }};
 const app=express();app.use(express.json());
 registerVlbBatches(app,{pool,ensureBooks:async()=>{},listCacheMs:60000,getActor:async session=>({login:session.login,mis:true}),protect:[(req,res,next)=>{const who=req.headers.authorization;req.session={login:who};req.logBookScope={sites:who==='empty'?[]:who==='jayant'||who==='moved'?['jayant ob']:['sasti ob']};next();}]});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const read=async(who,method='GET')=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/vlb-batches',{method,headers:{Authorization:who,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});return response.json();};
 const [first,second]=await Promise.all([read('alice'),read('bob')]);
 assert.equal(metadataReads,1);assert.deepEqual(counted,[[rows[0].id]]);
 assert.equal(first.batches[0].entry_count,7);assert.deepEqual(first.batches,second.batches);
 const moved=await read('moved');assert.deepEqual(moved.batches.map(b=>b.id),[rows[1].id]);assert.deepEqual(moved.openBatch,{id:rows[0].id,restricted:true});
 assert.equal(moved.batches[0].entry_count,2);assert.equal(moved.openBatchStatuses.length,2);
 assert.deepEqual((await read('empty')).batches,[]);assert.equal(counted.length,2);
 assert.ok(rows.every(row=>!Object.hasOwn(row,'entry_count')),'a scoped response must never mutate shared metadata');
 await read('alice','POST');await read('alice');
 assert.equal(metadataReads,2);assert.equal(counted.length,3,'batch actions invalidate metadata and its count reads');
});
