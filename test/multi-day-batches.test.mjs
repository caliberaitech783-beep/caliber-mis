import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerVlbBatches} from '../server/routes/vlb-batches.mjs';
import {LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
import {MULTI_DAY_UNTIL,multiDayBatches,multiDayBatchesUntil,multiDayBatchesEndAt} from '../shared/multi-day-batches.mjs';
import {batchStageWaits} from '../server/rules/vlb-batch-queue.mjs';

// Owner, 25 Nov 2026: "I need to open multiple batch for multiple days....fix it for 7 days".
test('the window runs to the end of 1 Dec 2026 in India and can be moved or ended by the Azure setting',()=>{
 assert.equal(MULTI_DAY_UNTIL,'2026-12-01');
 assert.equal(multiDayBatchesUntil({}),'2026-12-01');
 assert.equal(multiDayBatchesEndAt('2026-12-01').toISOString(),'2026-12-01T18:30:00.000Z');
 assert.equal(multiDayBatches({},new Date('2026-11-25T12:00:00Z')),true);
 assert.equal(multiDayBatches({},new Date('2026-12-01T18:29:59Z')),true,'still on at 23:59 IST on 1 Dec');
 assert.equal(multiDayBatches({},new Date('2026-12-01T18:30:00Z')),false,'ends by itself at 00:00 IST on 2 Dec');
 for(const off of ['off','0','false','no','OFF'])assert.equal(multiDayBatches({VLB_MULTI_DAY_BATCHES_UNTIL:off},new Date('2026-11-26T00:00:00Z')),false);
 assert.equal(multiDayBatches({VLB_MULTI_DAY_BATCHES_UNTIL:'2026-12-05'},new Date('2026-12-04T10:00:00Z')),true,'the setting moves the last day');
});

test('while the window runs, batches of several days and several shifts of one date open together',async t=>{
 const saved={two:process.env.VLB_TWO_STAGE_BATCHES,from:process.env.VLB_BATCH_ORDER_FROM,multi:process.env.VLB_MULTI_DAY_BATCHES_UNTIL,pause:process.env.VLB_BATCH_LOCK_PAUSE_UNTIL};
 process.env.VLB_TWO_STAGE_BATCHES='1';process.env.VLB_BATCH_ORDER_FROM='2026-11-19';process.env.VLB_MULTI_DAY_BATCHES_UNTIL='2099-12-31';process.env.VLB_BATCH_LOCK_PAUSE_UNTIL='off';
 t.after(()=>{for(const [key,value] of [['VLB_TWO_STAGE_BATCHES',saved.two],['VLB_BATCH_ORDER_FROM',saved.from],['VLB_MULTI_DAY_BATCHES_UNTIL',saved.multi],['VLB_BATCH_LOCK_PAUSE_UNTIL',saved.pause]])value===undefined?delete process.env[key]:process.env[key]=value;});
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());
 const session=(req,res,next)=>{req.session={login:'alice'};req.logBookScope={sites:['sasti ob']};next()};
 registerVlbBatches(app,{pool,protect:[session],ensureBooks:async()=>{},getActor:async s=>({login:s.login,mis:true,admin:true,pm:false,pmScope:{sites:[]}})});
 app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(route='',method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/vlb-batches${route}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const create=(date,shift)=>call('','POST',{site:'Sasti OC',date,shift,requestKey:randomUUID()});
 const preview=(date,shift)=>call('/preview?'+new URLSearchParams({site:'Sasti OC',date,shift}));

 // Three days' Shift A open together, each still VLB-open, with no earlier shift made.
 for(const date of ['2026-11-25','2026-11-26','2026-11-27']){
  const p=await preview(date,'S1');
  assert.equal(p.data.creationBlocker,null);assert.equal(p.data.previousShift,null);
  const res=await create(date,'S1');assert.equal(res.status,201,JSON.stringify(res.data));
 }
 // Owner, 25 Nov 2026: several shifts of the same date open together, all VLB-open.
 for(const shift of ['S2','S3']){
  const p=await preview('2026-11-25',shift);assert.equal(p.data.creationBlocker,null);assert.equal(p.data.previousShift,null);
  const res=await create('2026-11-25',shift);assert.equal(res.status,201,JSON.stringify(res.data));
 }
 assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM mis_vlb_batches WHERE book_date='2026-11-25' AND stage='vlb_open'")).rows[0].n,3);
 // One batch per site, date and shift stays.
 const again=await create('2026-11-25','S2');
 assert.equal(again.status,409);assert.match(again.data.error,/already exists for this site, date and shift/);
 // No batch waits for an older one to lock LMV or close.
 const {data}=await call('');
 assert.ok(data.batches.length>=3);
 for(const batch of data.batches)assert.equal(batch.stageWait,'');
});

test('the stage queue itself is unchanged when the window is off',()=>{
 const rows=[{id:'a',name:'A',site:'Sasti OC',stage:'lmv_open'},{id:'b',name:'B',site:'Sasti OC',stage:'lmv_open'}];
 assert.match(batchStageWaits(rows).get('b'),/Lock LMV in A first/);
});

test('after the window the one-VLB-open index returns only when no site and date holds two VLB-open batches',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const policy=readFileSync(new URL('../server/rules/vlb-batch-policy.mjs',import.meta.url),'utf8');
 assert.match(policy,/IF \$\{MULTI_DAY_INDEX_OFF_SQL\} THEN DROP INDEX IF EXISTS mis_vlb_one_open_vlb_per_site_date;/);
 assert.match(policy,/GROUP BY site,book_date HAVING COUNT\(\*\)>1\) THEN\r?\n\s+CREATE UNIQUE INDEX IF NOT EXISTS mis_vlb_one_open_vlb_per_site_date/);
 await db.exec("CREATE TABLE mis_vlb_batches(id INT PRIMARY KEY,site TEXT,book_date DATE,stage TEXT,closed_at TIMESTAMPTZ,archived_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ)");
 const block=off=>`DO $vlbopen$ BEGIN
  IF ${off} THEN DROP INDEX IF EXISTS mis_vlb_one_open_vlb_per_site_date;
  ELSIF NOT EXISTS(SELECT 1 FROM mis_vlb_batches WHERE closed_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL AND stage='vlb_open' AND book_date>=DATE '2026-11-01' GROUP BY site,book_date HAVING COUNT(*)>1) THEN
   CREATE UNIQUE INDEX IF NOT EXISTS mis_vlb_one_open_vlb_per_site_date ON mis_vlb_batches(site,book_date) WHERE closed_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL AND stage='vlb_open' AND book_date>=DATE '2026-11-01';
  END IF; END $vlbopen$;`;
 const hasIndex=async()=>(await db.query("SELECT 1 FROM pg_indexes WHERE indexname='mis_vlb_one_open_vlb_per_site_date'")).rows.length===1;
 await db.exec("INSERT INTO mis_vlb_batches VALUES(1,'Sasti OC','2026-11-25','vlb_open',NULL,NULL,NULL),(2,'Sasti OC','2026-11-25','vlb_open',NULL,NULL,NULL)");
 await db.exec(block('TRUE'));assert.equal(await hasIndex(),false,'dropped while the window runs');
 await db.exec(block('FALSE'));assert.equal(await hasIndex(),false,'two VLB-open batches of one date: the start goes on without the index');
 await db.exec("UPDATE mis_vlb_batches SET stage='lmv_open' WHERE id=2");
 await db.exec(block('FALSE'));assert.equal(await hasIndex(),true,'back once the date holds one VLB-open batch');
});
