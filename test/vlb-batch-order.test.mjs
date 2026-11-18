import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerVlbBatches} from '../server/routes/vlb-batches.mjs';
import {LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
import {previousBatchScope,batchOrderFrom,VLB_BATCH_ORDER_FROM} from '../shared/vlb-batch-order.mjs';

test('each shift waits for the shift before it; the first shift of a day waits for the last of the day before',()=>{
 const from='2026-11-19';
 assert.deepEqual(previousBatchScope({date:'2026-11-20',shift:'S1'},from),{date:'2026-11-19',shift:'S3'});
 assert.deepEqual(previousBatchScope({date:'2026-11-20',shift:'S2'},from),{date:'2026-11-20',shift:'S1'});
 assert.deepEqual(previousBatchScope({date:'2026-11-20',shift:'S3'},from),{date:'2026-11-20',shift:'S2'});
 assert.deepEqual(previousBatchScope({date:'2026-12-01',shift:'D'},from),{date:'2026-11-30',shift:'N'});
 assert.deepEqual(previousBatchScope({date:'2026-12-01',shift:'N'},from),{date:'2026-12-01',shift:'D'});
 assert.deepEqual(previousBatchScope({date:'2026-11-19',shift:'S1'},from),{date:'2026-11-18',shift:'S3'},'the start date still needs the day before');
 assert.equal(previousBatchScope({date:'2026-11-18',shift:'S2'},from),null,'dates before the start are not checked');
 assert.equal(batchOrderFrom({}),VLB_BATCH_ORDER_FROM);
 assert.equal(batchOrderFrom({VLB_BATCH_ORDER_FROM:'off'}),null);
});

test('a batch opens only after the previous shift batch of the site exists and its VLB is locked',async t=>{
 const saved={two:process.env.VLB_TWO_STAGE_BATCHES,from:process.env.VLB_BATCH_ORDER_FROM};
 process.env.VLB_TWO_STAGE_BATCHES='1';process.env.VLB_BATCH_ORDER_FROM='2026-12-16';
 t.after(()=>{for(const [key,value] of [['VLB_TWO_STAGE_BATCHES',saved.two],['VLB_BATCH_ORDER_FROM',saved.from]])value===undefined?delete process.env[key]:process.env[key]=value;});
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());
 const session=(req,res,next)=>{req.session={login:'alice'};req.logBookScope={sites:['sasti ob','jayant ob']};next()};
 registerVlbBatches(app,{pool,protect:[session],ensureBooks:async()=>{},getActor:async s=>({login:s.login,mis:true,admin:true,pm:false,pmScope:{sites:[]}})});
 app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(route='',method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/vlb-batches${route}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const create=(date,shift,site='Sasti OC')=>call('','POST',{site,date,shift,requestKey:randomUUID()});
 const preview=(date,shift)=>call('/preview?'+new URLSearchParams({site:'Sasti OC',date,shift}));
 const lockVlb=id=>db.query("UPDATE mis_vlb_batches SET stage='lmv_open' WHERE id=$1",[id]);

 // 15th: no batch of the day before at all, so the 16th Shift 1 cannot open.
 let blocked=await preview('2026-12-16','S1');
 assert.match(blocked.data.previousShift.message,/Shift 3 of 15-12-2026/);
 let res=await create('2026-12-16','S1');assert.equal(res.status,409);assert.match(res.data.error,/Shift 3 of 15-12-2026/);

 // The 15th is before the rule's start, so its Shift 3 opens on its own.
 const s3=await create('2026-12-15','S3');assert.equal(s3.status,201,JSON.stringify(s3.data));
 res=await create('2026-12-16','S1');assert.equal(res.status,409,'15th Shift 3 still has VLB open');
 await lockVlb(s3.data.id);
 assert.equal((await preview('2026-12-16','S1')).data.previousShift,null);
 const s1=await create('2026-12-16','S1');assert.equal(s1.status,201,JSON.stringify(s1.data));
 await lockVlb(s1.data.id);

 // Skipping a shift is refused: Shift 3 needs Shift 2 of the same day.
 res=await create('2026-12-16','S3');assert.equal(res.status,409);assert.match(res.data.error,/Shift 2 of 16-12-2026/);
 const s2=await create('2026-12-16','S2');assert.equal(s2.status,201,JSON.stringify(s2.data));
 await lockVlb(s2.data.id);
 assert.equal((await create('2026-12-16','S3')).status,201);

 // Another site keeps its own order.
 res=await create('2026-12-17','S1','Jayant OC');assert.equal(res.status,409);assert.match(res.data.error,/Shift 3 of 16-12-2026/);
});
