import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerMisTelegram} from '../server/routes/mis-telegram.mjs';
import {createReleaseApprovalSample} from '../server/services/release-otp-delivery.mjs';

const admin={role:'super',login:'admin',permissions:{separateMisCredentials:true,misDesktopAccess:['Users & employees']}};
const user={role:'super',login:'person',permissions:{separateMisCredentials:true,adminLevel:'Admin',misDesktopAccess:[]}};

// Owner, 16 Nov 2026: see the release approval format in real Telegram without a real release.
test('the sample release approval goes to the approvers, says SAMPLE, and its buttons can approve nothing',async()=>{
 const pool={query:async(sql,params)=>{
  if(/Users & employees/.test(sql))return {rows:[{record_data:{login:'Anoop',mobile:'9925565281'}}]};
  if(/mis_telegram_links/.test(sql)){assert.deepEqual(params[0],['anoop','mohitchadda']);return {rows:[{chat_id:'11'},{chat_id:'22'}]};}
  throw Error(sql);
 }};
 const sent=[];
 const send=createReleaseApprovalSample({pool,sendButtons:async(chat,text,buttons,options)=>{sent.push({chat,text,buttons,options});return true}});
 assert.deepEqual(await send(),{sent:2});
 assert.deepEqual(sent.map(s=>s.chat),['11','22']);
 assert.deepEqual(sent[0].options,{parse_mode:'HTML'});
 assert.match(sent[0].text,/^🧪 <b>SAMPLE - format test only\.<\/b> Nothing is merged or released; the buttons do nothing\.\n\n<blockquote>🚀 <b>PULSE-II · MERGE \+ RELEASE TO PRODUCTION<\/b>/);
 assert.match(sent[0].text,/PR #348 — Driver continuing into the next shift/);
 const data=sent[0].buttons[0].map(b=>b.callback_data);
 assert.deepEqual(data,['rel:sample:a','rel:sample:r']);
 // The release handler only acts on /^rel:([0-9a-f]{16}):([ar])$/.
 for(const value of data)assert.ok(!/^rel:([0-9a-f]{16}):([ar])$/.test(value),value);
});

test('only an MIS administrator can send the sample, and only when Telegram is set up',async t=>{
 const db=new PGlite(),pool={query:(...args)=>args[0].includes('CREATE TABLE')?db.exec(args[0]):db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
 let config={enabled:true,webhookReady:true,botToken:'1:x'},calls=0,result={sent:2};
 const app=express();app.use(express.json());
 const service=registerMisTelegram(app,{pool,store:{read:async()=>config,write:async()=>{}},
  requireSession:(req,res,next)=>{req.session=req.get('Authorization')==='Bearer admin'?admin:user;next()},
  fetchImpl:async()=>{throw Error('no Telegram in this test')},
  sendReleaseApprovalSample:async()=>{calls++;return result}});
 await service.initialize();
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{service.stop();await new Promise(resolve=>server.close(resolve));await db.close()});
 const post=async actor=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/mis-telegram/test-release-approval`,{method:'POST',headers:{Authorization:'Bearer '+actor}});return {status:response.status,body:await response.json()}};
 assert.equal((await post('user')).status,403);
 assert.equal(calls,0);
 assert.deepEqual(await post('admin'),{status:200,body:{sent:2}});
 result={sent:0};
 const none=await post('admin');
 assert.equal(none.status,400);assert.match(none.body.error,/No release approver has connected Telegram/);
 config={enabled:false};
 assert.equal((await post('admin')).status,400);
 assert.equal(calls,2);
});
