import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
import {SCAN_SCHEMA} from '../server/routes/bulk-card-scanning.mjs';
import {ensureSavedCardNumberIndex,savedCardNumberIndexState,preloadDuplicateChecks,SAVED_CARD_NUMBER_INDEX} from '../server/services/scan-duplicates.mjs';

const quiet={log:{log(){}}};
async function database(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);CREATE TABLE data_revisions(revision_key TEXT PRIMARY KEY,revision BIGINT NOT NULL DEFAULT 1);'+LOG_BOOK_SCHEMA);
 await db.exec(SCAN_SCHEMA);
 return db;
}

test('the saved card number index is built once and rebuilt when a build was left invalid',async t=>{
 const db=await database(t);
 assert.equal(await ensureSavedCardNumberIndex(db,quiet),true);
 assert.equal(await ensureSavedCardNumberIndex(db,quiet),false,'a valid index is kept');
 await db.query('UPDATE pg_index SET indisvalid=false WHERE indexrelid=$1::regclass',[SAVED_CARD_NUMBER_INDEX]);
 assert.equal(await ensureSavedCardNumberIndex(db,quiet),true,'an invalid index is dropped and built again');
 assert.equal((await db.query('SELECT i.indisvalid AS valid FROM pg_index i WHERE i.indexrelid=$1::regclass',[SAVED_CARD_NUMBER_INDEX])).rows[0].valid,true);
 assert.equal(savedCardNumberIndexState().state,'valid');
 assert.equal(typeof savedCardNumberIndexState().usedByPlanner,'boolean');
});

test('the saved-record duplicate question reads through the index and still finds the saved card',async t=>{
 const db=await database(t);
 await ensureSavedCardNumberIndex(db,quiet);
 const insert=(number,door,date='2026-11-14')=>db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,request_key,created_by) VALUES($1,'vehicle',$2,'Sasti OC',1,$3::jsonb,$4,'test')",['VLB-'+randomUUID().slice(0,8),date,JSON.stringify({aFormNo:number,door,trips:[{loadingTime:'08:00'}]}),randomUUID()]);
 for(let n=0;n<300;n++)await insert('A-'+n,'D'+n);
 await insert('77-12','D7');
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
 await db.exec('SET enable_seqscan=off');
 const plan=(await db.query('EXPLAIN '+saved,['vehicle',['2026-11-14'],['7712']])).rows.map(row=>Object.values(row)[0]).join('\n');
 assert.match(plan,new RegExp(SAVED_CARD_NUMBER_INDEX),plan);
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
