import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {VLB_CARD_COUNTER_SCHEMA,allocateVlbCardNumber,formatVlbCardNumber} from '../vlb-card-number.mjs';
import {previewBookNumber,scanBookPreviewSequence} from '../book-number-preview.mjs';
import {LOG_BOOK_SCHEMA,insertLogBook} from '../log-book.mjs';
import {randomUUID} from 'node:crypto';

test('source card formats preserve date ordinals and support sequences beyond 999',()=>{
 assert.equal(formatVlbCardNumber('2026-10-29','I',1,'M'),'VLB_M/29TH-OCT26/S1/001');
 assert.equal(formatVlbCardNumber('2026-10-29','I',1,'S'),'VLB_S/29TH-OCT26/S1/001');
 for(const [day,suffix] of [[1,'ST'],[2,'ND'],[3,'RD'],[11,'TH'],[12,'TH'],[13,'TH'],[21,'ST'],[22,'ND'],[23,'RD'],[31,'ST']])assert.equal(formatVlbCardNumber('2026-10-'+String(day).padStart(2,'0'),'II',1000,'S'),`VLB_S/${day}${suffix}-OCT26/S2/1000`);
 assert.throws(()=>formatVlbCardNumber('2026-02-30','I',1));
 assert.throws(()=>formatVlbCardNumber('2026-10-29','S4',1));
});
test('counters are independent per source, date and shift and failed transactions consume no number',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(VLB_CARD_COUNTER_SCHEMA);
 const input={bookDate:'2026-10-29',bookShiftCode:'S1'};
 assert.equal(await allocateVlbCardNumber(db,input),'VLB_M/29TH-OCT26/S1/001');
 assert.equal(await allocateVlbCardNumber(db,{...input,scanCardId:'scan'}),'VLB_S/29TH-OCT26/S1/001');
 assert.equal(await allocateVlbCardNumber(db,input),'VLB_M/29TH-OCT26/S1/002');
 assert.equal(await allocateVlbCardNumber(db,{...input,cardShift:'II',bookShiftCode:''}),'VLB_M/29TH-OCT26/S2/001');
 assert.equal(await allocateVlbCardNumber(db,{...input,bookDate:'2026-10-30'}),'VLB_M/30TH-OCT26/S1/001');
 await db.exec('BEGIN');assert.equal(await allocateVlbCardNumber(db,input),'VLB_M/29TH-OCT26/S1/003');await db.exec('ROLLBACK');
 assert.equal(await allocateVlbCardNumber(db,input),'VLB_M/29TH-OCT26/S1/003');
});
test('scan preview counts only pending cards in the same date and shift',()=>{
 const draft={bookDate:'2026-10-29',cardShift:'I'},card={ordinal:5},options={vehicleCardCounters:{S:{'2026-10-29/S1':7},M:{'2026-10-29/S1':99}},shifts:[]};
 const cards=[{ordinal:1,status:'review',draft},{ordinal:2,status:'posted',draft},{ordinal:3,status:'review',draft:{...draft,cardShift:'II'}},{ordinal:4,status:'review',draft:{...draft,bookDate:'2026-10-28'}},{ordinal:5,status:'approved',draft}];
 const n=scanBookPreviewSequence('vehicle',options,cards,card,draft);assert.equal(n,9);assert.equal(previewBookNumber('vehicle',draft,n),'VLB_S/29TH-OCT26/S1/009');
 assert.equal(previewBookNumber('vehicle',draft,1,'','M'),'VLB_M/29TH-OCT26/S1/001');
});
test('schema upgrade retains legacy IDs while real manual and scan inserts use independent counters',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(LOG_BOOK_SCHEMA);
 const old='CAL/VLB/291026/S1/0015';
 await db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,request_key,created_by) VALUES($1,'vehicle','2026-10-29','Sasti OC',1,'{}',$2,'legacy')",[old,randomUUID()]);
 await db.query("INSERT INTO mis_vlb_series_counters VALUES('2026-10-29',15)");
 await db.exec(LOG_BOOK_SCHEMA);
 const input={bookDate:'2026-10-29',location:'Sasti OC',assetId:1,bookShiftCode:'S1'};
 const client={query:(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args)};
 const manual=await insertLogBook(client,'vehicle',input,randomUUID(),'manual-user');
 const scan=await insertLogBook(client,'vehicle',{...input,scanCardId:randomUUID()},randomUUID(),'scan-user');
 assert.equal(manual.book_no,'VLB_M/29TH-OCT26/S1/001');assert.equal(scan.book_no,'VLB_S/29TH-OCT26/S1/001');
 assert.equal((await db.query("SELECT book_no FROM mis_log_books WHERE created_by='legacy'")).rows[0].book_no,old);
 assert.equal((await db.query('SELECT last_number FROM mis_vlb_series_counters')).rows[0].last_number,15);
});
