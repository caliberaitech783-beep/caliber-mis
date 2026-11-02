import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerVlbBatches} from '../vlb-batches.mjs';
import {approvalOtpMessage,APPROVAL_PURPOSES} from '../vlb-approval-otp.mjs';
import {LOG_BOOK_SCHEMA} from '../log-book.mjs';

// Flag unset: the two-stage batch is on, as in production.
test('approval OTP message names the batch, the reason and the ten-minute rule',()=>{
 const message=approvalOtpMessage({purpose:'unlock_vlb',batch:{name:'CMLL/SASTI OC/30TH -DEC-26/S1/B01',site:'sasti oc',report_date:'2026-12-30',shift:'S1'},reason:'Card 12 has the wrong tipper',requestedBy:'Alice',otp:'482913'});
 assert.match(message,/Unlock VLB/);assert.match(message,/Alice asks to unlock the VLB side of batch CMLL\/SASTI OC\/30TH -DEC-26\/S1\/B01 \(Sasti OC, 30-12-2026, S1\)/);
 assert.match(message,/Reason: Card 12 has the wrong tipper/);assert.match(message,/OTP 482913, valid 10 minutes/);assert.match(message,/recorded in the batch audit/);
 assert.match(approvalOtpMessage({purpose:'reopen',batch:{name:'B',site:'sasti oc',report_date:'2026-12-30',shift:'S1'},reason:'r',requestedBy:'Bob',otp:'1'}),/reopen the closed batch B/);
 assert.deepEqual(Object.keys(APPROVAL_PURPOSES),['reopen','unlock_vlb']);
});

test('site PM OTP unlocks VLB and reopens a closed batch; a PM may approve their own request on screen',async t=>{
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
 assert.equal((await call(path+'/approval-otp','POST',{purpose:'unlock_vlb',reason:'Wrong tipper on card 12'})).status,409,'nothing to unlock before Lock VLB');
 const locked=await call(path+'/lock-vlb','POST',{});assert.equal(locked.status,200,JSON.stringify(locked.data));assert.equal(locked.data.stage,'elb_open');
 assert.equal(locked.data.canUnlockVlb,false);assert.equal(locked.data.canRequestUnlockOtp,true,'the MIS owner may ask the PM for an unlock OTP');
 assert.equal((await call(path,'GET',undefined,'pm')).data.canUnlockVlb,true);assert.equal((await call(path,'GET',undefined,'pm')).data.canRequestUnlockOtp,false,'the PM unlocks directly');

 // Unlock VLB by OTP
 assert.equal((await call(path+'/approval-otp','POST',{purpose:'nonsense',reason:'Wrong tipper on card 12'})).status,400);
 assert.equal((await call(path+'/approval-otp','POST',{purpose:'unlock_vlb',reason:'abc'})).status,400,'reason required');
 deliveryFails=true;assert.match((await call(path+'/approval-otp','POST',{purpose:'unlock_vlb',reason:'Wrong tipper on card 12'})).data.error,/no Telegram or mobile/);deliveryFails=false;
 const unlockOtp=await call(path+'/approval-otp','POST',{purpose:'unlock_vlb',reason:'Wrong tipper on card 12'});
 assert.equal(unlockOtp.status,200,JSON.stringify(unlockOtp.data));assert.equal(unlockOtp.data.otp.purpose,'unlock_vlb');assert.deepEqual(unlockOtp.data.otp.sentTo,['pm','pm2']);assert.equal(unlockOtp.data.otp.status,'sent');
 assert.equal(sent.length,1);assert.deepEqual(sent[0].logins,['pm','pm2']);assert.match(sent[0].message,/ALICE asks to unlock the VLB side of batch CMLL\/SASTI OC\/30TH -DEC-26\/S1\/B01/);assert.match(sent[0].message,/Reason: Wrong tipper on card 12/);assert.match(sent[0].message,/OTP \d{6}/);
 assert.equal((await call(path+'/approval-otp','POST',{purpose:'unlock_vlb',reason:'Wrong tipper on card 12'})).status,429,'one OTP per minute');
 const live=await call(path);assert.equal(live.data.approvalOtps.length,1);assert.equal(live.data.approvalOtps[0].id,unlockOtp.data.otp.id,'the live OTP survives a reload for the requester');
 assert.equal((await call(path,'GET',undefined,'bob')).data.approvalOtps.length,0,'another MIS user does not see it');
 const verifyRoute=path+'/approval-otp/'+unlockOtp.data.otp.id+'/verify';
 assert.equal((await call(verifyRoute,'POST',{otp:sent[0].otp},'bob')).status,404,'only the requester can enter the code');
 const wrong=await call(verifyRoute,'POST',{otp:'000000'});assert.equal(wrong.status,400);assert.match(wrong.data.error,/4 attempts left/);
 const unlocked=await call(verifyRoute,'POST',{otp:sent[0].otp});
 assert.equal(unlocked.status,200,JSON.stringify(unlocked.data));assert.equal(unlocked.data.unlocked,true);assert.equal(unlocked.data.batch.stage,'vlb_open');assert.equal(unlocked.data.batch.vlb_locked_at,null);
 const unlockAudit=unlocked.data.batch.audit.find(a=>a.action==='vlb_unlocked');assert.equal(unlockAudit.actor,'alice');assert.equal(unlockAudit.detail.via,'otp');assert.deepEqual(unlockAudit.detail.approvedBy,['pm','pm2']);assert.equal(unlockAudit.detail.reason,'Wrong tipper on card 12');
 assert.ok(unlocked.data.batch.audit.some(a=>a.action==='approval_otp_sent'&&a.detail.purpose==='unlock_vlb'));
 assert.match((await call(verifyRoute,'POST',{otp:sent[0].otp})).data.error,/already used/);

 // Close, then reopen by OTP
 assert.equal((await call(path+'/lock-vlb','POST',{})).status,200);
 const closed=await call(path+'/close','POST',{});assert.equal(closed.status,200,JSON.stringify(closed.data));assert.ok(closed.data.closed_at);assert.equal(closed.data.stage,'closed');
 assert.equal((await call(path+'/approval-otp','POST',{purpose:'unlock_vlb',reason:'Wrong tipper on card 12'})).status,409,'closed batches reopen first');
 assert.equal((await call(path+'/approval-otp','POST',{purpose:'reopen',reason:'Late scan card received'},'pm')).status,403,'PMs do not request reopening');
 const reopenOtp=await call(path+'/approval-otp','POST',{purpose:'reopen',reason:'Late scan card received'});
 assert.equal(reopenOtp.status,200,JSON.stringify(reopenOtp.data));assert.ok(reopenOtp.data.requestId);assert.equal(sent.length,2);assert.match(sent[1].message,/reopen the closed batch/);
 const pendingView=await call(path);assert.equal(pendingView.data.requests.find(r=>r.id===reopenOtp.data.requestId).status,'pending');assert.equal(pendingView.data.canReopen,false);
 assert.equal((await call(path+'/reopen-request','POST',{reason:'Late scan card received'})).data.id,reopenOtp.data.requestId,'the OTP request is the same reopening request the screen uses');
 const reopened=await call(path+'/approval-otp/'+reopenOtp.data.otp.id+'/verify','POST',{otp:sent[1].otp});
 assert.equal(reopened.status,200,JSON.stringify(reopened.data));assert.equal(reopened.data.approved,true);assert.equal(reopened.data.reopened,true);assert.equal(reopened.data.batch.closed_at,null);assert.equal(reopened.data.batch.amendment_by,'alice');assert.equal(reopened.data.batch.stage,'elb_open','reopens at the machine stage');
 const request=reopened.data.batch.requests.find(r=>r.id===reopenOtp.data.requestId);assert.equal(request.status,'used');assert.equal(request.decided_by,'pm');assert.match(request.decision_note,/Approved by OTP sent to pm, pm2/);
 const approvedAudit=reopened.data.batch.audit.find(a=>a.action==='reopen_approved');assert.equal(approvedAudit.detail.via,'otp');assert.equal(approvedAudit.actor,'alice');
 assert.equal(reopened.data.batch.audit.find(a=>a.action==='reopened').detail.approvedBy,'pm');

 // Approval survives when the reopen itself is blocked by another open batch at the site
 assert.equal((await call(path+'/close','POST',{})).status,200);
 const other=await call('','POST',{site:'Sasti OC',date:'2026-12-31',shift:'S1',requestKey:randomUUID()},'bob');assert.equal(other.status,201,JSON.stringify(other.data));
 const blockedOtp=await call(path+'/approval-otp','POST',{purpose:'reopen',reason:'Second correction after closure'});assert.equal(blockedOtp.status,200,JSON.stringify(blockedOtp.data));
 const blocked=await call(path+'/approval-otp/'+blockedOtp.data.otp.id+'/verify','POST',{otp:sent[2].otp});
 assert.equal(blocked.status,200,JSON.stringify(blocked.data));assert.equal(blocked.data.approved,true);assert.equal(blocked.data.reopened,false);assert.match(blocked.data.error,/Close the open batch/);assert.ok(blocked.data.batch.closed_at);assert.equal(blocked.data.batch.canReopen,true,'the approval is kept for the Reopen button');
 assert.equal((await call('/'+other.data.id+'/lock-vlb','POST',{},'bob')).status,200);assert.equal((await call('/'+other.data.id+'/close','POST',{},'bob')).status,200);
 const later=await call(path+'/reopen','POST',{});assert.equal(later.status,200,JSON.stringify(later.data));assert.equal(later.data.closed_at,null);
 assert.equal((await call(path+'/close','POST',{})).status,200);

 // On-screen self approval for a user who is both the MIS requester and the site PM
 const dualRequest=await call(path+'/reopen-request','POST',{reason:'Dual-role correction needed'},'dual');assert.equal(dualRequest.status,200,JSON.stringify(dualRequest.data));
 const dualDecision=await call(path+'/reopen-decision','POST',{requestId:dualRequest.data.id,decision:'approve'},'dual');assert.equal(dualDecision.status,200,JSON.stringify(dualDecision.data));assert.equal(dualDecision.data.decided_by,'dual');
 const dualReopen=await call(path+'/reopen','POST',{},'dual');assert.equal(dualReopen.status,200,JSON.stringify(dualReopen.data));assert.equal(dualReopen.data.amendment_by,'dual');
});
