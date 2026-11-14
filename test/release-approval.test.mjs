import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerReleaseApproval,releaseApprovalMessage} from '../server/routes/release-approval.mjs';
import {registerMisTelegram,MIS_TELEGRAM_UPDATES} from '../server/routes/mis-telegram.mjs';

const pglitePool=db=>{const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);return {query,connect:async()=>({query,release(){}})};};
const listen=async(t,app)=>{const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));return 'http://127.0.0.1:'+server.address().port;};

// Two release workflows sign their calls; the token here names the run.
const claimsFor=token=>{
 const [workflow,run,actor='caliberaitech783-beep']=String(token).split('|');
 if(!['prod','merge'].includes(workflow))throw Object.assign(new Error('Invalid release identity.'),{status:401});
 return {actor,run_id:run,sha:'a'.repeat(40),workflow_ref:`caliberaitech783-beep/caliber-mis/.github/workflows/${workflow==='prod'?'main_caliber-mis-783.yml':'merge-and-release.yml'}@refs/heads/main`};
};

async function harness(t,{linked=[['anoop','111'],['mohitchadda','222'],['siteuser','333']]}={}){
 const db=new PGlite();t.after(()=>db.close());const pool=pglitePool(db);
 await db.exec(`CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);
  CREATE TABLE mis_telegram_links(login_name TEXT PRIMARY KEY,chat_id TEXT NOT NULL,linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Users & employees',$1),('Users & employees',$2)",[JSON.stringify({login:'anoop',employee:'Anoop'}),JSON.stringify({login:'mohitchadda',employee:'Mohit Chadda'})]);
 for(const [login,chat] of linked)await db.query('INSERT INTO mis_telegram_links(login_name,chat_id) VALUES($1,$2)',[login,chat]);
 let clock=Date.parse('2026-11-15T10:00:00Z'),nextMessage=500;const sent=[],edits=[],handlers=new Map();
 const telegram={sendNow:async(chatId,text,markup)=>{sent.push({chatId,text,markup});return nextMessage++;},editText:async(chatId,messageId,text)=>{edits.push({chatId,messageId,text});},onCallback:(prefix,fn)=>handlers.set(prefix,fn)};
 const app=express();app.use(express.json());
 const audits=[];app.use((req,res,next)=>{res.on('finish',()=>{if(req.audit)audits.push(req.audit);});next();});
 const approval=registerReleaseApproval(app,{pool,telegram,verifyIdentity:async token=>claimsFor(token),approverLogins:async()=>['anoop','MohitChadda'],now:()=>new Date(clock),audit:(req,{action,details})=>{req.audit={action,details};}});
 await approval.initialize();
 const base=await listen(t,app);
 const call=async(path,token,body={})=>{const r=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const tap=(fromId,data)=>handlers.get('rapp')({fromId,data});
 return {db,call,tap,sent,edits,audits,advance:minutes=>{clock+=minutes*60000;}};
}
const PR={kind:'merge-release',prNumber:'300',prTitle:'Join sheet 2 of a VLB trip card to sheet 1',prHeadSha:'b'.repeat(40),changes:'11 files, +176 / -20; checks passed (2)',requestedBy:'Claude Code session for Mohit',computer:'MOHIT-PC',ip:'49.36.1.2',runUrl:'https://github.com/caliberaitech783-beep/caliber-mis/actions/runs/9'};

test('a merge request reaches both approvers with who asked, from where, and what goes live',async t=>{
 const h=await harness(t);
 const asked=await h.call('/api/release-approval/request','merge|9',PR);
 assert.equal(asked.status,200,JSON.stringify(asked.body));assert.equal(asked.body.sentTo,2);assert.equal(asked.body.expiresInMinutes,10);
 assert.deepEqual(h.sent.map(m=>m.chatId).sort(),['111','222'],'only Mr Anoop and Mr Mohit Chadda, never another linked login');
 const text=h.sent[0].text;
 for(const part of ['MERGE + RELEASE','PR #300: Join sheet 2','11 files, +176 / -20','Requested by: Claude Code session for Mohit','Computer: MOHIT-PC','IP address: 49.36.1.2','as given by the requester','GitHub account: caliberaitech783-beep (checked by GitHub)','runs/9','Approve = merge PR #300 into main and make it live now.'])assert.ok(text.includes(part),part);
 const buttons=h.sent[0].markup.inline_keyboard[0];
 assert.deepEqual(buttons.map(b=>b.text),['✅ Approve','❌ Reject']);
 assert.equal(buttons[0].callback_data,`rapp:${asked.body.id}:a`);assert.ok(Buffer.byteLength(buttons[0].callback_data)<=64);
 assert.equal((await h.call(`/api/release-approval/${asked.body.id}/status`,'merge|9')).body.status,'pending');
 // A production run cannot ask for a merge, and a merge run must name a PR and its head commit.
 assert.equal((await h.call('/api/release-approval/request','prod|5',PR)).status,400);
 assert.equal((await h.call('/api/release-approval/request','merge|9',{...PR,prHeadSha:''})).status,400);
 assert.equal((await h.call('/api/release-approval/request','nobody|1',PR)).status,401);
});

test('only an approver can answer, the first answer decides, and the release spends it once',async t=>{
 const h=await harness(t);
 const {body:{id}}=await h.call('/api/release-approval/request','merge|9',PR);
 assert.match(await h.tap('333',`rapp:${id}:a`),/Only Mr Anoop or Mr Mohit Chadda/);
 assert.match(await h.tap('999',`rapp:${id}:a`),/Only Mr Anoop or Mr Mohit Chadda/);
 assert.equal((await h.call(`/api/release-approval/${id}/status`,'merge|9')).body.status,'pending');
 assert.match(await h.tap('222',`rapp:${id}:a`),/Approved\. The release starts now/);
 const status=(await h.call(`/api/release-approval/${id}/status`,'merge|9')).body;
 assert.equal(status.status,'approved');assert.equal(status.decidedBy,'Mohit Chadda');
 assert.equal(h.edits.length,2,'both messages lose their buttons');
 assert.ok(h.edits.every(e=>/✅ APPROVED by Mohit Chadda \(mohitchadda\) at .* IST\. Merging PR #300 and releasing now\./.test(e.text)));
 assert.match(await h.tap('111',`rapp:${id}:r`),/Already approved by Mohit Chadda/);
 // Spent by the production release only, once.
 assert.equal((await h.call(`/api/release-approval/${id}/use`,'merge|9')).status,403);
 const used=await h.call(`/api/release-approval/${id}/use`,'prod|77');
 assert.equal(used.status,200);assert.deepEqual([used.body.prNumber,used.body.decidedBy],[300,'Mohit Chadda']);
 const again=await h.call(`/api/release-approval/${id}/use`,'prod|78');
 assert.equal(again.status,409);assert.match(again.body.error,/already used/);
 assert.ok(h.audits.some(a=>a.action==='Release approval requested'&&a.details.ip==='49.36.1.2'));
 assert.ok(h.audits.some(a=>a.action==='Release approval used'&&a.details.approvedBy==='mohitchadda'));
});

test('reject, expiry, a newer request and an old approval all stop the release',async t=>{
 const h=await harness(t);
 const release=await h.call('/api/release-approval/request','prod|5',{kind:'release',requestedBy:'Mohit',computer:'PC',ip:'1.2.3.4'});
 assert.equal(release.status,200);assert.match(h.sent[0].text,/URGENT RELEASE/);assert.match(h.sent[0].text,/Approve = make main live now\./);
 assert.match(await h.tap('111',`rapp:${release.body.id}:r`),/Rejected/);
 assert.ok(h.edits.some(e=>/❌ REJECTED by Anoop \(anoop\)/.test(e.text)));
 assert.equal((await h.call(`/api/release-approval/${release.body.id}/use`,'prod|5')).status,409);
 // Nobody answers in ten minutes.
 const late=await h.call('/api/release-approval/request','prod|6',{kind:'release'});
 h.advance(11);
 assert.equal((await h.call(`/api/release-approval/${late.body.id}/status`,'prod|6')).body.status,'expired');
 assert.ok(h.edits.some(e=>/EXPIRED: nobody answered in time/.test(e.text)));
 assert.match(await h.tap('222',`rapp:${late.body.id}:a`),/Already expired|expired/i);
 // A newer request closes the older unanswered one.
 const first=await h.call('/api/release-approval/request','prod|7',{kind:'release'});
 const second=await h.call('/api/release-approval/request','prod|8',{kind:'release'});
 assert.equal((await h.call(`/api/release-approval/${first.body.id}/status`,'prod|8')).body.status,'replaced');
 assert.ok(h.edits.some(e=>/REPLACED by a newer request/.test(e.text)));
 // An urgent-release approval belongs to the run that asked; and it must be used within 30 minutes.
 await h.tap('222',`rapp:${second.body.id}:a`);
 assert.equal((await h.call(`/api/release-approval/${second.body.id}/use`,'prod|99')).status,403);
 h.advance(31);
 const stale=await h.call(`/api/release-approval/${second.body.id}/use`,'prod|8');
 assert.equal(stale.status,409);assert.match(stale.body.error,/older than 30 minutes/);
});

test('nobody linked on Telegram means no approval can be asked for',async t=>{
 const h=await harness(t,{linked:[['siteuser','333']]});
 const asked=await h.call('/api/release-approval/request','prod|5',{kind:'release'});
 assert.equal(asked.status,503);assert.match(asked.body.error,/has linked Telegram/);
});

test('the message says the requester details are not verified when they are missing',()=>{
 const text=releaseApprovalMessage({kind:'release',main_sha:'c'.repeat(40),actor:'someone'});
 assert.match(text,/Requested by: \(name not given\)/);assert.match(text,/IP address: \(not given\)/);assert.match(text,/Main: ccccccc/);
});

test('the MIS bot listens for button taps, routes them by prefix and shows the answer',async t=>{
 const db=new PGlite();t.after(()=>db.close());const pool=pglitePool(db);
 let config,allowed=['message'];const calls=[];
 const store={read:async()=>config,write:async(key,value)=>{config=structuredClone(value);}};
 const app=express();app.use(express.json());
 const bot=registerMisTelegram(app,{pool,store,requireSession:(req,res,next)=>{req.session={role:'super',login:'admin',permissions:{separateMisCredentials:true,misDesktopAccess:['Users & employees']}};next();},fetchImpl:async(url,options)=>{
  const method=url.split('/').at(-1),body=JSON.parse(options.body);calls.push({method,body});
  if(method==='setWebhook')allowed=body.allowed_updates;
  const result=method==='getMe'?{username:'CaliberMisTestBot'}:method==='getWebhookInfo'?{url:config?.webhookReady?'https://pulse-ll.cmll.in/api/mis-telegram/webhook':'',allowed_updates:allowed}:method==='sendMessage'?{message_id:812}:true;
  return {ok:true,json:async()=>({ok:true,result})};
 }});
 await bot.initialize();const base=await listen(t,app);t.after(()=>bot.stop());
 const put=await fetch(base+'/api/mis-telegram/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({botToken:'123456:synthetic_token_abcdefghijklmnopqrstuvwxyz',enabled:true})});
 assert.equal(put.status,200);
 assert.deepEqual(calls.find(c=>c.method==='setWebhook').body.allowed_updates,[...MIS_TELEGRAM_UPDATES]);
 assert.ok(MIS_TELEGRAM_UPDATES.includes('callback_query'));
 // A bot configured before buttons existed is moved to message + callback_query once.
 allowed=['message'];calls.length=0;await bot.ensureUpdates();
 assert.deepEqual(calls.map(c=>c.method),['getWebhookInfo','setWebhook']);
 calls.length=0;await bot.ensureUpdates();assert.deepEqual(calls.map(c=>c.method),['getWebhookInfo'],'already listening: nothing changes');
 // Taps go to the handler of their prefix; Telegram shows its answer.
 const seen=[];bot.onCallback('rapp',async tap=>{seen.push(tap);return 'Approved. The release starts now.';});
 const webhook=body=>fetch(base+'/api/mis-telegram/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':config.webhookSecret},body:JSON.stringify(body)});
 calls.length=0;
 assert.equal((await webhook({callback_query:{id:'cb1',from:{id:222},data:'rapp:x:a',message:{message_id:5,chat:{id:222}}}})).status,200);
 assert.deepEqual(seen,[{fromId:'222',data:'rapp:x:a'}]);
 assert.deepEqual(calls.map(c=>[c.method,c.body.callback_query_id,c.body.text]),[['answerCallbackQuery','cb1','Approved. The release starts now.']]);
 calls.length=0;await webhook({callback_query:{id:'cb2',from:{id:222},data:'other:1'}});
 assert.equal(calls[0].body.text,'This button is no longer active.');
 // Without the webhook secret a tap does nothing.
 const forged=await fetch(base+'/api/mis-telegram/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query:{id:'cb3',from:{id:222},data:'rapp:x:a'}})});
 assert.equal(forged.status,403);assert.equal(seen.length,1);
 // Messages with buttons are sent at once and can be closed later.
 calls.length=0;
 assert.equal(await bot.sendNow('222','Approve?',{inline_keyboard:[[{text:'✅ Approve',callback_data:'rapp:x:a'}]]}),812);
 await bot.editText('222',812,'Approved.');
 assert.deepEqual(calls.map(c=>c.method),['sendMessage','editMessageText']);
 assert.equal(calls[0].body.reply_markup.inline_keyboard[0][0].callback_data,'rapp:x:a');
 assert.equal(calls[1].body.reply_markup,undefined,'an edit removes the buttons');
});
