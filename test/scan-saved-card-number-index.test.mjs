import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
import {SCAN_SCHEMA} from '../server/routes/bulk-card-scanning.mjs';
import {ensureSavedCardNumberIndex,savedCardNumberIndexState,preloadDuplicateChecks,findContentDuplicate,SAVED_CARD_NUMBER_INDEX,RETIRED_CARD_NUMBER_INDEXES} from '../server/services/scan-duplicates.mjs';

const quiet={log:{log(){}}};
async function database(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);CREATE TABLE data_revisions(revision_key TEXT PRIMARY KEY,revision BIGINT NOT NULL DEFAULT 1);'+LOG_BOOK_SCHEMA);
 await db.exec(SCAN_SCHEMA);
 return db;
}

const insertBook=(db,number,door,{date='2026-11-14',field='aFormNo',type='vehicle'}={})=>db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,request_key,created_by) VALUES($1,$2,$3,'Sasti OC',1,$4::jsonb,$5,'test') RETURNING id",['VLB-'+randomUUID().slice(0,8),type,date,JSON.stringify({[field]:number,door,trips:[{loadingTime:'08:00'}]}),randomUUID()]);
const keyOf=async(db,id)=>(await db.query('SELECT card_number_key AS key FROM mis_log_books WHERE id=$1',[id])).rows[0].key;

test('the saved card number index is built once and rebuilt when a build was left invalid',async t=>{
 const db=await database(t);
 assert.equal(await ensureSavedCardNumberIndex(db,{...quiet,fillPauseMs:0}),true);
 assert.equal(await ensureSavedCardNumberIndex(db,quiet),false,'a valid index is kept');
 await db.query('UPDATE pg_index SET indisvalid=false WHERE indexrelid=$1::regclass',[SAVED_CARD_NUMBER_INDEX]);
 assert.equal(await ensureSavedCardNumberIndex(db,{...quiet,fillPauseMs:0}),true,'an invalid index is dropped and built again');
 assert.equal((await db.query('SELECT i.indisvalid AS valid FROM pg_index i WHERE i.indexrelid=$1::regclass',[SAVED_CARD_NUMBER_INDEX])).rows[0].valid,true);
 assert.equal(savedCardNumberIndexState().state,'valid');
 assert.equal(typeof savedCardNumberIndexState().usedByPlanner,'boolean');
});

test('log books saved before the column are filled, and every later save is filled by the trigger',async t=>{
 const db=await database(t);
 const before=[];
 for(let n=0;n<25;n++)before.push((await insertBook(db,'A-'+n+'/x','D'+n)).rows[0].id);
 const job=(await insertBook(db,' jc 9-1 ','E1',{field:'jobCardNo',type:'equipment'})).rows[0].id;
 await ensureSavedCardNumberIndex(db,{...quiet,fillRows:7,fillPauseMs:0});
 assert.equal(await keyOf(db,before[3]),'A3X','normalised exactly as the duplicate check compares numbers');
 assert.equal(await keyOf(db,job),'JC91');
 assert.equal(savedCardNumberIndexState().filled,26);
 assert.equal(savedCardNumberIndexState().filledUpTo,savedCardNumberIndexState().lastId);
 const later=(await insertBook(db,'77-12','D7')).rows[0].id;
 assert.equal(await keyOf(db,later),'7712','a new save gets its key from the trigger');
 await db.query(`UPDATE mis_log_books SET data=jsonb_set(data,'{scanCardNumber}','"88/5"') WHERE id=$1`,[later]);
 assert.equal(await keyOf(db,later),'885','a corrected number moves the key with it');
 await db.query('UPDATE mis_log_books SET card_number_key=NULL WHERE id=$1',[before[0]]);
 await db.query('UPDATE pg_index SET indisvalid=false WHERE indexrelid=$1::regclass',[SAVED_CARD_NUMBER_INDEX]);
 await ensureSavedCardNumberIndex(db,{...quiet,fillPauseMs:0});
 assert.equal(await keyOf(db,before[0]),'A0X','a fill run again finishes what is missing');
});

test('the expression indexes of the earlier attempts are dropped',async t=>{
 const db=await database(t);
 for(const name of RETIRED_CARD_NUMBER_INDEXES)await db.query(`CREATE INDEX ${name} ON mis_log_books (book_type,book_date)`);
 await ensureSavedCardNumberIndex(db,{...quiet,fillPauseMs:0});
 assert.deepEqual((await db.query('SELECT relname FROM pg_class WHERE relname=ANY($1::text[])',[RETIRED_CARD_NUMBER_INDEXES])).rows,[]);
 assert.deepEqual([...savedCardNumberIndexState().retiredDropped].sort(),[...RETIRED_CARD_NUMBER_INDEXES].sort());
});

test('the saved-record duplicate question compares the plain key column through the index and still finds the saved card',async t=>{
 const db=await database(t);
 await ensureSavedCardNumberIndex(db,{...quiet,fillPauseMs:0});
 for(let n=0;n<300;n++)await insertBook(db,'A-'+n,'D'+n);
 await insertBook(db,'77-12','D7');
 await db.query('ANALYZE mis_log_books');
 const batch={id:randomUUID(),kind:'vehicle',expected_context:{bookDate:'2026-11-14',location:'Sasti OC'}};
 const card={id:randomUUID(),batch_id:batch.id,created_at:new Date().toISOString(),draft:{aFormNo:'77/12',bookDate:'2026-11-14',door:'D7'},raw_fields:{}};
 const sql=[];
 const spy={query:(text,params)=>{sql.push(text);return db.query(text,params);}};
 const laps=[];
 const checks=await preloadDuplicateChecks(spy,batch,[card],{lap:name=>laps.push(name)});
 assert.deepEqual(laps,['duplicate-image','duplicate-batches','duplicate-cards','duplicate-saved']);
 const found=await checks.content(card,{bookDate:'2026-11-14',door:'D7',number:'7712'});
 assert.equal(found?.kind,'logbook');
 const saved=sql.find(text=>text.includes('FROM mis_log_books l LEFT JOIN mis_scan_cards oc'));
 // Under the production row policy only plain comparisons (=, = ANY on a column) can search an index.
 assert.match(saved,/l\.card_number_key=ANY\(\$3::text\[\]\)/);
 assert.doesNotMatch(saved.split(' WHERE ').pop(),/regexp_replace|book_date\+0/);
 await db.exec('SET enable_seqscan=off');
 const plan=(await db.query('EXPLAIN '+saved,['vehicle',['2026-11-14'],['7712']])).rows.map(row=>Object.values(row)[0]).join('\n');
 assert.match(plan,new RegExp(SAVED_CARD_NUMBER_INDEX),plan);
 assert.match(plan,/Index Cond:.*card_number_key/,plan);
 // The one-card question (a date or number outside the entry) compares the same column.
 const single=[];
 const other={...card,id:randomUUID(),draft:{aFormNo:'77/12',bookDate:'2026-11-14',door:'D7'}};
 const again=await findContentDuplicate({query:(text,params)=>{single.push(text);return db.query(text,params);}},'vehicle',other,batch,{bookDate:'2026-11-14',door:'D7',number:'7712'});
 assert.equal(again?.kind,'logbook');
 assert.ok(single.some(text=>/FROM mis_log_books l WHERE .*l\.card_number_key=\$3/.test(text)),single.join('\n'));
});

test('a server that cannot take the build lock leaves the other build alone',async()=>{
 const sql=[];let released=false;
 const client={query:async text=>{sql.push(text);
  if(text.includes('FROM pg_class c JOIN pg_index'))return {rows:[{valid:false}]};
  if(text.includes('pg_try_advisory_lock'))return {rows:[{locked:false}]};
  return {rows:[]};
 },release(){released=true;}};
 assert.equal(await ensureSavedCardNumberIndex({connect:async()=>client},quiet),'busy');
 assert.ok(!sql.some(text=>/DROP INDEX|CREATE INDEX/.test(text)),'nothing is dropped or built');
 assert.ok(released);
 assert.equal(savedCardNumberIndexState().state,'building-elsewhere');
});

test('an index another server is still building is not dropped',async()=>{
 const sql=[];
 const client={query:async text=>{sql.push(text);
  if(text.includes('FROM pg_class c JOIN pg_index'))return {rows:[{valid:false}]};
  if(text.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
  if(text.includes('pg_stat_progress_create_index'))return {rows:[{'?column?':1}]};
  return {rows:[]};
 },release(){}};
 assert.equal(await ensureSavedCardNumberIndex({connect:async()=>client},quiet),'busy');
 assert.ok(!sql.some(text=>/DROP INDEX|CREATE INDEX/.test(text)));
 assert.ok(sql.some(text=>text.includes('pg_advisory_unlock')),'the lock is given back');
});

test('Pulse-II builds the index in the background when it starts and shows it on /api/health',()=>{
 const source=readFileSync(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
 assert.ok(source.includes("const ensureIndex=(tries=0)=>void ensureSavedCardNumberIndex(pool).then(result=>{if(result==='busy'&&tries<12&&!stopped)"));
 assert.ok(source.includes('savedCardNumberIndex:savedCardNumberIndexState()'));
 assert.match(source,/preloadDuplicateChecks\(db,batch,live,\{lap\}\)/);
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.ok(server.includes('savedCardNumberIndex:s.savedCardNumberIndex'));
});
