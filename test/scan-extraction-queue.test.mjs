import {extendOperationalScanFixture} from './operational-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCAN_QUEUE_SCHEMA,SCAN_LEASE_SCHEMA,claimNextScanCard,requestScanBatch,queuedScanBatches,renewReadLeases,requeueExpiredReads,releaseReadLeases,beatScanEngine,liveScanEngines,removeScanEngine} from '../server/services/scan-extraction-queue.mjs';
import {groupBatchesByLane,engineCovers} from '../server/rules/scan-lanes.mjs';
async function setup(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE mis_scan_batches(id TEXT PRIMARY KEY,created_at TIMESTAMPTZ DEFAULT '2026-12-01T00:00:00Z');
 CREATE TABLE mis_scan_cards(id TEXT PRIMARY KEY,batch_id TEXT,status TEXT,created_at TIMESTAMPTZ,ordinal INTEGER,raw_fields JSONB DEFAULT '{}');
 INSERT INTO mis_scan_batches(id) VALUES('old'),('fresh'),('other');`);
 await db.exec(SCAN_QUEUE_SCHEMA);await db.exec(SCAN_LEASE_SCHEMA);await extendOperationalScanFixture(db);
 const add=async(id,batch,ordinal,raw={},status='queued')=>db.query('INSERT INTO mis_scan_cards(id,batch_id,status,created_at,ordinal,raw_fields) VALUES($1,$2,$3,$4,$5,$6)',[id,batch,status,'2026-12-01T00:00:00Z',ordinal,JSON.stringify(raw)]);
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
test('a lane claims only its own site batches and holds the card with a lease',async t=>{
 const {db,add}=await setup(t);
 await db.query(`UPDATE mis_scan_batches SET expected_context=jsonb_build_object('bookDate','2026-12-01','location',CASE id WHEN 'old' THEN 'Sasti OC' WHEN 'fresh' THEN 'Majri OC' ELSE NULL END)`);
 await add('sasti-1','old',1);await add('majri-1','fresh',1);await add('nosite-1','other',1);
 const lanes=groupBatchesByLane(await queuedScanBatches(db));
 assert.deepEqual([...lanes.keys()].sort(),['','majri ob','sasti ob']);
 const majri=(await claimNextScanCard(db,{batchIds:lanes.get('majri ob'),owner:'engine-majri'})).rows[0];
 assert.equal(majri.id,'majri-1');assert.equal(majri.read_lease_owner,'engine-majri');assert.ok(majri.read_lease_until);
 assert.equal((await claimNextScanCard(db,{batchIds:lanes.get('majri ob'),owner:'engine-majri'})).rows[0],undefined,'Majri lane never takes Sasti cards');
 assert.equal((await claimNextScanCard(db,{batchIds:lanes.get('sasti ob'),owner:'engine-sasti'})).rows[0].id,'sasti-1');
});
test('restart returns only abandoned cards; a card another reader holds stays with it',async t=>{
 const {db,add}=await setup(t);
 await add('held','old',1,{},'reading');await add('expired','old',2,{},'reading');await add('legacy','old',3,{},'reading');await add('mine','old',4,{},'reading');
 await db.query(`UPDATE mis_scan_cards SET read_lease_owner='other-process',read_lease_until=NOW()+INTERVAL '2 minutes' WHERE id='held'`);
 await db.query(`UPDATE mis_scan_cards SET read_lease_owner='dead-process',read_lease_until=NOW()-INTERVAL '1 second' WHERE id='expired'`);
 await db.query(`UPDATE mis_scan_cards SET read_lease_owner='me',read_lease_until=NOW()+INTERVAL '1 second' WHERE id='mine'`);
 await requeueExpiredReads(db);
 const status=async id=>(await db.query('SELECT status FROM mis_scan_cards WHERE id=$1',[id])).rows[0].status;
 assert.equal(await status('held'),'reading');assert.equal(await status('expired'),'queued');assert.equal(await status('legacy'),'queued');assert.equal(await status('mine'),'reading');
 await renewReadLeases(db,'me');
 assert.ok((await db.query(`SELECT read_lease_until>NOW()+INTERVAL '100 seconds' AS renewed FROM mis_scan_cards WHERE id='mine'`)).rows[0].renewed);
 await releaseReadLeases(db,'me');
 assert.equal(await status('mine'),'queued');assert.equal(await status('held'),'reading','a clean stop releases only its own cards');
});
test('Pulse-II leaves a site to its running engine and covers sites with no engine',async t=>{
 const {db}=await setup(t);
 await beatScanEngine(db,{owner:'sasti',siteLane:'sasti ob'});
 await beatScanEngine(db,{owner:'others',siteLane:'*',excludedLanes:['sasti ob','majri ob']});
 const engines=await liveScanEngines(db);assert.equal(engines.length,2);
 const covered=lane=>engines.some(engine=>engineCovers(engine,lane));
 assert.equal(covered('sasti ob'),true);assert.equal(covered('jayant ob'),true,'the other-sites engine reads Jayant');
 assert.equal(covered('majri ob'),false,'Majri has no running engine, so Pulse-II reads it');
 await db.query(`UPDATE mis_scan_engines SET beat_at=NOW()-INTERVAL '2 minutes' WHERE owner='sasti'`);
 assert.equal((await liveScanEngines(db)).some(engine=>engineCovers(engine,'sasti ob')),false,'a silent engine stops counting after a minute');
 await removeScanEngine(db,'others');assert.equal((await liveScanEngines(db)).length,0);
});

test('lease renewal can be limited to the cards a worker is still reading, so an abandoned card is handed on',async t=>{
 const {db,add}=await setup(t);
 await add('working','old',1,{},'reading');await add('abandoned','old',2,{},'reading');
 await db.query(`UPDATE mis_scan_cards SET read_lease_owner='me',read_lease_until=NOW()+INTERVAL '5 seconds'`);
 await renewReadLeases(db,'me',['working']);
 const renewed=async id=>(await db.query(`SELECT read_lease_until>NOW()+INTERVAL '100 seconds' AS renewed FROM mis_scan_cards WHERE id=$1`,[id])).rows[0].renewed;
 assert.equal(await renewed('working'),true);assert.equal(await renewed('abandoned'),false);
 assert.equal((await renewReadLeases(db,'me',[])).rowCount,0);assert.equal(await renewed('abandoned'),false,'no active card renews nothing');
 await db.query(`UPDATE mis_scan_cards SET read_lease_until=NOW()-INTERVAL '1 second' WHERE id='abandoned'`);await requeueExpiredReads(db);
 assert.equal((await db.query(`SELECT status FROM mis_scan_cards WHERE id='abandoned'`)).rows[0].status,'queued');
});
