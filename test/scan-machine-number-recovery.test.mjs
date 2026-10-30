import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {recoverMissingEquipmentNumbers} from '../scan-machine-number-recovery.mjs';

test('only untouched prefix-only trip extractions are requeued once, retaining header corrections',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec("CREATE TABLE mis_scan_batches(id TEXT PRIMARY KEY,kind TEXT);CREATE TABLE mis_scan_cards(id TEXT PRIMARY KEY,batch_id TEXT,status TEXT,checked_by TEXT,logbook_id INTEGER,error TEXT,revision INTEGER,draft JSONB,raw_fields JSONB);INSERT INTO mis_scan_batches VALUES('batch','vehicle'),('elb','equipment')");
 const trips=[{rowNumber:1,equipmentName:'V',loadingTime:'05:51',unloadingTime:'06:04',tripCount:1}];
 const insert=async(id,overrides={})=>{
  const draft={trips,remark:'Keep header correction',...overrides.draft},raw={gemini:{},extractionDraft:{trips},...overrides.raw};
  await db.query('INSERT INTO mis_scan_cards VALUES($1,$2,$3,$4,$5,$6,7,$7,$8)',[id,overrides.batch||'batch',overrides.status||'review',overrides.checked||null,overrides.logbook||null,'',JSON.stringify(draft),JSON.stringify(raw)]);
 };
 await insert('recover');
 await insert('resolved',{draft:{trips:[{...trips[0],equipmentName:'V5'}]}});
 await insert('edited-trip',{draft:{trips:[{...trips[0],loadingTime:'05:55'}]}});
 await insert('posted',{status:'posted',logbook:9});await insert('rejected',{status:'rejected'});
 await insert('checked',{checked:'admin'});await insert('already-retried',{raw:{equipmentNumberRecoveryVersion:1}});
 await insert('equipment',{batch:'elb'});
 const result=await recoverMissingEquipmentNumbers(db);assert.deepEqual(result.rows.map(row=>row.id),['recover']);
 const row=(await db.query("SELECT * FROM mis_scan_cards WHERE id='recover'")).rows[0];
 assert.equal(row.status,'queued');assert.equal(row.revision,8);assert.equal(row.raw_fields.reextractPrevious.remark,'Keep header correction');
 assert.deepEqual(row.draft.trips,trips);assert.equal(row.raw_fields.equipmentNumberRecoveryVersion,1);assert.equal(row.raw_fields.scanQueueOrigin,'repair');
 await db.query("UPDATE mis_scan_cards SET status='review' WHERE id='recover'");
 assert.equal((await recoverMissingEquipmentNumbers(db)).rows.length,0);
});
