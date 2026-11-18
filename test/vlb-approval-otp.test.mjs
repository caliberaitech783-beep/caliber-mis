import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerVlbBatches} from '../server/routes/vlb-batches.mjs';
import {approvalOtpMessage,APPROVAL_PURPOSES} from '../server/services/vlb-approval-otp.mjs';
import {LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
process.env.VLB_BATCH_ORDER_FROM='off'; // these tests open batches out of shift order; vlb-batch-order.test.mjs covers the order

// Flag unset: the two-stage batch is on, as in production.
test('approval OTP message names the batch, the reason and the ten-minute rule',()=>{
 const message=approvalOtpMessage({purpose:'unlock_vlb',batch:{name:'CMLL/SASTI OC/30TH -DEC-26/S1/B01',site:'sasti oc',report_date:'2026-12-30',shift:'S1'},reason:'Card 12 has the wrong tipper',requestedBy:'Alice',otp:'482913'});
 assert.match(message,/Unlock VLB/);assert.match(message,/Alice asks to unlock the VLB side of batch CMLL\/SASTI OC\/30TH -DEC-26\/S1\/B01 \(Sasti OC, 30-12-2026, S1\)/);
 assert.match(message,/Reason: Card 12 has the wrong tipper/);assert.match(message,/OTP 482913, valid 10 minutes/);assert.match(message,/recorded in the batch audit/);
 assert.match(approvalOtpMessage({purpose:'reopen',batch:{name:'B',site:'sasti oc',report_date:'2026-12-30',shift:'S1'},reason:'r',requestedBy:'Bob',otp:'1'}),/reopen the closed batch B/);
 assert.deepEqual(Object.keys(APPROVAL_PURPOSES),['reopen','unlock_vlb']);
});

test('Unlock VLB and reopening a saved batch need no site PM approval',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());
 const session=(req,res,next)=>{if(!req.headers.authorization)return res.status(401).json({error:'Sign in'});req.session={login:req.headers.authorization,name:req.headers.authorization.toUpperCase()};req.logBookScope={sites:['sasti ob']};next()};
 const pms=['pm','pm2','dual'];
 const sent=[];let deliveryFails=false;
 const deliver=async({logins,message,otp,eventKey})=>{if(deliveryFails)return {sentTo:[],channels:[],failures:['no channel']};sent.push({logins,message,otp,eventKey});return {sentTo:logins,channels:['telegram'],failures:[]}};
 registerVlbBatches(app,{pool,protect:[session],ensureBooks:async()=>{},approvalOtp:{pmLogins:async()=>['pm','pm2'],deliver},
  getActor:async session=>({login:session.login,mis:!['pm','pm2'].includes(session.login),pm:pms.includes(session.login),pmScope:{sites:pms.includes(session.login)?['sasti ob']:[]}})});
 app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(route='',method='GET',body,user='alice')=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/vlb-batches${route}`,{method,headers:{Authorization:user,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()}};
 const add=async(date='2026-12-30')=>(await db.query('INSERT INTO mis_log_books(book_no,book_type,site,book_date,asset_id,request_key,data,created_by) VALUES($1,$2,$3,$4,1,$7,$5,$6) RETURNING id',[randomUUID(),'vehicle','Sasti OC',date,JSON.stringify({location:'Sasti OC',bookDate:date,bookShiftCode:'S1',door:'V07',aFormNo:'CARD1'}),'alice',randomUUID()])).rows[0].id;
 await add();await add('2026-12-31');
 const created=await call('','POST',{site:'Sasti OC',date:'2026-12-30',shift:'S1',requestKey:randomUUID()});assert.equal(created.status,201,JSON.stringify(created.data));
 const id=created.data.id,path='/'+id;
 assert.equal(created.data.stage,'vlb_open');assert.deepEqual(created.data.approvalOtps,[]);

 // Unlock VLB: the batch owner, another MIS user and the site PM may all unlock directly; no PM OTP.
 const locked=await call(path+'/lock-vlb','POST',{});assert.equal(locked.status,200,JSON.stringify(locked.data));assert.equal(locked.data.stage,'lmv_open');
 assert.equal(locked.data.canUnlockVlb,true,'the MIS owner unlocks without PM approval');assert.equal(locked.data.canRequestUnlockOtp,false);
 assert.equal((await call(path,'GET',undefined,'bob')).data.canUnlockVlb,true,'another MIS user too');
 assert.equal((await call(path,'GET',undefined,'pm')).data.canUnlockVlb,true,'the site PM too');
 assert.equal((await call(path+'/approval-otp','POST',{purpose:'nonsense',reason:'Wrong tipper on card 12'})).status,400);
 const noOtp=await call(path+'/approval-otp','POST',{purpose:'unlock_vlb',reason:'Wrong tipper on card 12'});
 assert.equal(noOtp.status,409);assert.match(noOtp.data.error,/no longer needed/);assert.equal(sent.length,0,'no OTP is sent to the PM');
 assert.equal((await call(path+'/unlock-vlb','POST',{reason:'abc'})).status,400,'reason required');
 const unlocked=await call(path+'/unlock-vlb','POST',{reason:'Wrong tipper on card 12'});
 assert.equal(unlocked.status,200,JSON.stringify(unlocked.data));assert.equal(unlocked.data.stage,'vlb_open');assert.equal(unlocked.data.vlb_locked_at,null);
 const unlockAudit=unlocked.data.audit.find(a=>a.action==='vlb_unlocked');assert.equal(unlockAudit.actor,'alice');assert.equal(unlockAudit.detail.reason,'Wrong tipper on card 12');

 // Reopen a saved batch directly: any MIS user, no PM request or OTP.
 assert.equal((await call(path+'/lock-vlb','POST',{})).status,200);
 assert.equal((await call(path+'/lock-lmv','POST',{})).status,200);
 const closed=await call(path+'/close','POST',{});assert.equal(closed.status,200,JSON.stringify(closed.data));assert.ok(closed.data.closed_at);assert.equal(closed.data.stage,'closed');
 assert.equal(closed.data.canReopen,true);assert.equal(closed.data.approvalExpired,false);
 const reopenOtp=await call(path+'/approval-otp','POST',{purpose:'reopen',reason:'Late scan card received'});
 assert.equal(reopenOtp.status,409);assert.match(reopenOtp.data.error,/Reopen the batch directly/);assert.equal(sent.length,0);
 assert.equal((await call(path+'/reopen','POST',{},'pm')).status,403,'a PM who is not an MIS user does not reopen');
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
});
