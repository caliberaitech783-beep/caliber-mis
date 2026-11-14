// Reading a scan entry reuses each card's draft fill and checks while nothing they depend on has
// changed (server/rules/scan-check-memo.mjs). These tests hold that to one rule: at every step, the
// entry read with reuse must return exactly what a read that works every card out again returns.
import {prepareVlbFixture} from './operational-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {registerBulkCardScanning} from '../server/routes/bulk-card-scanning.mjs';
import {LOG_BOOK_SCHEMA,registerLogBooks} from '../server/routes/log-book.mjs';
import {createScanCheckMemo,memoKey} from '../server/rules/scan-check-memo.mjs';
import {readVlbOpeningMeterRows,preloadVlbOpeningMeterRows} from '../server/rules/vlb-scan-opening-meters.mjs';

process.env.VLB_TWO_STAGE_BATCHES='0';

test('a result is reused only while its key and every recorded answer are unchanged',async()=>{
 const memo=createScanCheckMemo({limit:2});
 let answer='none',computed=0;
 const questions={duplicate:async arg=>({arg,answer})};
 const compute=async ask=>{computed++;return {errors:[(await ask.duplicate({number:'A1'})).answer]};};
 assert.deepEqual(await memo('card',memoKey('k1'),questions,compute),{errors:['none']});
 const reused=await memo('card',memoKey('k1'),questions,compute);
 assert.deepEqual(reused,{errors:['none']});assert.equal(computed,1);
 reused.errors.push('added by the caller');
 assert.deepEqual(await memo('card',memoKey('k1'),questions,compute),{errors:['none']},'a caller cannot alter the kept result');
 answer='card 3';
 assert.deepEqual(await memo('card',memoKey('k1'),questions,compute),{errors:['card 3']},'a changed answer works the card out again');
 assert.equal(computed,2);
 await memo('card',memoKey('k2'),questions,compute);assert.equal(computed,3,'a changed key works the card out again');
 await assert.rejects(memo('other',memoKey('k'),questions,async()=>{throw Error('database down')}),/database down/);
 let retried=0;await memo('other',memoKey('k'),questions,async()=>{retried++;return {errors:[]};});assert.equal(retried,1,'a failure is not kept');
 await memo('third',memoKey('k'),questions,compute);
 assert.equal(memo.stats().cached,2,'the oldest result is dropped at the limit');
 assert.notEqual(memoKey('a','b'),memoKey('ab'));assert.equal(memoKey({a:1},[2]),memoKey({a:1},[2]));
});

test('earlier meter readings for many vehicles in one query equal the per-vehicle reads',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE mis_log_books(id serial PRIMARY KEY,book_type text,book_date date,asset_id bigint,site text,data jsonb,deleted_at timestamptz)');
 const save=(date,asset,closingKmr,{kind='vehicle',site='Sasti',deleted=false}={})=>db.query('INSERT INTO mis_log_books(book_type,book_date,asset_id,site,data,deleted_at) VALUES($1,$2,$3,$4,$5,$6)',[kind,date,asset,site,JSON.stringify({bookShiftCode:'S1',closingKmr,closingHmr:closingKmr+1,trips:[{loadingTime:'08:00'}]}),deleted?new Date():null]);
 await save('2026-11-08',1,10);await save('2026-11-09',1,20);await save('2026-11-10',1,30);await save('2026-11-10',1,31,{deleted:true});await save('2026-11-11',1,40);
 await save('2026-11-05',2,50);await save('2026-11-09',2,60,{site:'Other'});await save('2026-11-09',2,61,{kind:'lmv'});
 await save('2026-11-10',3,70);
 for(const sites of [['Sasti'],null,['Other']]){
  const loaded=await preloadVlbOpeningMeterRows(db,['1','2','3','4',2,'not-a-number'],'2026-11-10',sites);
  assert.deepEqual([...loaded.keys()].sort(),['1','2','3','4']);
  for(const asset of ['1','2','3','4'])assert.deepEqual(loaded.get(asset),await readVlbOpeningMeterRows(db,asset,'2026-11-10',sites),`vehicle ${asset}, sites ${sites}`);
 }
 assert.equal((await preloadVlbOpeningMeterRows(db,['1'],'',null)).size,0);
});

const masters=[{id:3,master_name:'Shift Master',record_data:{site:'Sasti OC',shiftName:'Shift A'}},{id:5,master_name:'Equipment master',record_data:{category:'Equipment',door:'LPC01',currentLocation:'Sasti OC'}}];
for(let i=0;i<8;i++){masters.push({id:100+i,master_name:'Equipment master',record_data:{category:'Vehicle',door:'V'+(400+i),currentLocation:'Sasti OC'}});masters.push({id:200+i,master_name:'C-Dir Employee master',record_data:{name:'Driver '+i,empId:'EMP'+(500+i),site:'Sasti OC'}});}
const cardText=i=>`Book date: 19-12-2026\nLocation: Sasti OC\nDoor No: V${400+i}\nEmployee ID: EMP${500+i}\nShift: Shift A\nSHIFT [x] I\nShift hours: 8\nOpening KMR: 1000\nClosing KMR: 1040\nOpening HMR: 200\nClosing HMR: 206\nTrip Card No: CARD-${i}\nL01 08:20 08:40 2\nMACHINE-WISE SUMMARY\n1 LPC01 2`;

test('an entry read with reuse returns what a full recheck returns, through every kind of change',{timeout:120000},async t=>{
 const db=new PGlite();t.after(()=>db.close());
 // data_revisions and its trigger are what production has; with them the reuse is switched on.
 await db.exec(`CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);
  CREATE TABLE data_revisions(revision_key TEXT PRIMARY KEY,revision BIGINT NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  INSERT INTO data_revisions(revision_key) VALUES('master-data');
  CREATE FUNCTION bump_data_revision() RETURNS TRIGGER AS $$ BEGIN UPDATE data_revisions SET revision=revision+1 WHERE revision_key=TG_ARGV[0];RETURN NULL;END;$$ LANGUAGE plpgsql;
  CREATE TRIGGER master_records_revision_trigger AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON master_records FOR EACH STATEMENT EXECUTE FUNCTION bump_data_revision('master-data');`);
 await db.exec(LOG_BOOK_SCHEMA);
 for(const m of masters)await db.query('INSERT INTO master_records VALUES($1,$2,$3)',[m.id,m.master_name,JSON.stringify(m.record_data)]);
 let queries=0,tail=Promise.resolve();
 const query=(q,a)=>{queries++;return q.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!a&&q.includes(';')?db.exec(q):db.query(q,a);};
 const pool={query,connect:async()=>{const previous=tail;let done;tail=new Promise(r=>done=r);await previous;return {query,release(){done()}}}};
 const app=express();app.use(express.json({limit:'20mb'}));
 const numberOf=image=>Number(Buffer.from(image).toString('latin1').match(/card(\d+)$/)?.[1]??0);
 const ocr={recognize:async image=>({text:cardText(numberOf(image)),confidence:91}),close(){}};
 const requireSession=(req,res,next)=>{req.session={login:'test-admin'};next()},requireAdministrator=(req,res,next)=>next();
 registerLogBooks(app,{pool,requireSession,requireAdministrator,getSiteScope:async()=>({sites:null})});
 const service=registerBulkCardScanning(app,{pool,requireSession,requireAdministrator,ocr,localDrafts:true,readHours:async()=>({breakdownHours:1,availabilityHours:6,idleHours:2})});
 await service.start();t.after(()=>service.stop());
 app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));t.after(()=>{server.closeAllConnections();server.close()});
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const context={bookDate:'2026-12-19',location:'Sasti OC',cardShift:'I'};
 await prepareVlbFixture(db,context);
 const entry=async()=>{const r=await call('/api/scan-batches','POST',{kind:'vehicle',expectedContext:context});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.id;};
 const batch=await entry();
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBEkAAAAASUVORK5CYII=','base64');
 const count=6,ids=[];
 for(let n=0;n<count;n++){const id=randomUUID();ids.push(id);assert.equal((await call('/api/scan-batches/'+batch+'/cards','POST',{base64:Buffer.concat([png,Buffer.from('card'+n)]).toString('base64'),uploadKey:id,filename:'scan'+n+'.png'})).status,201);}
 let cards;for(let tries=0;tries<400;tries++){cards=(await call('/api/scan-batches/'+batch)).data.cards;if(cards.length===count&&cards.every(c=>c.status==='review'))break;await new Promise(r=>setTimeout(r,20));}
 assert.ok(cards.every(c=>c.status==='review'),JSON.stringify(cards.map(c=>[c.status,c.error])));
 for(let n=0;n<count;n++)assert.equal(String(cards[n].draft.assetId),String(100+n),'each card reads its own vehicle');

 const reuse=()=>service.status().entryReadReuse;
 const recheck=async id=>{process.env.MIS_SCAN_CHECK_MEMO='false';try{return (await call('/api/scan-batches/'+id)).data;}finally{delete process.env.MIS_SCAN_CHECK_MEMO;}};
 // The read with reuse goes first, so a stale kept result could not be hidden by a recheck before it.
 const same=async label=>{const kept=(await call('/api/scan-batches/'+batch)).data,direct=await recheck(batch);assert.deepEqual(kept.cards,direct.cards,label);assert.deepEqual(kept.duplicates,direct.duplicates,label);return kept.cards;};
 const errors=card=>card.checks.errors.join(' | ');

 cards=await same('after reading');
 assert.ok(cards.every(c=>c.checks),'every card carries its checks');

 // 1. Nothing changed: the next read works no card out again and asks the database far less.
 const before=reuse();queries=0;
 const again=(await call('/api/scan-batches/'+batch)).data.cards;const keptQueries=queries;
 assert.deepEqual(again,cards);
 assert.equal(reuse().check.misses,before.check.misses,'no check ran again');assert.equal(reuse().check.hits,before.check.hits+count);
 assert.equal(reuse().fill.misses,before.fill.misses,'no draft fill ran again');assert.equal(reuse().fill.hits,before.fill.hits+count);
 queries=0;await recheck(batch);const directQueries=queries;
 assert.ok(keptQueries<=20,`an unchanged ${count}-card entry is read in a fixed number of queries (${keptQueries})`);
 assert.ok(directQueries>=keptQueries+count,`working every card out again asks at least one query more per card (${directQueries} against ${keptQueries})`);

 // 2. The card itself changes: only that card is worked out again.
 const edited=await call('/api/scan-cards/'+cards[0].id,'PUT',{draft:{...cards[0].draft,closingKmr:''},revision:cards[0].revision,action:'save'});
 assert.equal(edited.status,200,JSON.stringify(edited.data));
 const misses=reuse().check.misses;
 cards=await same('after editing one card');
 assert.match(errors(cards[0]),/Closing KMR is missing/);assert.equal(reuse().check.misses,misses+1,'the other cards were reused');
 await call('/api/scan-cards/'+cards[0].id,'PUT',{draft:{...cards[0].draft,closingKmr:'1040'},revision:cards[0].revision,action:'save'});
 cards=await same('after restoring the card');assert.doesNotMatch(errors(cards[0]),/Closing KMR/);

 // 3. A master changes: every card is worked out again.
 const clean=cards.map(errors);
 await db.query("UPDATE master_records SET record_data=record_data||'{\"site\":\"Other site\"}'::jsonb WHERE id=3");
 cards=await same('after the shift master moved to another site');
 assert.notDeepEqual(cards.map(errors),clean,'the changed master shows on the cards');
 await db.query("UPDATE master_records SET record_data=record_data||'{\"site\":\"Sasti OC\"}'::jsonb WHERE id=3");
 cards=await same('after the shift master was restored');assert.deepEqual(cards.map(errors),clean);

 // 4. Another card changes: an earlier card takes this card's number and door, so this one becomes a duplicate.
 const earlier=cards[1],later=cards[2],earlierDraft=(await db.query('SELECT draft FROM mis_scan_cards WHERE id=$1',[earlier.id])).rows[0].draft;
 await db.query('UPDATE mis_scan_cards SET draft=draft||$2::jsonb WHERE id=$1',[earlier.id,JSON.stringify({aFormNo:later.draft.aFormNo,doorTextWritten:later.raw_fields.door||later.draft.doorText})]);
 cards=await same('after an earlier card took the same number and door');
 assert.match(errors(cards[2]),/Same card number, door and date already appear on card 2/);
 await db.query('UPDATE mis_scan_cards SET draft=$2::jsonb WHERE id=$1',[earlier.id,JSON.stringify(earlierDraft)]);
 cards=await same('after the earlier card was corrected');assert.doesNotMatch(errors(cards[2]),/Same card number/);

 // 5. A saved log book appears with this card's number and door, then is deleted.
 const target=cards[3];
 const saved=(await db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,request_key,created_by) VALUES('VLB/SAVED/1','vehicle','2026-12-19','Sasti OB',999,$1,$2,'alice') RETURNING id",[JSON.stringify({door:target.raw_fields.door||target.draft.doorText,scanCardNumber:target.draft.aFormNo}),randomUUID()])).rows[0].id;
 cards=await same('after a log book with the same card was saved');
 assert.match(errors(cards[3]),/Card already exists in VLB\/SAVED\/1/);
 await db.query('UPDATE mis_log_books SET deleted_at=NOW() WHERE id=$1',[saved]);
 cards=await same('after that log book was deleted');assert.doesNotMatch(errors(cards[3]),/already exists/);

 // 6. The same image exists on an earlier live card that this entry does not list, then that card is rejected.
 const other=await entry(),twin=randomUUID(),original=(await db.query('SELECT image_hash,created_at FROM mis_scan_cards WHERE id=$1',[cards[4].id])).rows[0];
 await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,status,duplicate_of,created_at) VALUES($1,$2,1,'twin.png',$3,$4,'review',$5,$6)",[twin,other,png,original.image_hash,randomUUID(),new Date(new Date(original.created_at).getTime()-60000)]);
 cards=await same('after an earlier card with the same image appeared');
 assert.match(errors(cards[4]),/Duplicate card\./);
 await db.query("UPDATE mis_scan_cards SET status='rejected' WHERE id=$1",[twin]);
 cards=await same('after that card was rejected');assert.doesNotMatch(errors(cards[4]),/Duplicate card\./);

 // 7. A previous closing is only used to fill a missing or inconsistent opening.
 const vehicle=cards[5];assert.equal(Number(vehicle.draft.openingKmr),1000);
 await db.query("UPDATE mis_scan_cards SET draft=draft||'{\"openingKmr\":\"\",\"openingHmr\":\"\"}'::jsonb WHERE id=$1",[vehicle.id]);
 cards=await same('after the openings were cleared');
 const missing=cards[5];assert.equal(missing.draft.openingKmr,'');
 await db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,request_key,created_by) VALUES('VLB/EARLIER/1','vehicle','2026-12-18','Sasti OB',$1,$2,$3,'alice')",[vehicle.draft.assetId,JSON.stringify({bookShiftCode:'S3',closingKmr:960,closingHmr:200}),randomUUID()]);
 cards=await same('after an earlier Trip Card of the vehicle was saved');
 assert.equal(Number(cards[5].draft.openingKmr),960);assert.equal(Number(cards[5].draft.openingHmr),200);
 assert.ok(cards[5].revision>missing.revision,'the filled meters are stored on the card');
 await same('on the read after the meters were filled');
});
