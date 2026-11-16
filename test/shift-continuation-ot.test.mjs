import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
import {SCAN_SCHEMA} from '../server/routes/bulk-card-scanning.mjs';
import {findContentDuplicate,preloadDuplicateChecks,isShiftContinuation,continuationNote} from '../server/services/scan-duplicates.mjs';

// Rule (owner, 15 Nov 2026): a driver who works Shift 1 and continues into Shift 2 (or any other
// shift that day) on the same trip card is on OT, not a duplicate driver/card.
const saved={bookDate:'2026-11-01',location:'Majri OB',door:'V1',cardShift:'I',employeeId:'7',caliberId:'CMLL3228',scanCardNumber:'A7',openingHmr:100,closingHmr:108,openingKmr:1000,closingKmr:1040};
const shift2={...saved,cardShift:'II',openingHmr:108,closingHmr:116,openingKmr:1040,closingKmr:1080};

test('the rule: another shift, same driver, different meters is a continuation',()=>{
 assert.equal(isShiftContinuation(saved,shift2),true);
 assert.equal(isShiftContinuation(saved,{...shift2,cardShift:'III'}),true,'any other shift of the day');
 assert.equal(isShiftContinuation(saved,{...shift2,cardShift:'I'}),false,'same shift stays a duplicate');
 assert.equal(isShiftContinuation(saved,{...shift2,openingHmr:100,closingHmr:108,openingKmr:1000,closingKmr:1040}),false,'identical meters are the same card saved twice');
 assert.equal(isShiftContinuation(saved,{...shift2,employeeId:'9',caliberId:'CMLL9999'}),false,'another driver is not this rule');
 assert.equal(isShiftContinuation(saved,{...shift2,employeeId:'',caliberId:''}),false,'an unread driver is not assumed to be the same');
 assert.match(continuationNote({bookNo:'MAJ/0007',shift:'S1'}),/Shift continuation.*shift 1 .*MAJ\/0007.*OT/);
});

async function harness(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 await db.exec(LOG_BOOK_SCHEMA);await db.exec(SCAN_SCHEMA);
 const client={query:(sql,args)=>!args&&sql.includes(';')?db.exec(sql):db.query(sql,args)};
 const insert=data=>db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,request_key,created_by) VALUES($1,'vehicle','2026-11-01','Majri OB',1,$2,$3,'alice') RETURNING id",['MAJ/'+randomUUID().slice(0,4),JSON.stringify(data),randomUUID()]);
 return {db,client,insert};
}
const batch={id:randomUUID(),kind:'vehicle',expected_context:{bookDate:'2026-11-01',location:'Majri OB',cardShift:'II'}};
const card={id:randomUUID(),created_at:new Date().toISOString(),draft:{bookDate:'2026-11-01',doorText:'V1',aFormNo:'A7',cardShift:'II'},raw_fields:{}};
const identity=current=>({bookDate:'2026-11-01',door:'V1',number:'A7',current});

test('a Shift 2 scan of the same trip card and driver is a continuation, not a duplicate; the save index allows it',async t=>{
 const {client,insert,db}=await harness(t);
 const first=(await insert(saved)).rows[0];
 const bookNo=(await db.query('SELECT book_no FROM mis_log_books WHERE id=$1',[first.id])).rows[0].book_no;
 const direct=await findContentDuplicate(client,'vehicle',card,batch,identity(shift2));
 assert.deepEqual(direct,{kind:'continuation',bookNo,shift:'S1'});
 const preloaded=await preloadDuplicateChecks(client,batch,[card]);
 assert.deepEqual(await preloaded.content(card,identity(shift2)),{kind:'continuation',bookNo,shift:'S1'});
 // Another driver on the same card number in Shift 2, or identical meters, is still a duplicate.
 assert.equal((await findContentDuplicate(client,'vehicle',card,batch,identity({...shift2,employeeId:'9',caliberId:'CMLL9999'}))).kind,'logbook');
 assert.equal((await preloaded.content(card,identity({...saved,cardShift:'II'}))).kind,'logbook');
 // The automatic rejection after reading never rejects a card over a saved card of another shift.
 assert.equal(await findContentDuplicate(client,'vehicle',card,batch,{...identity(null),sameShiftOnly:true}),null);
 // The database allows the Shift 2 card with the same card number, and still refuses a second Shift 1 copy.
 await insert(shift2);
 await assert.rejects(()=>insert({...saved,closingHmr:107}),error=>/duplicate key|unique/i.test(error.message));
});

test('the shift continuation note does not stop the card from saving',async()=>{
 const {blockingScanWarnings}=await import('../shared/scan-auto-save.mjs');
 const note=continuationNote({bookNo:'VLB_S/12TH-NOV26/S1/009',shift:'S1'});
 assert.deepEqual(blockingScanWarnings([note]),[]);
 assert.deepEqual(blockingScanWarnings([note,'Check the HMR.']),['Check the HMR.']);
});
