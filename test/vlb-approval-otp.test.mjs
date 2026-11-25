import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerVlbBatches} from '../server/routes/vlb-batches.mjs';
import {approvalOtpMessage,APPROVAL_PURPOSES} from '../server/services/vlb-approval-otp.mjs';
import {LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
process.env.VLB_BATCH_ORDER_FROM='off'; // these tests open batches out of shift order; vlb-batch-order.test.mjs covers the order
process.env.VLB_MULTI_DAY_BATCHES_UNTIL='off'; // the multi-day, multi-shift window is covered in multi-day-batches.test.mjs

// Flag unset: the two-stage batch is on, as in production.
test('approval OTP message names the batch, the reason and the ten-minute rule',()=>{
 assert.match(approvalOtpMessage({purpose:'reopen',batch:{name:'B',site:'sasti oc',report_date:'2026-12-30',shift:'S1'},reason:'r',requestedBy:'Bob',otp:'1'}),/reopen the closed batch B/);
 assert.deepEqual(Object.keys(APPROVAL_PURPOSES),['reopen']);
});

test('Unlock VLB and reopening a saved batch need no site PM approval',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());
 const session=(req,res,next)=>{if(!req.headers.authorization)return res.status(401).json({error:'Sign in'});req.session={login:req.headers.authorization,name:req.headers.authorization.toUpperCase()};req.logBookScope={sites:['sasti ob']};next()};
 const pms=['pm','pm2','dual'];
 const sent=[];
 const deliver=async({logins,message,otp,eventKey})=>{sent.push({logins,message,otp,eventKey});return {sentTo:logins,channels:['telegram'],failures:[]}};
 registerVlbBatches(app,{pool,protect:[session],ensureBooks:async()=>{},approvalOtp:{pmLogins:async()=>['pm','pm2'],deliver},
  getActor:async session=>({login:session.login,mis:!['pm','pm2','viewer'].includes(session.login),pm:pms.includes(session.login),pmScope:{sites:pms.includes(session.login)?['sasti ob']:[]}})});
 app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(route='',method='GET',body,user='alice')=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/vlb-batches${route}`,{method,headers:{Authorization:user,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()}};
 const add=async(date='2026-12-30')=>(await db.query('INSERT INTO mis_log_books(book_no,book_type,site,book_date,asset_id,request_key,data,created_by) VALUES($1,$2,$3,$4,1,$7,$5,$6) RETURNING id',[randomUUID(),'vehicle','Sasti OC',date,JSON.stringify({location:'Sasti OC',bookDate:date,bookShiftCode:'S1',door:'V07',aFormNo:'CARD1'}),'alice',randomUUID()])).rows[0].id;
 await add();await add('2026-12-31');
 const created=await call('','POST',{site:'Sasti OC',date:'2026-12-30',shift:'S1',requestKey:randomUUID()});assert.equal(created.status,201,JSON.stringify(created.data));
 const id=created.data.id,path='/'+id;
 assert.equal(created.data.stage,'vlb_open');assert.deepEqual(created.data.approvalOtps,[]);
 const locked=await call(path+'/lock-vlb','POST',{});assert.equal(locked.status,200,JSON.stringify(locked.data));assert.equal(locked.data.stage,'lmv_open');
 assert.equal(locked.data.canUnlockVlb,true);
 assert.equal((await call(path,'GET',undefined,'viewer')).status,200);
 const reason='Wrong tipper on card 12';
 assert.equal((await call(path+'/unlock-vlb','POST',{reason},'viewer')).status,403);
 assert.equal((await call(path+'/unlock-vlb','POST',{reason:'abc'})).status,400);
 assert.equal((await call(path+'/approval-otp','POST',{purpose:'unlock_vlb',reason})).status,400);
 assert.equal(sent.length,0);
 const unlocked=await call(path+'/unlock-vlb','POST',{reason},'bob');
 assert.equal(unlocked.status,200,JSON.stringify(unlocked.data));assert.equal(unlocked.data.stage,'vlb_open');assert.equal(unlocked.data.vlb_locked_at,null);
 const audit=unlocked.data.audit.find(a=>a.action==='vlb_unlocked');assert.equal(audit.actor,'bob');assert.equal(audit.detail.reason,reason);

 // Reopen a saved batch directly: any MIS user, no PM request or OTP.
 assert.equal((await call(path+'/lock-vlb','POST',{})).status,200);
 assert.equal((await call(path+'/lock-lmv','POST',{})).status,200);
 const closed=await call(path+'/close','POST',{});assert.equal(closed.status,200,JSON.stringify(closed.data));assert.ok(closed.data.closed_at);assert.equal(closed.data.stage,'closed');
 assert.equal(closed.data.canReopen,true);assert.equal(closed.data.approvalExpired,false);
 assert.equal((await call(path+'/unlock-vlb','POST',{reason})).status,409,'closed batches reopen first');
 const reopenOtp=await call(path+'/approval-otp','POST',{purpose:'reopen',reason:'Late scan card received'});
 assert.equal(reopenOtp.status,409);assert.match(reopenOtp.data.error,/Reopen the batch directly/);assert.equal(sent.length,0);
 assert.equal((await call(path,'GET',undefined,'pm')).data.canReopen,true,'every role that may use VLB batches reopens, not only MIS users');
 const reopened=await call(path+'/reopen','POST',{});
 assert.equal(reopened.status,200,JSON.stringify(reopened.data));assert.equal(reopened.data.closed_at,null);assert.equal(reopened.data.amendment_by,'alice');assert.equal(reopened.data.trial_reopened_until,null,'a reopened batch does not expire');
 assert.equal(reopened.data.stage,'elb_open','reopens at the machine stage');
 const reopenAudit=reopened.data.audit.find(a=>a.action==='reopened');assert.equal(reopenAudit.detail.pmApproval,'not required');assert.equal(reopenAudit.detail.approvedBy,null);

 // The other rules still hold: one open batch per site.
 assert.equal((await call(path+'/close','POST',{})).status,200);
 const other=await call('','POST',{site:'Sasti OC',date:'2026-12-31',shift:'S1',requestKey:randomUUID()},'bob');assert.equal(other.status,201,JSON.stringify(other.data));
 const blocked=await call(path+'/reopen','POST',{});assert.match(blocked.data.error,/Close the open batch/);
 assert.equal((await call('/'+other.data.id+'/lock-vlb','POST',{},'bob')).status,200);assert.equal((await call('/'+other.data.id+'/lock-lmv','POST',{},'bob')).status,200);assert.equal((await call('/'+other.data.id+'/close','POST',{},'bob')).status,200);
 const later=await call(path+'/reopen','POST',{},'bob');assert.equal(later.status,200,JSON.stringify(later.data));assert.equal(later.data.amendment_by,'bob','any MIS user may reopen');
 assert.equal((await call(path+'/close','POST',{},'bob')).status,200);
 const byPm=await call(path+'/reopen','POST',{},'pm');assert.equal(byPm.status,200,JSON.stringify(byPm.data));assert.equal(byPm.data.amendment_by,'pm','a site PM who is not an MIS user reopens too');
});
