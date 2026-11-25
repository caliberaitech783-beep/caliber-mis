import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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

test('while the window runs, batches of several days open together; one VLB-open batch per site and date stays',async t=>{
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
 // Another shift of a date whose VLB is open still waits for Lock VLB.
 const same=await create('2026-11-25','S2');
 assert.equal(same.status,409);assert.match(same.data.error,/Lock VLB in .* before creating another shift/);
 // No batch waits for an older one to lock LMV or close.
 const {data}=await call('');
 assert.ok(data.batches.length>=3);
 for(const batch of data.batches)assert.equal(batch.stageWait,'');
});

test('the stage queue itself is unchanged when the window is off',()=>{
 const rows=[{id:'a',name:'A',site:'Sasti OC',stage:'lmv_open'},{id:'b',name:'B',site:'Sasti OC',stage:'lmv_open'}];
 assert.match(batchStageWaits(rows).get('b'),/Lock LMV in A first/);
});
