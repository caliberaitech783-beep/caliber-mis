import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerMisTelegram} from '../mis-telegram.mjs';
const admin={role:'super',login:'admin',permissions:{separateMisCredentials:true,misDesktopAccess:['Users & employees']}},user={role:'super',login:'person',permissions:{separateMisCredentials:true,adminLevel:'Admin',misDesktopAccess:[]}};
test('private MIS Telegram setup, authenticated linking and durable notification retry',async t=>{
 const db=new PGlite(),pool={query:(...args)=>args[0].includes('CREATE TABLE')?db.exec(args[0]):db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
 let config,foreignWebhook='',failSend=false;const sends=[],audits=[];
 const store={read:async()=>config,write:async(key,value)=>{config=structuredClone(value)}};
 const app=express();app.use(express.json());app.use((req,res,next)=>{res.on('finish',()=>audits.push(req.audit===false?null:req.body));next()});
 const service=registerMisTelegram(app,{pool,store,requireSession:(req,res,next)=>{req.session=req.get('Authorization')==='Bearer admin'?admin:req.get('Authorization')==='Bearer user'?user:null;if(!req.session)return res.status(401).json({error:'Sign in'});next()},fetchImpl:async(url,options)=>{
  const method=url.split('/').at(-1),body=JSON.parse(options.body);
  if(method==='sendMessage'){sends.push(body);if(failSend)throw Error(url);}
  return {ok:true,json:async()=>({ok:true,result:method==='getMe'?{username:'CaliberMisTestBot'}:method==='getWebhookInfo'?{url:foreignWebhook}:true})};
 }});
 await service.initialize();const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{service.stop();await new Promise(resolve=>server.close(resolve));await db.close()});
 const base='http://127.0.0.1:'+server.address().port;
 const request=async(path,{method='GET',body,actor='admin',secret}={})=>{const response=await fetch(base+'/api/mis-telegram/'+path,{method,headers:{Authorization:'Bearer '+actor,'Content-Type':'application/json',...(secret?{'X-Telegram-Bot-Api-Secret-Token':secret}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()}};
 const token='123456:synthetic_token_abcdefghijklmnopqrstuvwxyz';
 await t.test('ordinary users cannot configure the bot, and rejected secret input is not audited',async()=>{
  const result=await request('settings',{method:'PUT',actor:'user',body:{botToken:token,enabled:true}});assert.equal(result.status,403);assert.equal(config,undefined);assert.ok(audits.every(entry=>!JSON.stringify(entry)?.includes(token)));
 });
 await t.test('a bot assigned to another application cannot be taken over',async()=>{
  foreignWebhook='https://pulse.cmll.in/api/telegram/webhook';const result=await request('settings',{method:'PUT',body:{botToken:token,enabled:true}});assert.equal(result.status,400);assert.equal(config,undefined);foreignWebhook='';
 });
 await t.test('setup persists privately and never returns the bot token or webhook secret',async()=>{
  const result=await request('settings',{method:'PUT',body:{botToken:token,enabled:true,adminChatId:'-10012345'}});assert.equal(result.status,200);assert.equal(result.body.webhookReady,true);assert.equal(config.botToken,token);
  const view=await request('settings');assert.ok(!JSON.stringify(view).includes(token));assert.ok(!JSON.stringify(view).includes(config.webhookSecret));
 });
 let link;
 await t.test('only authenticated private chats can consume a single-use link',async()=>{
  const result=await request('link',{method:'POST',actor:'user'});assert.equal(result.status,200);link=new URL(result.body.url).searchParams.get('start');
  const update={message:{text:'/start '+link,from:{id:42},chat:{id:42,type:'private'}}};
  assert.equal((await request('webhook',{method:'POST',body:update})).status,403);
  await request('webhook',{method:'POST',secret:config.webhookSecret,body:{message:{...update.message,chat:{id:42,type:'group'}}}});
  assert.equal((await request('me',{actor:'user'})).body.linked,false);
  assert.equal((await request('webhook',{method:'POST',secret:config.webhookSecret,body:update})).status,200);
  assert.equal((await request('me',{actor:'user'})).body.chatId,'42');
  await request('webhook',{method:'POST',secret:config.webhookSecret,body:{message:{...update.message,from:{id:99},chat:{id:99,type:'private'}}}});
  assert.equal((await request('me',{actor:'user'})).body.chatId,'42');
 });
 await t.test('expired links cannot replace a verified account connection',async()=>{
  const result=await request('link',{method:'POST',actor:'user'});await db.query("UPDATE mis_telegram_pending SET expires_at=NOW()-INTERVAL '1 second' WHERE used_at IS NULL");
  await request('webhook',{method:'POST',secret:config.webhookSecret,body:{message:{text:'/start '+new URL(result.body.url).searchParams.get('start'),from:{id:99},chat:{id:99,type:'private'}}}});
  assert.equal((await request('me',{actor:'user'})).body.chatId,'42');
 });
 const settle=async()=>{for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,10));const {rows}=await db.query("SELECT count(*)::int AS count FROM mis_telegram_outbox WHERE status='sending'");if(!rows[0].count&&i>3)return;}};
 await t.test('resolution queues admin and creator notifications once and recovers from delivery failure',async()=>{
  failSend=true;const ticket={reference:'TIC/TEST/0001',creatorLogin:'person',site:'Test',priority:'Medium',resolutionMessage:'Corrected'};
  await service.notify('resolved',ticket);await settle();
  let rows=(await db.query('SELECT * FROM mis_telegram_outbox')).rows;assert.equal(rows.length,2);assert.ok(rows.every(row=>row.status==='pending'&&row.attempts===1));assert.ok(rows.every(row=>!row.last_error.includes(token)));
  await service.notify('resolved',ticket);await settle();assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_telegram_outbox')).rows[0].n,2);
  failSend=false;await db.query('UPDATE mis_telegram_outbox SET next_attempt_at=NOW()');await service.drain();await settle();rows=(await db.query('SELECT * FROM mis_telegram_outbox')).rows;assert.ok(rows.every(row=>row.status==='sent'));
  assert.ok(sends.some(message=>message.chat_id==='42'&&message.text.includes('Corrected')));
 });
});
