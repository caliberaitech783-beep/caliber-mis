// Stored closed days for the Operations step reports (owner, 18 Nov 2026): a locked site-day's cards are stored cut down
// to what the step reports read; a stored day is used only while it matches, an edit, reopen or relock makes it read
// live until the sweep stores it again, and after 04:30 IST the sweep goes through every locked day.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {OPERATIONS_DAY_STORE_SCHEMA,OPERATIONS_RECORD_FIELDS,operationsDayStoreSweep,operationsDayRecords,operationsStepRecords,sortStepRecords,operationsDayStoreEnabled} from '../server/services/operations-day-store.mjs';
import {logBooksForOperations} from '../server/routes/log-book.mjs';
import {withVlbTripCounts} from '../shared/vlb-trip-handover.mjs';
import {normalise,filterRecords,buildOperationReport} from '../src/operations-report-model.mjs';
import {STEP_REPORTS,stepItems,stepLines} from '../src/saved-report-steps-model.mjs';

const SITE='Sasti OC',D10='2026-11-10',D11='2026-11-11',D12='2026-11-12';
const assets=[{id:'1',door:'V101',site:SITE,group:'TIPPER'},{id:'2',door:'V102',site:SITE,group:'TIPPER'},{id:'3',door:'EX7',site:SITE,group:'EXCAVATOR'}];
const shifts=[{id:'11',site:SITE,name:'Shift A'},{id:'12',site:SITE,name:'Shift B'},{id:'13',site:SITE,name:'Shift C'}];
// A saved card as the database holds it: everything the entry and scan screens keep, with its trip rows.
const full=(id,type,date,extra={})=>({id,book_no:'B'+id,book_type:type,data:{bookDate:date,location:SITE,shiftName:'shift a',shiftId:'11',assetId:type==='vehicle'?'1':'3',door:type==='vehicle'?'V101':'EX7',
 caliberId:'C'+id,employeeName:'SAMPLE '+id,employeeId:'E'+id,workOrderContract:'WO-1',openingKmr:100,closingKmr:140,openingHmr:10,closingHmr:16,shiftHours:8,remark:'',breakdownHours:0,
 breakdownHoursSource:'pulse',masterShiftStart:'05:00',hoursSource:{big:'x'.repeat(80)},scanMachineSummary:'m',meterCorrectionHistory:[1,2],pulseBreakdowns:[{id:1}],autoSavedBy:'x',
 trips:type==='vehicle'?[{tripCount:2,loadingTime:'06:00',unloadingTime:'06:40',equipmentName:'EX7',handoverLinks:[]},{tripCount:1,loadingTime:'07:00'},{tripCount:3,unloadingTime:'08:00'}]:[{completedTrips:2},{tripCount:3}],...extra}});

test('every step report is the same from the stored cut-down cards as from whole cards',()=>{
 const rows=[full(1,'vehicle',D10),full(2,'vehicle',D10,{assetId:'2',door:'V102',closingHmr:40,hoursWarning:'Check HMR'}),full(3,'equipment',D10),full(4,'vehicle',D11,{timeMode:'without',shiftId:'12',shiftName:'Shift B',replacementKmr:30}),
  full(5,'equipment',D11,{completedTrips:'7',shiftId:'12',shiftName:'Shift B'}),full(6,'vehicle',D11,{openingKmr:null,breakdownHours:null,breakdownHoursSource:'manual'}),full(7,'equipment',D12,{totalTrips:4,trips:undefined}),full(8,'vehicle','',{})];
 const whole=logBooksForOperations([...withVlbTripCounts(rows.filter(r=>r.book_type==='vehicle')),...rows.filter(r=>r.book_type!=='vehicle')]);
 const cut=sortStepRecords(operationsStepRecords(rows));
 assert.ok(cut.every(r=>Object.keys(r.data).every(k=>OPERATIONS_RECORD_FIELDS.includes(k)||k==='completedTrips')),'only the fields the reports read are kept');
 assert.ok(JSON.stringify(cut).length<JSON.stringify(whole).length,'smaller than the full reading’s cards: each card’s trip rows become one count');
 const filters={from:D10,to:D12,site:'',shift:'',asset:'',employee:'',workOrder:''};
 for(const id of STEP_REPORTS.filter(id=>id!=='scans'))for(const monthly of [false,true]){
  const a=filterRecords(normalise(whole),filters),b=filterRecords(normalise(cut),filters);
  const ra=buildOperationReport(id,a,{assets,shifts,filters,monthly}),rb=buildOperationReport(id,b,{assets,shifts,filters,monthly});
  assert.deepEqual(rb,ra,id);
  const ia=stepItems(id,{records:a,report:ra,assets,shifts}),ib=stepItems(id,{records:b,report:rb,assets,shifts});
  for(const by of ['site','slot','category'])assert.deepEqual(stepLines(ib,by),stepLines(ia,by),id+' '+by);
 }
 assert.deepEqual(normalise(cut).map(r=>r.tripsTotal),normalise(whole).map(r=>r.tripsTotal));
});

async function database(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_no TEXT,book_type TEXT NOT NULL,book_date DATE NOT NULL,site TEXT NOT NULL,asset_id BIGINT NOT NULL,
   data JSONB NOT NULL,deleted_at TIMESTAMPTZ,revision INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE mis_vlb_batches(id BIGSERIAL PRIMARY KEY,name TEXT,site TEXT,book_date DATE,shift TEXT,stage TEXT,closed_at TIMESTAMPTZ,closure_revision INTEGER NOT NULL DEFAULT 0,
   deleted_at TIMESTAMPTZ,archived_at TIMESTAMPTZ);
  CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);`+OPERATIONS_DAY_STORE_SCHEMA);
 for(const [code,name] of [['A','Shift A'],['B','Shift B'],['C','Shift C']])await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Shift Master',$1::jsonb)",[JSON.stringify({site:SITE,shiftCode:code,shiftName:name,status:'Active'})]);
 const client={query:(sql,params)=>db.query(sql,params),release(){}};
 return {db,client,pool:{connect:async()=>client,query:client.query}};
}
const card=(db,type,date,extra={})=>db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data) VALUES($1,$2,$3,$4,1,$5::jsonb) RETURNING id",
 ['CARD-'+date+'-'+Math.random().toString(36).slice(2,8),type,date,SITE,JSON.stringify(full(0,type,date,extra).data)]);
const batch=(db,date,shift,closed=true)=>db.query("INSERT INTO mis_vlb_batches(name,site,book_date,shift,stage,closed_at,closure_revision) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
 [date+' '+shift,SITE,date,shift,closed?'closed':'vlb_open',closed?date+'T23:00:00Z':null,closed?1:0]);
const sweepAt=(pool,iso,options={})=>operationsDayStoreSweep({pool,now:()=>Date.parse(iso),log:{error(){}},...options});
const read=(client,useStore=true)=>operationsDayRecords(client,{from:D10,to:D12},{useStore});
const same=async client=>assert.deepEqual((await read(client)).records,(await read(client,false)).records,'stored days give exactly what a live read gives');

test('a locked day is stored and used while it matches; an edit, a reopen and a relock read it live until it is stored again',async t=>{
 const {db,client,pool}=await database(t);
 for(const shift of ['S1','S2','S3'])await batch(db,D10,shift);
 await batch(db,D11,'S1');await batch(db,D11,'S2',false);
 const edited=(await card(db,'vehicle',D10)).rows[0].id;await card(db,'equipment',D10);await card(db,'vehicle',D11);
 assert.deepEqual([(await read(client)).stored,(await read(client)).live],[0,2],'nothing stored yet: both days read live');
 const sweep=sweepAt(pool,'2026-11-16T10:00:00Z');
 assert.equal((await sweep.runOnce()).saved,1,'only the locked 10th is stored; the 11th still has an open batch');
 assert.deepEqual([(await read(client)).stored,(await read(client)).live],[1,1]);await same(client);
 // An edit raises the card's revision: the stored 10th no longer matches and is read live, with the edit.
 await db.query("UPDATE mis_log_books SET data=jsonb_set(data,'{closingHmr}','18'),revision=revision+1 WHERE id=$1",[edited]);
 let now=await read(client);assert.equal(now.stored,0);assert.ok(now.records.some(r=>r.data.closingHmr===18));
 assert.equal((await sweep.runOnce()).saved,1);assert.equal((await read(client)).stored,1);await same(client);
 // Reopened: read live and not stored while open; locked again (lock count 2): stored again.
 const s2=(await db.query("SELECT id FROM mis_vlb_batches WHERE book_date=$1 AND shift='S2'",[D10])).rows[0].id;
 await db.query('UPDATE mis_vlb_batches SET closed_at=NULL WHERE id=$1',[s2]);
 assert.equal((await read(client)).stored,0);assert.equal((await sweep.runOnce()).saved,0);
 await db.query("UPDATE mis_vlb_batches SET closed_at=NOW(),closure_revision=2 WHERE id=$1",[s2]);
 assert.equal((await read(client)).stored,0,'a relocked batch does not reuse the copy stored before');
 assert.equal((await sweep.runOnce()).saved,1);assert.equal((await read(client)).stored,1);await same(client);
 // A card deleted from a stored day: it no longer matches.
 await db.query('UPDATE mis_log_books SET deleted_at=NOW() WHERE id=$1',[edited]);
 assert.equal((await read(client)).stored,0);await same(client);
});

test('the sweep stores 40 days a run, and after 04:30 IST once a day it goes through every locked day',async t=>{
 const {db,client,pool}=await database(t);
 for(const date of [D10,D11,D12]){for(const shift of ['S1','S2','S3'])await batch(db,date,shift);await card(db,'vehicle',date);}
 // 03:30 IST: a normal run, one day a run here.
 let sweep=sweepAt(pool,'2026-11-16T22:00:00Z',{perPass:1});
 let run=await sweep.runOnce();assert.deepEqual([run.saved,run.nightly],[1,false]);
 // 04:35 IST: the morning run takes every day left.
 sweep=sweepAt(pool,'2026-11-16T23:05:00Z',{perPass:1});
 run=await sweep.runOnce();assert.deepEqual([run.saved,run.nightly],[2,true]);
 assert.equal((await read(client)).stored,3);
 // The same morning again: back to normal runs.
 run=await sweep.runOnce();assert.equal(run.nightly,false);
 assert.equal(operationsDayStoreEnabled({OPERATIONS_DAY_STORE:'0'}),false);assert.equal(operationsDayStoreEnabled({}),true);
});
