import assert from 'node:assert/strict';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {assertCombinedShiftMeters} from '../server/rules/log-book-shift-hmr.mjs';

test('ELB combined HMR counts only live cards linked to the same operational batch',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE mis_log_books(id BIGINT PRIMARY KEY,book_no TEXT,book_type TEXT,book_date DATE,site TEXT,asset_id BIGINT,data JSONB,deleted_at TIMESTAMPTZ);
  CREATE TABLE mis_vlb_batches(id TEXT PRIMARY KEY,name TEXT);
  CREATE TABLE mis_elb_batch_entries(batch_id TEXT,logbook_id BIGINT PRIMARY KEY);`);
 await db.query("INSERT INTO mis_vlb_batches VALUES('current','CMLL/DUDHICHUA OC/1ST-NOV-26/S2/B02'),('other','CMLL/DUDHICHUA OC/1ST-NOV-26/S2/B01')");
 const add=async(id,bookNo,hours,batch,deleted=false)=>{
  const data={bookDate:'2026-11-01',location:'Dudhichua OC',assetId:'102',door:'VPC102-86286',bookShiftCode:'S2',shiftHours:8,totalWorkingHmr:hours};
  await db.query("INSERT INTO mis_log_books VALUES($1,$2,'equipment','2026-11-01','Dudhichua OC',102,$3,$4)",[id,bookNo,data,deleted?new Date():null]);
  if(batch)await db.query('INSERT INTO mis_elb_batch_entries VALUES($1,$2)',[batch,id]);
 };
 await add(1,'CAL/ELB/01-11-26/001',5.9,'other');
 await add(2,'CAL/ELB/01-11-26/002',5.9,null);
 await add(3,'CAL/ELB/01-11-26/003',5.9,'current',true);
 await add(4,'CAL/ELB/01-11-26/004',2,'current');
 const input={bookDate:'2026-11-01',location:'Dudhichua OC',assetId:'102',door:'VPC102-86286',bookShiftCode:'S2',shiftHours:8,totalWorkingHmr:5.9};
 await assert.doesNotReject(()=>assertCombinedShiftMeters(db,'equipment',input,null,{id:'current'}),'another batch, an orphan and a deleted card are excluded');
 await db.query("UPDATE mis_log_books SET data=data || '{\"breakdownHours\":2,\"breakdownHoursSource\":\"pulse\"}'::jsonb WHERE id=4");
 const relief={...input,totalWorkingHmr:4,breakdownHours:2,breakdownHoursSource:'pulse'};
 await assert.doesNotReject(()=>assertCombinedShiftMeters(db,'equipment',relief,null,{id:'current'}),'both cards may carry the same two Pulse BD hours');
 await assert.rejects(()=>assertCombinedShiftMeters(db,'equipment',{...relief,totalWorkingHmr:4.01},null,{id:'current'}),{status:409,details:{code:'shift_hmr_breakdown_limit'}});
 await add(5,'CAL/ELB/01-11-26/005',0.2,'current');
 await assert.rejects(()=>assertCombinedShiftMeters(db,'equipment',input,null,{id:'current'}),error=>{
  assert.equal(error.details.code,'shift_hmr_limit');
  assert.deepEqual(error.details.conflicts.map(row=>row.bookNo),['CAL/ELB/01-11-26/004','CAL/ELB/01-11-26/005']);
  assert.match(error.message,/CAL\/ELB\/01-11-26\/004 in CMLL\/DUDHICHUA OC\/1ST-NOV-26\/S2\/B02/);
  assert.doesNotMatch(error.message,/\/001|\/002|\/003/);
  return true;
 });
});
