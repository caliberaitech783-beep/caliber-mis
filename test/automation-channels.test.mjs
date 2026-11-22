import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {AUTOMATIONS,automationRows} from '../server/rules/automation-catalogue.mjs';
import {configureAutomationSwitches,automationForEventKey} from '../server/services/automation-switches.mjs';
import {CHANNEL_AUTOMATION_KEYS,channelEventKey,channelPostCounts,createChannelCode,linkChannelFromPost,noteChannelMembership,
 normalizeAutomationChannels,queueChannelCopy,readAutomationChannels,unlinkAutomationChannel,AUTOMATION_CHANNELS_SCHEMA} from '../server/services/automation-channels.mjs';
import {telegramOutboxSender} from '../server/services/otp-delivery.mjs';
import {MIS_TELEGRAM_SCHEMA,MIS_TELEGRAM_UPDATES,registerMisTelegram} from '../server/routes/mis-telegram.mjs';
import {registerAutomationCentre} from '../server/routes/automation-centre.mjs';

const CHANNEL='-1001234567890';
async function database(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB,updated_at TIMESTAMPTZ);
  CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);
  ${MIS_TELEGRAM_SCHEMA}${AUTOMATION_CHANNELS_SCHEMA}`);
 const pool={query:(sql,args)=>args?db.query(sql,args):db.exec(sql).then(results=>results.at(-1)),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
 configureAutomationSwitches({pool});t.after(()=>configureAutomationSwitches({}));
 return {db,pool};
}
const fakeTelegram=()=>{const calls=[];return {calls,call:async(method,body)=>{calls.push({method,body});return method==='createChatInviteLink'?{invite_link:'https://t.me/+abcDEF123'}:true;}};};
const post=(code,over={})=>({message_id:7,chat:{id:Number(CHANNEL),type:'channel',title:'Pulse-II A25 Speed report'},text:code,...over});

test('only Pulse-II bot lines can have a channel; approval codes never',()=>{
 for(const key of ['alias-otp','transfer-otp','equipment-otp','vlb-approval-otp','password-otp','deletion-otp'])assert.equal(CHANNEL_AUTOMATION_KEYS.has(key),false,key);
 for(const key of ['equipment-mismatch','vlb-batch-not-created','vlb-batch-not-closed','pulse-pending','alias-suspended','alias-weekly','mis-ticket','scan-batch-report','health-report'])assert.equal(CHANNEL_AUTOMATION_KEYS.has(key),true,key);
 // A stored OTP channel is dropped whatever is saved.
 assert.deepEqual(normalizeAutomationChannels({'transfer-otp':{chatId:CHANNEL,title:'x'}}),{});
 // Every line says why it has no channel button.
 const rows=automationRows({misTelegram:{enabled:true},pulseTelegram:{configured:true},pulseTelegramPurpose:()=>true,vlbAlerts:{pulseAdminLogins:[]},mismatch:{logins:[]},whatsappSettings:{},switches:{}});
 for(const row of rows)assert.ok(row.channel.allowed||row.channel.note,row.code);
 assert.match(rows.find(row=>row.key==='transfer-otp').channel.note,/never posted in a channel/);
 assert.match(rows.find(row=>row.key==='request-opened').channel.note,/Pulse bot/);
});

test('the channel copy is queued once per event, not once per person',()=>{
 assert.equal(channelEventKey('health-report:2026-11-16T10:anil','anil'),'channel:health-report:2026-11-16T10');
 assert.equal(channelEventKey('vlb-alert:site|not_closed:2026-11-16|1:2','pm1'),'channel:vlb-alert:site|not_closed:2026-11-16|1:2');
 assert.equal(automationForEventKey(channelEventKey('vlb-alert:x|not_closed:1:2','').slice(8)),'vlb-batch-not-closed');
});

test('a posted code links the channel; messages then go to it once; removal stops it',async t=>{
 const {db,pool}=await database(t),telegram=fakeTelegram();
 await assert.rejects(createChannelCode(pool,{key:'transfer-otp',login:'admin'}),/cannot post to a channel/);
 const {code}=await createChannelCode(pool,{key:'health-report',login:'Admin'});
 assert.match(code,/^pulse-link-[a-z0-9]{10}$/);
 // A group, a wrong code or a code inside a private chat does not link.
 assert.equal(await linkChannelFromPost(pool,post(code,{chat:{id:-100555,type:'supergroup'}}),telegram),null);
 assert.equal(await linkChannelFromPost(pool,post('pulse-link-aaaaaaaaaa'),telegram),null);
 assert.deepEqual(await linkChannelFromPost(pool,post('Linking: '+code.toUpperCase()),telegram),{linked:'health-report'});
 const saved=(await readAutomationChannels(pool))['health-report'];
 assert.equal(saved.chatId,CHANNEL);assert.equal(saved.inviteLink,'https://t.me/+abcDEF123');assert.equal(saved.linkedBy,'admin');
 assert.deepEqual(telegram.calls.map(call=>call.method),['createChatInviteLink','deleteMessage','sendMessage']);
 // The code works once.
 assert.equal(await linkChannelFromPost(pool,post(code),telegram),null);

 await db.query("INSERT INTO mis_telegram_links(login_name,chat_id) VALUES('anil','111')");
 const sender=telegramOutboxSender(pool);
 assert.equal(await sender.send('anil','Speed report',`health-report:r1:anil`,{html:true,photo:{speed:{verdict:'green'}}}),true);
 assert.equal(await sender.send('ravi','Speed report',`health-report:r1:ravi`,{html:true}),false);
 // An approval code is never copied to a channel.
 assert.equal(await queueChannelCopy(pool,{eventKey:'transfer-otp:5:anil',login:'anil',message:'123456'}),false);
 let rows=(await db.query('SELECT event_key,chat_id,parse_mode,photo FROM mis_telegram_outbox ORDER BY id')).rows;
 assert.deepEqual(rows.map(row=>[row.event_key,row.chat_id]),[['channel:health-report:r1',CHANNEL],['health-report:r1:anil','111']]);
 assert.equal(rows[0].parse_mode,'HTML');assert.deepEqual(rows[0].photo,{speed:{verdict:'green'}});
 await db.query("UPDATE mis_telegram_outbox SET status='sent'");
 assert.deepEqual(Object.keys(await channelPostCounts(pool)),['health-report']);
 assert.equal((await channelPostCounts(pool))['health-report'].sent,1);

 // One message per person (owner, 22 Nov 2026): a member of the channel gets only the channel post; someone not in
 // it, or when Telegram cannot say, still gets the personal chat.
 await db.query("INSERT INTO mis_telegram_links(login_name,chat_id) VALUES('mohit','222'),('sunil','333')");
 const asked=[];
 const members=telegramOutboxSender(pool,{inChannel:async(channel,person)=>{asked.push([channel,person]);if(person==='333')throw Error('Telegram down');return person==='222';}});
 assert.equal(await members.send('mohit','Speed report','health-report:r9:mohit'),true);
 assert.equal(await members.send('anil','Speed report','health-report:r9:anil'),true);
 assert.equal(await members.send('sunil','Speed report','health-report:r9:sunil'),true);
 assert.deepEqual(asked,[[CHANNEL,'222'],[CHANNEL,'111'],[CHANNEL,'333']]);
 assert.deepEqual((await db.query("SELECT event_key FROM mis_telegram_outbox WHERE event_key LIKE '%r9%' ORDER BY id")).rows.map(row=>row.event_key),
  ['channel:health-report:r9','health-report:r9:anil','health-report:r9:sunil']);
 // An approval code never asks: it has no channel, so it always goes to the personal chat.
 asked.length=0;
 assert.equal(await members.send('mohit','123456','transfer-otp:9:mohit'),true);
 assert.deepEqual(asked,[]);
 await db.query("DELETE FROM mis_telegram_outbox WHERE event_key LIKE '%r9%' OR event_key LIKE 'transfer-otp:%'");

 // The bot removed from the channel: nothing more is posted there until it is an administrator again.
 assert.equal(await noteChannelMembership(pool,{chat:{id:Number(CHANNEL),type:'channel',title:'Pulse-II A25 Speed report'},new_chat_member:{status:'left'}}),true);
 assert.ok((await readAutomationChannels(pool))['health-report'].lostAt);
 assert.equal(await queueChannelCopy(pool,{eventKey:'health-report:r2:anil',login:'anil',message:'x'}),false);
 await noteChannelMembership(pool,{chat:{id:Number(CHANNEL),type:'channel'},new_chat_member:{status:'administrator',can_post_messages:true}});
 assert.equal(await queueChannelCopy(pool,{eventKey:'health-report:r2:anil',login:'anil',message:'x'}),true);
 await unlinkAutomationChannel(pool,'health-report');
 assert.equal(await queueChannelCopy(pool,{eventKey:'health-report:r3:anil',login:'anil',message:'x'}),false);
});

test('webhook and Automation Centre routes: code, link by channel post, test post, unlink',async t=>{
 const {db,pool}=await database(t);
 assert.ok(MIS_TELEGRAM_UPDATES.includes('channel_post')&&MIS_TELEGRAM_UPDATES.includes('my_chat_member'));
 const config={botToken:'123456:synthetic_token_abcdefghijklmnopqrstuvwxyz',enabled:true,webhookReady:true,webhookSecret:'secret-1',botUsername:'CaliberMisTestBot'};
 const sends=[];
 const fetchImpl=async(url,options)=>{const method=url.split('/').at(-1),body=JSON.parse(options.body);sends.push({method,body});
  return {ok:true,json:async()=>({ok:true,result:method==='createChatInviteLink'?{invite_link:'https://t.me/+join'}:true})};};
 const app=express();app.use(express.json());
 const requireSession=(req,res,next)=>{req.session={login:'admin',name:'Admin'};next();};
 const misTelegram=registerMisTelegram(app,{pool,store:{read:async()=>config,write:async()=>{}},requireSession,fetchImpl});
 registerAutomationCentre(app,{pool,requireSession,requireAdministrator:(req,res,next)=>next(),centre:{overview:async()=>({})},misTelegram});
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{misTelegram.stop();server.close();});
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(path,method='GET',body,headers={})=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};

 assert.equal((await call('/api/automation-centre/channel/code','POST',{key:'alias-otp'})).status,400);
 const started=await call('/api/automation-centre/channel/code','POST',{key:'scan-batch-report'});
 assert.equal(started.status,200);assert.equal(started.body.botUsername,'CaliberMisTestBot');assert.equal(started.body.linked,null);
 assert.ok(!JSON.stringify(started.body).includes(config.botToken));
 // A post without the webhook secret is refused.
 assert.equal((await call('/api/mis-telegram/webhook','POST',{channel_post:post(started.body.linkCode)})).status,403);
 assert.equal((await call('/api/mis-telegram/webhook','POST',{update_id:1,channel_post:post(started.body.linkCode)},{'X-Telegram-Bot-Api-Secret-Token':'secret-1'})).status,200);
 const view=await call('/api/automation-centre/channel?key=scan-batch-report');
 assert.equal(view.body.linked.title,'Pulse-II A25 Speed report');assert.equal(view.body.linked.inviteLink,'https://t.me/+join');
 assert.ok(!JSON.stringify(view.body).includes(CHANNEL),'the chat id stays on the server');
 assert.equal((await call('/api/automation-centre/channel/test','POST',{key:'scan-batch-report'})).status,200);
 assert.ok(sends.some(entry=>entry.method==='sendMessage'&&entry.body.chat_id===CHANNEL&&/Test post: A24/.test(entry.body.text)));
 const removed=await call('/api/automation-centre/channel','DELETE',{key:'scan-batch-report'});
 assert.equal(removed.body.linked,null);
 assert.equal((await call('/api/automation-centre/channel/test','POST',{key:'scan-batch-report'})).status,409);
 void db;
});

test('channel membership: asked of Telegram once, remembered, failures not remembered',async t=>{
 const {pool}=await database(t);
 const config={botToken:'123456:synthetic_token_abcdefghijklmnopqrstuvwxyz',enabled:true,webhookReady:true,webhookSecret:'s'};
 const asked=[];let down=false;
 const status={'222':'member','333':'left','444':'administrator','555':'restricted'};
 const fetchImpl=async(url,options)=>{const body=JSON.parse(options.body);asked.push([url.split('/').at(-1),body.chat_id,body.user_id]);
  if(down)throw Object.assign(Error('down'),{code:'ECONNRESET'});
  return {ok:true,json:async()=>({ok:true,result:{status:status[String(body.user_id)],is_member:false}})};};
 const misTelegram=registerMisTelegram(express(),{pool,store:{read:async()=>config,write:async()=>{}},requireSession:(req,res,next)=>next(),fetchImpl});
 t.after(()=>misTelegram.stop());
 assert.equal(await misTelegram.inChannel(CHANNEL,'222'),true);
 assert.equal(await misTelegram.inChannel(CHANNEL,'333'),false);
 assert.equal(await misTelegram.inChannel(CHANNEL,'444'),true);
 assert.equal(await misTelegram.inChannel(CHANNEL,'555'),false);
 assert.deepEqual(asked[0],['getChatMember',CHANNEL,222]);
 assert.equal(await misTelegram.inChannel(CHANNEL,'222'),true);
 assert.equal(asked.length,4);
 down=true;
 assert.equal(await misTelegram.inChannel(CHANNEL,'666'),false);
 down=false;status['666']='member';
 assert.equal(await misTelegram.inChannel(CHANNEL,'666'),true);
});

test('catalogue keys used for channels all exist',()=>{
 for(const key of CHANNEL_AUTOMATION_KEYS)assert.ok(AUTOMATIONS.some(item=>item.key===key));
});
