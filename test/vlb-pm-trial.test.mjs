import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {registerVlbBatches} from '../vlb-batches.mjs';
import {VLB_BATCH_SCHEMA,assertVlbBatchWrite} from '../vlb-batch-policy.mjs';
import {activateVlbPmTrial,vlbPmTrial,VLB_PM_TRIAL_ID} from '../vlb-pm-trial.mjs';

test('10-day trial withdraws only the approved pending request, is restart-safe, preserves access and expires on server writes',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_no TEXT,book_type TEXT,site TEXT,book_date DATE,data JSONB,revision INTEGER,created_by TEXT,created_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ)');
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 await db.exec(VLB_BATCH_SCHEMA);
 const id=randomUUID(),other=randomUUID(),requestId=randomUUID(),otherRequest=randomUUID();
 for(const [batch,name,site] of [[id,'CMLL/JAYANT OC/30TH -OCT-26/S3/B01','jayant ob'],[other,'Unrelated batch','sasti ob']]){
  await db.query("INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,sequence,created_by,request_key,closed_at,closure_revision,saved_lock_policy) VALUES($1,$2,$3,'2026-10-30','S3',1,'alice',$4,NOW(),1,TRUE)",[batch,name,site,randomUUID()]);
 }
 for(const [request,batch] of [[requestId,id],[otherRequest,other]])await db.query("INSERT INTO mis_vlb_reopen_requests(id,batch_id,closure_revision,requested_by,reason) VALUES($1,$2,1,'alice','Additional cards required')",[request,batch]);
 const before=(await db.query('SELECT * FROM mis_vlb_batches WHERE id=$1',[id])).rows[0];
 assert.equal((await vlbPmTrial(db)).active,false);
 await activateVlbPmTrial(pool);
 const first=(await db.query('SELECT * FROM mis_vlb_pm_trials')).rows[0];
 assert.equal(new Date(first.ends_at)-new Date(first.started_at),240*3600000);
 await activateVlbPmTrial(pool);
 assert.deepEqual((await db.query('SELECT * FROM mis_vlb_pm_trials')).rows[0],first,'restart never extends the trial');
 const withdrawn=(await db.query('SELECT * FROM mis_vlb_reopen_requests WHERE id=$1',[requestId])).rows[0];
 assert.ok(withdrawn.withdrawn_at);assert.equal(withdrawn.status,'rejected');
 assert.equal((await db.query('SELECT status FROM mis_vlb_reopen_requests WHERE id=$1',[otherRequest])).rows[0].status,'pending');
 assert.deepEqual((await db.query('SELECT * FROM mis_vlb_batches WHERE id=$1',[id])).rows[0],before,'activation does not change the batch');
 const app=express();app.use(express.json());
 const session=(req,res,next)=>{req.session={login:req.headers.authorization};req.logBookScope={sites:req.session.login==='restricted'?['sasti ob']:['jayant ob']};next()};
 registerVlbBatches(app,{pool,protect:[session],ensureBooks:async()=>{},getActor:async s=>({login:s.login,mis:['alice','bob','restricted'].includes(s.login),pm:s.login==='pm',pmScope:{sites:['jayant ob']}})});
 app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(path,method='GET',user='alice')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/vlb-batches`+path,{method,headers:{Authorization:user,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});return {status:r.status,data:await r.json()}};
 assert.equal((await call('/approvals')).data.requests.length,0);
 assert.equal((await call('/'+id)).data.canReopen,true);
 assert.equal((await call('/'+id+'/reopen','POST','restricted')).status,404);
 assert.equal((await call('/'+id+'/reopen','POST','pm')).status,403);
 const opened=await call('/'+id+'/reopen','POST');assert.equal(opened.status,200,JSON.stringify(opened.data));assert.ok(opened.data.trial_reopened_until);
 await assert.rejects(()=>assertVlbBatchWrite(pool,{location:'Jayant OC',bookDate:'2026-10-30',bookShiftCode:'S3'},'bob'),/another MIS user/);
 await assertVlbBatchWrite(pool,{location:'Jayant OC',bookDate:'2026-10-30',bookShiftCode:'S3'},'alice');
 await db.query("UPDATE mis_vlb_pm_trials SET started_at=NOW()-INTERVAL '241 hours',ends_at=NOW()-INTERVAL '1 hour' WHERE id=$1",[VLB_PM_TRIAL_ID]);
 await db.query("UPDATE mis_vlb_batches SET trial_reopened_until=NOW()-INTERVAL '1 hour' WHERE id=$1",[id]);
 assert.equal((await vlbPmTrial(db)).active,false);
 assert.equal((await call('/'+id)).data.canContinue,false);
 await assert.rejects(()=>assertVlbBatchWrite(pool,{location:'Jayant OC',bookDate:'2026-10-30',bookShiftCode:'S3'},'alice'),/trial has expired/);
 assert.equal((await call('/'+id+'/close','POST')).status,200);
 assert.equal((await call('/'+id+'/reopen','POST')).status,403,'PM approval automatically resumes');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_vlb_batch_audit WHERE action=$1',['reopen_request_withdrawn'])).rows[0].n,1);
});

test('ambiguous or missing approved request rolls trial activation back',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY)');await db.exec(VLB_BATCH_SCHEMA);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 await assert.rejects(()=>activateVlbPmTrial(pool),/exactly one pending/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_vlb_pm_trials')).rows[0].n,0);
});
