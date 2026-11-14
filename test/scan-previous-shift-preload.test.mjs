import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
import {PREVIOUS_SHIFT_RECORDS_SQL,previousShiftRecordReader,fillScanTripEstimates} from '../shared/scan-trip-estimates.mjs';

async function database(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);CREATE TABLE data_revisions(revision_key TEXT PRIMARY KEY,revision BIGINT NOT NULL DEFAULT 1);'+LOG_BOOK_SCHEMA);
 const insert=(asset,site,date,shift,{deleted=false,type='vehicle'}={})=>db.query(`INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,request_key,created_by,deleted_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,'test',${deleted?'NOW()':'NULL'})`,['B-'+randomUUID().slice(0,8),type,date,site,asset,JSON.stringify({bookDate:date,cardShift:shift,trips:[{loadingTime:'07:00',equipmentName:'SHOVEL '+asset}]}),randomUUID()]);
 for(const asset of [11,12,13]){await insert(asset,'Sasti OC','2026-11-14','III');await insert(asset,'Sasti OC','2026-11-14','III');}
 await insert(11,'Sasti OC','2026-11-14','II');
 await insert(12,'Jayant OC','2026-11-14','III');
 await insert(13,'Sasti OC','2026-11-14','III',{deleted:true});
 await insert(11,'Sasti OC','2026-11-14','III',{type:'equipment'});
 return db;
}

test('one query answers every vehicle of the entry with the rows the per-card query returns',async t=>{
 const db=await database(t);
 const calls=[];
 const query=(sql,args)=>{calls.push(sql);return db.query(sql,args);};
 const read=previousShiftRecordReader(query,[11,'12',13,null,'']);
 for(const args of [[11,'Sasti OC','2026-11-14','III'],['12','Sasti OC','2026-11-14','III'],[13,'Sasti OC','2026-11-14','III'],[11,'Sasti OC','2026-11-14','II'],[12,'Jayant OC','2026-11-14','III']]){
  const expected=(await db.query(PREVIOUS_SHIFT_RECORDS_SQL,args)).rows;
  assert.deepEqual(await read(PREVIOUS_SHIFT_RECORDS_SQL,args),expected,JSON.stringify(args));
 }
 assert.equal(calls.length,3,'one load per site, date and shift instead of one query per card');
 assert.ok(calls.every(sql=>sql.includes('asset_id=ANY($1::bigint[])')));
});

test('a vehicle outside the entry list and any other query go to the database directly',async t=>{
 const db=await database(t);
 const calls=[];
 const read=previousShiftRecordReader((sql,args)=>{calls.push(sql);return db.query(sql,args);},[11]);
 assert.equal((await read(PREVIOUS_SHIFT_RECORDS_SQL,[12,'Sasti OC','2026-11-14','III'])).length,2);
 assert.deepEqual(calls,[PREVIOUS_SHIFT_RECORDS_SQL]);
 await read('SELECT 1 AS one',[]);
 assert.equal(calls.at(-1),'SELECT 1 AS one');
});

test('a failed load is not kept',async()=>{
 let fail=true;
 const read=previousShiftRecordReader(async()=>{if(fail)throw new Error('busy');return {rows:[{id:'1',book_no:'B',data:{},preload_asset_id:'11'}]};},[11]);
 await assert.rejects(read(PREVIOUS_SHIFT_RECORDS_SQL,[11,'Sasti OC','2026-11-14','III']),/busy/);
 fail=false;
 assert.deepEqual(await read(PREVIOUS_SHIFT_RECORDS_SQL,[11,'Sasti OC','2026-11-14','III']),[{id:'1',book_no:'B',data:{}}]);
});

test('fillScanTripEstimates still asks the shared query and the entry read answers it from the reader',async t=>{
 const db=await database(t);
 const asked=[];
 const draft={assetId:11,location:'Sasti OC',bookDate:'2026-11-15',cardShift:'I',trips:[{equipmentName:'',loadingTime:'08:00',unloadingTime:''}]};
 await fillScanTripEstimates({query:(sql,args)=>{asked.push(sql);return db.query(sql,args);}},draft);
 assert.deepEqual(asked,[PREVIOUS_SHIFT_RECORDS_SQL]);
 const source=readFileSync(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
 assert.match(source,/previousShiftRecords=previousShiftRecordReader\(\(sql,args\)=>validationClient\.query\(sql,args\),toFill\.map\(row=>row\.draft\?\.assetId\)\)/);
 assert.match(source,/records:async\(\{sql,args\}\)=>\(\{rows:await previousShiftRecords\(sql,args\)\}\)/);
});
