import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readVlbCardCounts,ACTIVE_VLB_ENTRY_FROM,ACTIVE_VLB_ENTRY_FILTER} from '../server/rules/vlb-card-counts.mjs';
import {validVlbCardCounts} from '../shared/vlb-card-counts.mjs';

test('119 scanned cards plus two manual records count as 121 everywhere, without counting raw scans or retained deletions',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE mis_log_books(id INT PRIMARY KEY,book_type TEXT,book_date DATE,deleted_at TIMESTAMPTZ);CREATE TABLE mis_vlb_batch_entries(batch_id TEXT,logbook_id INT PRIMARY KEY,snapshot JSONB)');
 const batch='current';
 for(let id=1;id<=125;id++){
  await db.query("INSERT INTO mis_log_books VALUES($1,'vehicle','2026-11-01',NULL)",[id]);
  if(id<=123)await db.query('INSERT INTO mis_vlb_batch_entries VALUES($1,$2,$3)',[id<=121?batch:'other',id,{data:{bookDate:'2026-11-01',...(id<=119?{scanCardId:'scan-'+id}:{})}}]);
 }
 const listTotal=async()=>(await db.query(`SELECT count(*)::int AS entry_count FROM ${ACTIVE_VLB_ENTRY_FROM} WHERE e.batch_id=$1 AND ${ACTIVE_VLB_ENTRY_FILTER}`,[batch])).rows[0].entry_count;
 const summary=await readVlbCardCounts(db,batch);
 assert.deepEqual(summary,{batchId:batch,entry_count:121,manual_count:2,scan_count:119});
 assert.equal(await listTotal(),summary.entry_count,'Create Batch and scan headline share the same SQL predicate');
 await db.query('INSERT INTO mis_vlb_batch_entries VALUES($1,1,$2) ON CONFLICT(logbook_id) DO NOTHING',[batch,{data:{scanCardId:'duplicate-upload'}}]);
 assert.equal((await readVlbCardCounts(db,batch)).entry_count,121,'duplicate upload cannot count the same saved log book twice');
 await db.query('UPDATE mis_log_books SET deleted_at=NOW() WHERE id IN(120,121)');
 assert.deepEqual(await readVlbCardCounts(db,batch),{batchId:batch,entry_count:119,manual_count:0,scan_count:119});
 assert.equal(await listTotal(),119);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_vlb_batch_entries WHERE batch_id=$1',[batch])).rows[0].n,121,'audit snapshots remain intact');
 await db.query('UPDATE mis_log_books SET deleted_at=NULL WHERE id=120');
 assert.equal((await readVlbCardCounts(db,batch)).entry_count,120);
 await db.query("UPDATE mis_log_books SET book_type='equipment' WHERE id=119");
 await db.query("UPDATE mis_log_books SET book_date='2026-10-31' WHERE id=118");
 assert.equal((await readVlbCardCounts(db,batch)).entry_count,118,'ELB records and pre-operational records do not become VLB cards');
 assert.equal((await readVlbCardCounts(db,'missing')).entry_count,0);
});

test('the browser rejects stale batch responses, unavailable totals and inconsistent breakdowns',()=>{
 const good={batchId:'one',entry_count:121,manual_count:2,scan_count:119};
 assert.equal(validVlbCardCounts(good,'one'),good);
 for(const value of [null,{}, {...good,batchId:'old'},{...good,entry_count:119},{...good,manual_count:-1},{...good,scan_count:'119'},{...good,entry_count:Infinity}])assert.equal(validVlbCardCounts(value,'one'),null);
 assert.ok(validVlbCardCounts({batchId:'one',entry_count:0,manual_count:0,scan_count:0},'one'));
});
