import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCAN_QUEUE_SCHEMA,claimNextScanCard,requestScanBatch} from '../scan-extraction-queue.mjs';
async function setup(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE mis_scan_batches(id TEXT PRIMARY KEY,created_at TIMESTAMPTZ DEFAULT '2026-01-01T00:00:00Z');
 CREATE TABLE mis_scan_cards(id TEXT PRIMARY KEY,batch_id TEXT,status TEXT,created_at TIMESTAMPTZ,ordinal INTEGER,raw_fields JSONB DEFAULT '{}');
 INSERT INTO mis_scan_batches(id) VALUES('old'),('fresh'),('other');`);
 await db.exec(SCAN_QUEUE_SCHEMA);
 const add=async(id,batch,ordinal,raw={},status='queued')=>db.query('INSERT INTO mis_scan_cards(id,batch_id,status,created_at,ordinal,raw_fields) VALUES($1,$2,$3,$4,$5,$6)',[id,batch,status,'2026-01-01T00:00:00Z',ordinal,JSON.stringify(raw)]);
 return {db,add,claim:async()=> (await claimNextScanCard(db)).rows[0]};
}
test('fresh upload starts ahead of a backlog of automatic equipment-number rereads',async t=>{
 const {db,add,claim}=await setup(t);
 for(let n=1;n<=15;n++)await add('repair-'+n,'old',n,{equipmentNumberRecoveryVersion:1});
 await add('new-card','fresh',20);await requestScanBatch(db,'fresh');
 assert.equal((await claim()).id,'new-card');
 assert.equal((await db.query("SELECT count(*)::int AS n FROM mis_scan_cards WHERE batch_id='old' AND status='queued'")).rows[0].n,15);
});
test('workers share batches and preserve printed order within a batch',async t=>{
 const {db,add,claim}=await setup(t);
 await add('old-1','old',1);await add('old-2','old',2);await add('other-1','other',1);
 assert.equal((await claim()).id,'old-1');
 assert.equal((await claim()).id,'other-1');
 await db.query("UPDATE mis_scan_cards SET status='review' WHERE status='reading'");
 assert.equal((await claim()).id,'old-2');
 assert.equal(await claim(),undefined);
});
test('the open batch is served ahead of another large upload without modifying finished cards',async t=>{
 const {db,add,claim}=await setup(t);
 for(let n=1;n<=15;n++)await add('old-'+n,'old',n);
 await add('fresh-1','fresh',20);await add('saved','fresh',21,{},'posted');await add('rejected','fresh',22,{},'rejected');
 await requestScanBatch(db,'fresh');assert.equal((await claim()).id,'fresh-1');
 assert.equal((await claim()).id,'old-1');
 assert.deepEqual((await db.query("SELECT status FROM mis_scan_cards WHERE id IN('saved','rejected') ORDER BY id")).rows.map(r=>r.status),['rejected','posted']);
});
test('manual retries override the legacy repair marker and rejoin foreground work',async t=>{
 const {add,claim}=await setup(t);
 await add('repair','old',1,{scanQueueOrigin:'repair',equipmentNumberRecoveryVersion:1});
 await add('retry','fresh',2,{scanQueueOrigin:'user',equipmentNumberRecoveryVersion:1});
 assert.equal((await claim()).id,'retry');assert.equal((await claim()).id,'repair');
});
