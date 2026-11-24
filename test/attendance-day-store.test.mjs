// Stored locked days (owner, 16 Nov 2026): a locked site-day's attendance card fields are stored once and used while they
// still match; an edit, a reopen or a relock makes the day read live until the sweep stores it again.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {ATTENDANCE_DAY_STORE_SCHEMA,attendanceDayStoreSweep,cardSignatures,lockedDayCards,dayCardBatchesText,attendanceDayStoreEnabled} from '../server/services/attendance-day-store.mjs';
import {lockedSiteDays} from '../server/rules/manpower-report.mjs';

const SITE='Sasti OC',D10='2026-11-10',D11='2026-11-11';
async function database(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_no TEXT,book_type TEXT NOT NULL,book_date DATE NOT NULL,site TEXT NOT NULL,asset_id BIGINT NOT NULL,
   data JSONB NOT NULL,deleted_at TIMESTAMPTZ,revision INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE mis_vlb_batches(id BIGSERIAL PRIMARY KEY,name TEXT,site TEXT,book_date DATE,shift TEXT,stage TEXT,closed_at TIMESTAMPTZ,closure_revision INTEGER NOT NULL DEFAULT 0,
   deleted_at TIMESTAMPTZ,archived_at TIMESTAMPTZ);
  CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);`+ATTENDANCE_DAY_STORE_SCHEMA);
 for(const [code,name] of [['A','Shift A'],['B','Shift B'],['C','Shift C']])await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Shift Master',$1::jsonb)",[JSON.stringify({site:SITE,shiftCode:code,shiftName:name,status:'Active'})]);
 const client={query:(sql,params)=>db.query(sql,params),release(){}};
 return {db,client,pool:{connect:async()=>client}};
}
const card=(db,date,employeeId,extra={})=>db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data) VALUES($1,'vehicle',$2,$3,1,$4::jsonb) RETURNING id",
 ['CARD-'+date+'-'+employeeId,date,SITE,JSON.stringify({bookDate:date,location:SITE,employeeId,bookShiftCode:'S1',totalTrips:4,trips:[{tripCount:4}],manualAttachments:['big image'],...extra})]);
const batch=(db,date,shift,closed=true)=>db.query("INSERT INTO mis_vlb_batches(name,site,book_date,shift,stage,closed_at,closure_revision) VALUES($1,$2,$3,$4,$5,$6,$7)",
 [date+' '+shift,SITE,date,shift,closed?'closed':'vlb_open',closed?date+'T23:00:00Z':null,closed?1:0]);
// What the attendance read gets for 10 and 11 Nov: the locked days' cards, how many days came from the store and how many live.
async function read(client,{useStore=true}={}){
 const shifts=(await client.query("SELECT id,record_data FROM master_records WHERE master_name='Shift Master'")).rows.map(r=>({...r.record_data,id:String(r.id)}));
 const batches=(await client.query("SELECT id,name,site,book_date::text AS report_date,closed_at,shift,stage,closure_revision FROM mis_vlb_batches WHERE deleted_at IS NULL AND archived_at IS NULL")).rows;
 const signatures=await cardSignatures(client,{from:D10,to:D11},null,batches);
 return lockedDayCards(client,{from:D10,to:D11},{sites:null,locked:lockedSiteDays(shifts,batches),signatures,useStore});
}
const sweep=pool=>attendanceDayStoreSweep({pool,now:()=>Date.parse('2026-11-16T10:00:00Z'),log:{error(){}}});
const employees=result=>result.rows.map(r=>r.data.employeeId).sort();

test('a locked site-day is stored once, used while it matches, and read live after an edit until it is stored again',async t=>{
 const {db,client,pool}=await database(t);
 for(const shift of ['S1','S2','S3'])await batch(db,D10,shift);
 await batch(db,D11,'S1');await batch(db,D11,'S2');await batch(db,D11,'S3',false);
 const first=(await card(db,D10,'21')).rows[0].id;await card(db,D10,'22');await card(db,D11,'23');
 // Before the sweep: only the locked 10th is read, and live.
 let r=await read(client);assert.deepEqual([employees(r),r.stored,r.live],[['21','22'],0,1],'the 11th has Shift 3 open and is not read at all');
 assert.deepEqual(await sweep(pool).runOnce(),{checked:2,stale:1,saved:1});
 const row=(await db.query("SELECT card_count,cards FROM mis_attendance_day_cards WHERE book_date=$1",[D10])).rows[0];
 assert.equal(row.card_count,2);assert.ok(!JSON.stringify(row.cards).includes('big image'),'only the attendance fields are stored, not the images');
 r=await read(client);assert.deepEqual([employees(r),r.stored,r.live],[['21','22'],1,0],'from the store');
 assert.deepEqual(r.rows,(await read(client,{useStore:false})).rows,'the stored cards are exactly what a live read gives');
 assert.deepEqual(await sweep(pool).runOnce(),{checked:2,stale:0,saved:0},'nothing changed, nothing stored again');
 // An admin edit of a saved card in the locked day: the stored day no longer matches, so the day is read live.
 await db.query("UPDATE mis_log_books SET data=jsonb_set(data,'{totalTrips}','9'),revision=revision+1 WHERE id=$1",[first]);
 r=await read(client);assert.deepEqual([r.stored,r.live],[0,1]);assert.equal(r.rows.find(c=>c.data.employeeId==='21').data.totalTrips,9,'the edit shows at once');
 assert.equal((await sweep(pool).runOnce()).saved,1);
 r=await read(client);assert.deepEqual([r.stored,r.rows.find(c=>c.data.employeeId==='21').data.totalTrips],[1,9],'stored again with the edit');
 // A card deleted from the locked day.
 await db.query("UPDATE mis_log_books SET deleted_at=NOW(),revision=revision+1 WHERE id=$1",[first]);
 r=await read(client);assert.deepEqual([employees(r),r.stored],[['22'],0]);
});

test('a reopened day drops out, and once locked again it is read live and stored again (re-buffered)',async t=>{
 const {db,client,pool}=await database(t);
 for(const shift of ['S1','S2','S3'])await batch(db,D10,shift);
 await card(db,D10,'21');
 await sweep(pool).runOnce();
 assert.equal((await read(client)).stored,1);
 // PM approves a reopen of Shift 1: the whole day leaves the report.
 await db.query("UPDATE mis_vlb_batches SET closed_at=NULL,stage='vlb_open' WHERE book_date=$1 AND shift='S1'",[D10]);
 let r=await read(client);assert.deepEqual([r.rows.length,r.stored,r.live],[0,0,0],'a reopened day is not read');
 assert.equal((await sweep(pool).runOnce()).saved,0,'and not stored while open');
 // A card added while it was open, then locked again: the lock count rises, so the old stored day is never used again.
 await card(db,D10,'24');
 await db.query("UPDATE mis_vlb_batches SET closed_at=NOW(),stage='closed',closure_revision=closure_revision+1 WHERE book_date=$1 AND shift='S1'",[D10]);
 r=await read(client);assert.deepEqual([employees(r),r.stored,r.live],[['21','24'],0,1],'locked again: read live with the new card');
 assert.equal((await sweep(pool).runOnce()).saved,1,'and stored again by the next sweep');
 r=await read(client);assert.deepEqual([employees(r),r.stored],[['21','24'],1]);
 // Reopened and locked again with no card changed: the lock count alone makes it read live and stored again.
 await db.query("UPDATE mis_vlb_batches SET closure_revision=closure_revision+1 WHERE book_date=$1 AND shift='S2'",[D10]);
 assert.equal((await read(client)).stored,0);assert.equal((await sweep(pool).runOnce()).saved,1);assert.equal((await read(client)).stored,1);
});

test('with the switch off every locked day is read live',async t=>{
 const {db,client,pool}=await database(t);
 for(const shift of ['S1','S2','S3'])await batch(db,D10,shift);
 await card(db,D10,'21');await sweep(pool).runOnce();
 assert.deepEqual(((await read(client,{useStore:false}))).live,1);
 assert.equal(attendanceDayStoreEnabled({ATTENDANCE_DAY_STORE:'0'}),false);assert.equal(attendanceDayStoreEnabled({}),true);
});

// 24 Nov 2026: the attendance read takes the cards, their batches and the masters as JSON text built by Postgres, so the
// server's main thread unpacks nothing; a report worker does. The text must hold exactly what the row reads hold.
// (node-pg hands BIGINT columns over as text; the text read casts id and asset_id to text for the same reason.)
const asRows=pieces=>pieces.flatMap(text=>JSON.parse(text));
const sameIds=rows=>rows.map(r=>({...r,id:String(r.id),asset_id:String(r.asset_id)}));
async function readText(client,{useStore=true}={}){
 const shifts=(await client.query("SELECT id,record_data FROM master_records WHERE master_name='Shift Master'")).rows.map(r=>({...r.record_data,id:String(r.id)}));
 const batches=(await client.query("SELECT id,name,site,book_date::text AS report_date,closed_at,shift,stage,closure_revision FROM mis_vlb_batches WHERE deleted_at IS NULL AND archived_at IS NULL")).rows;
 const signatures=await cardSignatures(client,{from:D10,to:D11},null,batches);
 return lockedDayCards(client,{from:D10,to:D11},{sites:null,locked:lockedSiteDays(shifts,batches),signatures,useStore,asText:true});
}
test('the text read gives the same cards as the row read, from the store and live',async t=>{
 const {db,client,pool}=await database(t);
 for(const shift of ['S1','S2','S3'])await batch(db,D10,shift);
 await card(db,D10,'21',{operatorSplit:{secondOperatorId:22}});await card(db,D10,'22');await card(db,D11,'23');
 const live=await readText(client);
 assert.deepEqual([live.stored,live.live,live.days.map(d=>d.date)],[0,1,[D10]],'only the locked 10th');
 assert.deepEqual(sameIds(asRows(live.cardsJson)),sameIds((await read(client)).rows),'live: same cards, same fields, same order');
 assert.ok(!live.cardsJson.join('').includes('big image'),'only the attendance fields');
 await sweep(pool).runOnce();
 const stored=await readText(client);
 assert.deepEqual([stored.stored,stored.live],[1,0]);
 assert.deepEqual(sameIds(asRows(stored.cardsJson)),sameIds((await read(client)).rows),'stored: same cards');
 const none=await readText(client,{useStore:false});
 assert.deepEqual(sameIds(asRows(none.cardsJson)),sameIds(asRows(live.cardsJson)));
});
test('the batches of the read cards and the masters come as text with what the row reads gave',async t=>{
 const {db,client}=await database(t);
 await db.exec('CREATE TABLE mis_vlb_batch_entries(batch_id BIGINT,logbook_id BIGINT)');
 for(const shift of ['S1','S2','S3'])await batch(db,D10,shift);
 const a=(await card(db,D10,'21')).rows[0].id,b=(await card(db,D10,'22')).rows[0].id,other=(await card(db,D11,'23')).rows[0].id;
 const ids=(await db.query('SELECT id,shift FROM mis_vlb_batches ORDER BY id')).rows;
 await db.query('INSERT INTO mis_vlb_batch_entries VALUES($1,$2),($3,$2),($1,$4)',[ids[1].id,a,ids[0].id,other]);
 await db.query("UPDATE mis_vlb_batches SET archived_at=NOW() WHERE id=$1",[ids[2].id]);await db.query('INSERT INTO mis_vlb_batch_entries VALUES($1,$2)',[ids[2].id,b]);
 const links=JSON.parse(await dayCardBatchesText(client,[{site:SITE,date:D10}]));
 assert.deepEqual(Object.keys(links),[String(a)],'only cards of the listed days, and no archived batch');
 assert.deepEqual(links[String(a)].map(x=>x.name),[D10+' S1',D10+' S2'],'in batch order');
 assert.equal(await dayCardBatchesText(client,[]),'{}');
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Employee master',$1::jsonb),('Equipment master',$2::jsonb),('ERP Employee master',$3::jsonb),('Other master',$4::jsonb)",
  [JSON.stringify({id:'old',caliberId:'101',name:'Driver One'}),JSON.stringify({door:'V1',group:'Tipper'}),JSON.stringify({caliberId:'102'}),JSON.stringify({x:1})]);
 const {reportMasters,reportMastersText}=await import('../server/routes/manpower-report-api.mjs');
 const rows=await reportMasters(client),text=await reportMastersText(client);
 assert.deepEqual(JSON.parse(text.mastersJson),rows,'assets, employees and shifts as before, id = the row id as text');
 assert.deepEqual(text.shifts,rows.shifts);
});
