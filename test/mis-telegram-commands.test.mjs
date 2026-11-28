import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerMisTelegram,MIS_BOT_COMMANDS,MIS_BOT_HELP} from '../server/routes/mis-telegram.mjs';

// Owner, 28 Nov 2026: the MIS bot answers /start, /help, /status and /stop, and its menu lists them.
const admin={role:'super',login:'admin',permissions:{separateMisCredentials:true,misDesktopAccess:['Users & employees']}};
const user={role:'super',login:'person',permissions:{separateMisCredentials:true,adminLevel:'Admin',misDesktopAccess:[]}};

test('MIS bot commands: menu, welcome, help, status, stop with confirmation',async t=>{
 const db=new PGlite(),pool={query:(...args)=>args[0].includes('CREATE TABLE')?db.exec(args[0]):db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
 let config;const sends=[],calls=[];
 const store={read:async()=>config,write:async(key,value)=>{config=structuredClone(value)}};
 const app=express();app.use(express.json());
 const service=registerMisTelegram(app,{pool,store,requireSession:(req,res,next)=>{req.session=req.get('Authorization')==='Bearer admin'?admin:req.get('Authorization')==='Bearer user'?user:null;if(!req.session)return res.status(401).json({error:'Sign in'});next()},fetchImpl:async(url,options)=>{
  const method=url.split('/').at(-1),body=JSON.parse(options.body);calls.push({method,body});
  if(method==='sendMessage')sends.push(body);
  return {ok:true,json:async()=>({ok:true,result:method==='getMe'?{username:'CaliberMisTestBot'}:method==='getWebhookInfo'?{url:''}:true})};
 }});
 await service.initialize();const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{service.stop();await new Promise(resolve=>server.close(resolve));await db.close()});
 const base='http://127.0.0.1:'+server.address().port;
 const request=async(path,{method='GET',body,actor='admin',secret}={})=>{const response=await fetch(base+'/api/mis-telegram/'+path,{method,headers:{Authorization:'Bearer '+actor,'Content-Type':'application/json',...(secret?{'X-Telegram-Bot-Api-Secret-Token':secret}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()}};
 const say=async(text,{id=42,type='private',from=id}={})=>{const before=sends.length;
  await request('webhook',{method:'POST',secret:config.webhookSecret,body:{message:{text,from:{id:from},chat:{id,type}}}});
  return sends.slice(before);};

 assert.equal((await request('settings',{method:'PUT',body:{botToken:'123456:synthetic_token_abcdefghijklmnopqrstuvwxyz',enabled:true}})).status,200);

 await t.test('setup sets the command menu: start, help, status, stop',()=>{
  const menu=calls.find(call=>call.method==='setMyCommands');
  assert.ok(menu,'setMyCommands was called');
  assert.deepEqual(menu.body.commands.map(row=>row.command),['start','help','status','stop']);
  assert.deepEqual(menu.body.commands,MIS_BOT_COMMANDS);
  assert.ok(MIS_BOT_COMMANDS.every(row=>row.description.length>=3&&row.description.length<=256));
 });

 await t.test('a person not connected gets the connect steps',async()=>{
  let replies=await say('/start');
  assert.equal(replies.length,1);assert.equal(replies[0].chat_id,'42');
  assert.match(replies[0].text,/Welcome to the Caliber Pulse-II MIS bot/);
  assert.match(replies[0].text,/Connect my Telegram/);
  assert.match(replies[0].text,/https:\/\/pulse-ll\.cmll\.in\/\?page=telegram/);
  replies=await say('/status');assert.match(replies[0].text,/not connected to any Pulse-II login/);
  replies=await say('/stop');assert.match(replies[0].text,/not connected, so Pulse-II sends nothing/);
  replies=await say('/help');assert.equal(replies[0].text,MIS_BOT_HELP);
  assert.match(MIS_BOT_HELP,/\/status/);assert.match(MIS_BOT_HELP,/\/stop/);
 });

 await t.test('an expired or used connect link says so',async()=>{
  const replies=await say('/start mis_'+'a'.repeat(32));
  assert.equal(replies.length,1);assert.match(replies[0].text,/expired or was already used/);
  assert.equal((await request('me',{actor:'user'})).body.linked,false);
 });

 await t.test('groups, channels and another sender get no reply',async()=>{
  assert.equal((await say('/help',{id:-1001,type:'group',from:42})).length,0);
  assert.equal((await say('/help',{id:42,from:7})).length,0);
 });

 await t.test('a connected person sees the login; /help also works with the bot name',async()=>{
  const link=new URL((await request('link',{method:'POST',actor:'user'})).body.url).searchParams.get('start');
  let replies=await say('/start '+link);
  assert.match(replies[0].text,/account is connected/);assert.match(replies[0].text,/\/help/);
  replies=await say('/start');assert.match(replies[0].text,/Welcome back.*PERSON/s);
  replies=await say('/status');assert.match(replies[0].text,/connected to Pulse-II:\n• PERSON \(since \d{2}-\d{2}-\d{4}\)/);
  replies=await say('/help@CaliberMisTestBot');assert.equal(replies[0].text,MIS_BOT_HELP);
 });

 await t.test('an unknown command is answered, never sent on as a reason text',async()=>{
  const replies=await say('/setdescription');
  assert.equal(replies.length,1);assert.match(replies[0].text,/do not know that command/);
 });

 await t.test('/stop asks first; /stop yes removes the connection',async()=>{
  let replies=await say('/stop');
  assert.match(replies[0].text,/approval requests too/);assert.match(replies[0].text,/\/stop yes/);
  assert.equal((await request('me',{actor:'user'})).body.linked,true,'nothing removed before yes');
  replies=await say('/stop now');assert.match(replies[0].text,/\/stop yes/);
  assert.equal((await request('me',{actor:'user'})).body.linked,true);
  replies=await say('/stop YES');
  assert.match(replies[0].text,/off for login PERSON/);assert.match(replies[0].text,/Connect my Telegram/);
  assert.equal((await request('me',{actor:'user'})).body.linked,false);
  replies=await say('/status');assert.match(replies[0].text,/not connected/);
 });

 await t.test('a disabled bot answers nothing',async()=>{
  config.enabled=false;
  assert.equal((await say('/help')).length,0);
  config.enabled=true;
 });
});
