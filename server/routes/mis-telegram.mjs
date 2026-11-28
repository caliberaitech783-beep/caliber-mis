import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {requireMisAdministrator} from '../../shared/mis-admin-access.mjs';
import {telegramFetch} from '../services/telegram-fetch.mjs';
import {automationOn} from '../services/automation-switches.mjs';
import {siteReportBanner,speedReportBanner} from '../services/site-report-banner.mjs';
import {batchReportCard} from '../services/batch-report-card.mjs';
import {AUTOMATION_CHANNELS_SCHEMA,linkChannelFromPost,noteChannelMembership,queueChannelCopy} from '../services/automation-channels.mjs';
const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const key='mis-telegram';
const webhook='https://pulse-ll.cmll.in/api/mis-telegram/webhook';
// channel_post + my_chat_member (16 Nov 2026): linking an automation's Telegram channel by a posted code,
// and noticing when the bot is removed from such a channel.
export const MIS_TELEGRAM_UPDATES=['message','callback_query','channel_post','my_chat_member'];
// The bot's command menu (owner, 28 Nov 2026), set on Telegram at every start so it always matches the replies below.
export const MIS_BOT_COMMANDS=[
 {command:'start',description:'Welcome and how to connect'},
 {command:'help',description:'What this bot sends'},
 {command:'status',description:'Is this Telegram connected?'},
 {command:'stop',description:'Turn off messages here'},
];
const TELEGRAM_PAGE='https://pulse-ll.cmll.in/?page=telegram';
const CONNECT_STEPS=`To connect: sign in to Pulse-II, open Telegram Integration (${TELEGRAM_PAGE}) and press "Connect my Telegram". The link opens this chat and connects your login.`;
export const MIS_BOT_HELP=['Caliber Pulse-II MIS bot','','It sends you:','• Shift and VLB batch alerts for your site','• Reports such as the speed report','• Approval requests and release updates','• Updates on your MIS tickets','','Commands:','/status – is this Telegram connected?','/stop – turn off messages here','/help – this message','',CONNECT_STEPS].join('\n');
const shownDate=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleDateString('en-GB',{timeZone:'Asia/Kolkata'}).replace(/\//g,'-')};
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&x.length>0&&timingSafeEqual(x,y)};
export const MIS_TELEGRAM_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_telegram_links(login_name TEXT PRIMARY KEY,chat_id TEXT NOT NULL,linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS mis_telegram_pending(token_hash TEXT PRIMARY KEY,login_name TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ);
 CREATE TABLE IF NOT EXISTS mis_telegram_outbox(id BIGSERIAL PRIMARY KEY,event_key TEXT UNIQUE NOT NULL,chat_id TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),lease_until TIMESTAMPTZ,last_error TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 ALTER TABLE mis_telegram_outbox ADD COLUMN IF NOT EXISTS parse_mode TEXT NOT NULL DEFAULT '';
 ALTER TABLE mis_telegram_outbox ADD COLUMN IF NOT EXISTS photo JSONB;
`;
export function registerMisTelegram(app,{pool,store,requireSession,fetchImpl=telegramFetch,onCallback=null,onText=null,sendReleaseApprovalSample=null}){
 const hideAudit=(req,res,next)=>{req.audit=false;next()};
 const read=async()=>await store.read(key)||{};
 const login=req=>String(req.session.login||'').trim().toLowerCase();
 // The error says why: Telegram could not be reached, or Telegram refused (its own reason, e.g. Unauthorized for a
 // wrong token). Neither text carries the bot token.
 const call=async(config,method,body={})=>{
  let response,data;
  try{response=await fetchImpl(`https://api.telegram.org/bot${config.botToken}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}
  catch(error){const message=`The MIS server could not reach Telegram (${String(error?.code||error?.cause?.code||error?.name||'no answer').replace(/[^A-Z0-9_]/gi,'').slice(0,40)}). Please retry in a minute.`;throw Object.assign(Error(message),{status:503,publicMessage:message});}
  try{data=await response.json();}catch{data=null;}
  if(!response.ok||data?.ok!==true){
   const reason=String(data?.description||`HTTP ${response.status}`).replace(/bot\d+:[A-Za-z0-9_-]+/g,'bot').slice(0,200);
   const message=response.status===401||response.status===404?`Telegram refused the bot token (${reason}). Copy the token again from BotFather.`:`Telegram refused the request: ${reason}`;
   throw Object.assign(Error(message),{status:response.status===401||response.status===404?400:502,publicMessage:message});
  }
  return data.result;
 };

 const view=config=>({configured:Boolean(config.botToken),enabled:config.enabled===true,botUsername:config.botUsername||'',adminChatId:config.adminChatId||'',webhookReady:config.webhookReady===true});
 const wrap=handler=>async(req,res,next)=>{req.audit=false;res.set('Cache-Control','no-store');try{await handler(req,res)}catch(error){res.status(error.status||503).json({error:error.publicMessage||'Telegram is temporarily unavailable. Please retry.'})}};
 const invalid=message=>{throw Object.assign(Error(message),{status:400,publicMessage:message})};
 const admin=[requireSession,requireMisAdministrator];
 app.get('/api/mis-telegram/settings',...admin,wrap(async(req,res)=>{
  const config=await read(),{rows}=await pool.query("SELECT status,count(*)::int AS count FROM mis_telegram_outbox GROUP BY status");res.json({...view(config),delivery:rows});
 }));
 // Administrators see who has connected Telegram: login, name from Users & employees, and when. No chat IDs.
 app.get('/api/mis-telegram/links',...admin,wrap(async(req,res)=>{
  let rows;
  try{rows=(await pool.query(`SELECT l.login_name,l.linked_at,(SELECT m.record_data->>'employee' FROM master_records m WHERE m.master_name='Users & employees' AND lower(trim(m.record_data->>'login'))=l.login_name ORDER BY m.id DESC LIMIT 1) AS employee FROM mis_telegram_links l ORDER BY l.linked_at DESC`)).rows;}
  catch{rows=(await pool.query('SELECT login_name,linked_at FROM mis_telegram_links ORDER BY linked_at DESC')).rows;}
  res.json({people:rows.map(row=>({login:row.login_name,name:String(row.employee||'').trim(),linkedAt:row.linked_at}))});
 }));
 app.put('/api/mis-telegram/settings',hideAudit,...admin,wrap(async(req,res)=>{
  const old=await read(),botToken=String(req.body.botToken||old.botToken||'').trim(),adminChatId=String(req.body.adminChatId??old.adminChatId??'').trim();
  if(!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(botToken)||botToken.length>200)invalid('Enter a valid dedicated MIS bot token.');
  if(adminChatId&&!/^-?[1-9]\d{0,18}$/.test(adminChatId))invalid('Enter a valid Telegram admin chat ID.');
  const config={...old,botToken,adminChatId,enabled:req.body.enabled===true};
  const bot=await call(config,'getMe'),info=await call(config,'getWebhookInfo');
  if(!/^[A-Za-z0-9_]{5,32}$/.test(bot.username||''))invalid('This bot has no usable username.');
  if(info.url&&info.url!==webhook)invalid('This bot is connected to a different application. Use a dedicated MIS bot to keep that application working.');
  config.botUsername=bot.username;config.webhookSecret=old.webhookSecret||randomBytes(32).toString('base64url');config.webhookReady=false;
  await store.write(key,config);
  await call(config,'setWebhook',{url:webhook,secret_token:config.webhookSecret,allowed_updates:MIS_TELEGRAM_UPDATES,drop_pending_updates:false});
  config.webhookReady=true;await store.write(key,config);
  await call(config,'setMyCommands',{commands:MIS_BOT_COMMANDS}).catch(()=>{});
  res.json(view(config));
 }));
 app.get('/api/mis-telegram/me',requireSession,wrap(async(req,res)=>{
  const config=await read(),{rows}=await pool.query('SELECT chat_id,linked_at FROM mis_telegram_links WHERE login_name=$1',[login(req)]);
  res.json({configured:Boolean(config.botToken),enabled:config.enabled===true,botUsername:config.botUsername||'',linked:Boolean(rows[0]),chatId:rows[0]?.chat_id||'',linkedAt:rows[0]?.linked_at||null});
 }));
 app.post('/api/mis-telegram/link',requireSession,wrap(async(req,res)=>{
  const config=await read();if(!config.enabled||!config.webhookReady)invalid('Ask your MIS administrator to configure and enable Telegram first.');
  const token=randomBytes(24).toString('base64url');
  await pool.query("INSERT INTO mis_telegram_pending(token_hash,login_name,expires_at) VALUES($1,$2,NOW()+INTERVAL '10 minutes')",[digest(token),login(req)]);
  res.json({url:`https://t.me/${config.botUsername}?start=mis_${token}`,expiresIn:600});
 }));
 app.post('/api/mis-telegram/test',...admin,wrap(async(req,res)=>{
  const config=await read();if(!config.enabled||!config.adminChatId)invalid('Enable Telegram and enter the admin chat ID first.');
  await call(config,'sendMessage',{chat_id:config.adminChatId,text:'Caliber Pulse-II MIS Telegram connection is working.',disable_web_page_preview:true});res.json({sent:true});
 }));
 // A SAMPLE release approval to the approvers' linked Telegram, to check the format. Its buttons do nothing.
 app.post('/api/mis-telegram/test-release-approval',...admin,wrap(async(req,res)=>{
  const config=await read();if(!config.enabled||!config.webhookReady||!sendReleaseApprovalSample)invalid('Enable Telegram and finish the bot setup first.');
  const {sent}=await sendReleaseApprovalSample();
  if(!sent)invalid('No release approver has connected Telegram, so the sample was not sent.');
  req.audit={eventType:'Integration',module:'Telegram',action:'Sample release approval sent',targetType:'Telegram',targetReference:'release-approval-sample',details:{sent}};
  res.json({sent});
 }));
 app.post('/api/mis-telegram/webhook',wrap(async(req,res)=>{
  const config=await read();if(!equal(req.get('X-Telegram-Bot-Api-Secret-Token'),config.webhookSecret))return res.status(403).json({error:'Invalid webhook authentication.'});
  // A tapped button (urgent release Approve / Reject). Only a private chat linked to an MIS login counts.
  const query=req.body?.callback_query;
  if(query){
   let answer='This button is no longer active.';
   try{
    const chatId=String(query.message?.chat?.id||''),fromId=String(query.from?.id||'');
    if(config.enabled&&onCallback&&chatId&&chatId===fromId&&query.message?.chat?.type==='private'){
     const {rows}=await pool.query('SELECT login_name FROM mis_telegram_links WHERE chat_id=$1',[chatId]);
     const result=await onCallback({data:String(query.data||''),logins:rows.map(row=>row.login_name),chatId});
     if(result?.answer)answer=result.answer;
     // Telegram gives the shown text without its HTML; its entities keep the bold and link after the edit.
     // keepOtherButtons (a summary of several attendance days): only the tapped button's row goes; without it every button goes.
     if(result?.done){const kept=String(query.message.text||'').slice(0,3500),entities=(query.message.entities||[]).filter(e=>e.offset+e.length<=kept.length);
      const rows=result.keepOtherButtons?(query.message.reply_markup?.inline_keyboard||[]).filter(row=>Array.isArray(row)&&!row.some(button=>button?.callback_data===query.data)):[];
      await call(config,'editMessageText',{chat_id:chatId,message_id:query.message.message_id,text:kept+'\n\n'+result.answer,disable_web_page_preview:true,...(entities.length?{entities}:{}),...(rows.length?{reply_markup:{inline_keyboard:rows}}:{})}).catch(()=>{});}
    }
   }catch{answer='Could not record this. Please try again.';}
   await call(config,'answerCallbackQuery',{callback_query_id:String(query.id),text:answer.slice(0,190)}).catch(()=>{});
   return res.json({ok:true});
  }
  // A post in a channel: a one-time code links that channel to an automation (Automation Centre).
  if(req.body?.channel_post){
   if(config.enabled)try{await linkChannelFromPost(pool,req.body.channel_post,{call:(method,body)=>call(config,method,body)});}catch{/* a failed link is retried by posting a new code */}
   return res.json({ok:true});
  }
  // The bot added to, or removed from, a channel.
  if(req.body?.my_chat_member){
   try{await noteChannelMembership(pool,req.body.my_chat_member);}catch{}
   return res.json({ok:true});
  }
  const message=req.body?.message,match=/^\/start(?:@\w+)? mis_([A-Za-z0-9_-]{32})$/.exec(message?.text||'');
  // A typed command in a private chat: /start (without a connect code), /help, /status, /stop. Groups and channels get nothing.
  const command=!match&&message?.chat?.type==='private'&&typeof message.text==='string'&&String(message.from?.id)===String(message.chat.id)&&/^[1-9]\d{0,18}$/.test(String(message.chat.id))
   ?/^\/([A-Za-z_]{1,32})(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(message.text.trim()):null;
  if(config.enabled&&command){
   try{
    const chatId=String(message.chat.id),name=command[1].toLowerCase(),argument=String(command[2]||'').trim().toLowerCase();
    const {rows}=await pool.query('SELECT login_name,linked_at FROM mis_telegram_links WHERE chat_id=$1 ORDER BY login_name',[chatId]);
    const logins=rows.map(row=>String(row.login_name).toUpperCase()),named=logins.join(', ');
    let text;
    if(name==='start')text=rows.length?`Welcome back. This Telegram is connected to Pulse-II login ${named}.\n\nSend /help to see what I send.`:`Welcome to the Caliber Pulse-II MIS bot.\n\n${CONNECT_STEPS}`;
    else if(name==='help')text=MIS_BOT_HELP;
    else if(name==='status')text=rows.length?['This Telegram is connected to Pulse-II:',...rows.map(row=>`• ${String(row.login_name).toUpperCase()}${shownDate(row.linked_at)?' (since '+shownDate(row.linked_at)+')':''}`),'','Send /stop to turn off messages here.'].join('\n'):`This Telegram is not connected to any Pulse-II login.\n\n${CONNECT_STEPS}`;
    else if(name==='stop'){
     if(!rows.length)text='This Telegram is not connected, so Pulse-II sends nothing here.';
     // Approvals reach the owner here too, so one tap on the menu never cuts them off: /stop asks, /stop yes does it.
     else if(argument!=='yes')text=`This stops every Pulse-II message to this Telegram for login ${named}, approval requests too.\n\nTo confirm, send: /stop yes`;
     else{
      const removed=(await pool.query('DELETE FROM mis_telegram_links WHERE chat_id=$1 RETURNING login_name',[chatId])).rows.map(row=>String(row.login_name).toUpperCase());
      req.audit={eventType:'Integration',module:'Telegram',action:'Telegram turned off with /stop',targetType:'Telegram',targetReference:removed.join(', ').slice(0,200),details:{logins:removed}};
      text=`Done. Pulse-II messages to this Telegram are off for login ${removed.join(', ')}.\n\nTo turn them on again, press "Connect my Telegram" in Telegram Integration (${TELEGRAM_PAGE}).`;
     }
    }
    else text='I do not know that command. Send /help to see what I can do.';
    await call(config,'sendMessage',{chat_id:chatId,text,disable_web_page_preview:true}).catch(()=>{});
   }catch{/* Telegram does not resend a command; the person sends it again */}
   return res.json({ok:true});
  }
  // Any other text in a private chat linked to an MIS login: the reason after a Send back button (attendance approval).
  if(config.enabled&&onText&&!match&&message?.chat?.type==='private'&&typeof message.text==='string'&&!message.text.startsWith('/')&&String(message.from?.id)===String(message.chat.id)){
   try{
    const chatId=String(message.chat.id);
    const {rows}=await pool.query('SELECT login_name FROM mis_telegram_links WHERE chat_id=$1',[chatId]);
    if(rows.length){
     const result=await onText({chatId,text:message.text.slice(0,1000),logins:rows.map(row=>row.login_name)});
     if(result?.reply)await call(config,'sendMessage',{chat_id:chatId,text:String(result.reply).slice(0,4000),disable_web_page_preview:true}).catch(()=>{});
    }
   }catch{/* Telegram does not resend a text; the person taps Send back again */}
   return res.json({ok:true});
  }
  if(!config.enabled||!match||message?.chat?.type!=='private'||String(message.from?.id)!==String(message.chat.id)||!/^[1-9]\d{0,18}$/.test(String(message.chat.id)))return res.json({ok:true});
  const client=await pool.connect();let linked=false;
  try{
   await client.query('BEGIN');
   const {rows}=await client.query('UPDATE mis_telegram_pending SET used_at=NOW() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() RETURNING login_name',[digest(match[1])]);
   if(rows[0]){await client.query('INSERT INTO mis_telegram_links(login_name,chat_id) VALUES($1,$2) ON CONFLICT(login_name) DO UPDATE SET chat_id=EXCLUDED.chat_id,linked_at=NOW()',[rows[0].login_name,String(message.chat.id)]);linked=true;}
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  // Linking is committed before the optional welcome message; a Telegram outage cannot undo it.
  await call(config,'sendMessage',{chat_id:String(message.chat.id),text:linked?'Your Caliber Pulse-II MIS account is connected. Ticket resolution updates will appear here.\n\nSend /help to see what I send.':`This connect link has expired or was already used.\n\n${CONNECT_STEPS}`}).catch(()=>{});
  res.json({ok:true});
 }));
 // A row with a photo (the site picture of a batch completion report) goes as one photo with the
 // message as its caption; if the picture cannot be drawn or sent, the message still goes as text.
 const sendPhoto=async(config,fields,png)=>{
  const form=new FormData();for(const [k,v] of Object.entries(fields))if(v)form.append(k,String(v));
  form.append('photo',new Blob([png],{type:'image/png'}),'site.png');
  // The live fetch (telegramFetch, IPv4 only) sends a body as bytes; a FormData object would arrive as the
  // text "[object FormData]" and Telegram refused every photo (16 Nov 2026). Encode the multipart body first.
  const encoded=new Response(form);
  const body=Buffer.from(await encoded.arrayBuffer());
  const response=await fetchImpl(`https://api.telegram.org/bot${config.botToken}/sendPhoto`,{method:'POST',headers:{'Content-Type':encoded.headers.get('content-type')},body,signal:AbortSignal.timeout(30000)});
  const data=await response.json().catch(()=>null);if(!response.ok||data?.ok!==true)throw Error('Telegram refused the photo');
 };
 async function deliverRow(config,row){
  const parse_mode=row.parse_mode||undefined;
  if(row.photo){
   const photo=(()=>{try{return typeof row.photo==='string'?JSON.parse(row.photo):row.photo;}catch{return null;}})();
   // The whole report as one picture with a short caption (owner, 16 Nov 2026); the full text only if it fails.
   if(photo?.card){
    try{await sendPhoto(config,{chat_id:row.chat_id,caption:String(photo.caption||'').slice(0,1024),parse_mode},await batchReportCard(photo.card));return;}
    catch{/* falls back to text below */}
   }else if(photo){
    // Rows queued before the report card: the site picture with the report as its caption.
    // A caption holds 1024 characters: a longer report goes as the picture, then the text.
    const fits=String(row.message).length<=1024;
    // photo.speed: the green / red headline picture of the speed report (A25).
    try{await sendPhoto(config,fits?{chat_id:row.chat_id,caption:row.message,parse_mode}:{chat_id:row.chat_id},await (photo.speed?speedReportBanner(photo.speed):siteReportBanner(photo)));if(fits)return;}
    catch{/* falls back to text below */}
   }
  }
  await call(config,'sendMessage',{chat_id:row.chat_id,text:row.message,disable_web_page_preview:true,...(parse_mode?{parse_mode}:{})});
 }
 let draining=false,timer;
 async function drain(){
  if(draining)return;draining=true;
  try{
   const config=await read();if(!config.enabled||!config.webhookReady)return;
   for(let i=0;i<5;i++){
    const {rows}=await pool.query("UPDATE mis_telegram_outbox SET status='sending',attempts=attempts+1,lease_until=NOW()+INTERVAL '60 seconds' WHERE id=(SELECT id FROM mis_telegram_outbox WHERE (status='pending' AND next_attempt_at<=NOW()) OR (status='sending' AND lease_until<NOW()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *");
    const row=rows[0];if(!row)break;
    try{await deliverRow(config,row);await pool.query("UPDATE mis_telegram_outbox SET status='sent',last_error='' WHERE id=$1",[row.id]);}
    catch{await pool.query("UPDATE mis_telegram_outbox SET status=$2,next_attempt_at=NOW()+($3::text||' seconds')::interval,last_error='Telegram delivery failed; check bot and chat permissions.' WHERE id=$1",[row.id,row.attempts>=5?'failed':'pending',Math.min(900,10*2**row.attempts)]);}
   }
  }catch{/* Notification failures do not change saved tickets. */}finally{draining=false}
 }
 // Webhooks saved before 15 Nov 2026 only asked Telegram for messages; buttons need callback_query too.
 async function ensureWebhook(){
  try{const config=await read();if(config.enabled&&config.webhookReady&&config.botToken){
   await call(config,'setWebhook',{url:webhook,secret_token:config.webhookSecret,allowed_updates:MIS_TELEGRAM_UPDATES,drop_pending_updates:false}).catch(()=>{});
   await call(config,'setMyCommands',{commands:MIS_BOT_COMMANDS}).catch(()=>{});
  }}catch{}
 }
 // Channel members, remembered 10 minutes so a report to six people asks Telegram once per person. A failed
 // question is not remembered: the person gets the personal copy and the next message asks again.
 const members=new Map();
 const MEMBER_MS=10*60000;
 async function inChannel(channelId,personChatId){
  const key=String(channelId)+'|'+String(personChatId),held=members.get(key);
  if(held&&Date.now()-held.at<MEMBER_MS)return held.member;
  const config=await read();if(!config.enabled||!config.webhookReady||!config.botToken)return false;
  let member=false;
  try{const result=await call(config,'getChatMember',{chat_id:String(channelId),user_id:Number(personChatId)});
   const status=String(result?.status||'');member=['creator','administrator','member'].includes(status)||status==='restricted'&&result?.is_member===true;}
  catch{return false;}
  members.set(key,{member,at:Date.now()});
  return member;
 }
 return {
  inChannel,
  async initialize(){await pool.query(MIS_TELEGRAM_SCHEMA);await pool.query(AUTOMATION_CHANNELS_SCHEMA);},
  // The bot's name and state, for the Automation Centre channel steps. No token.
  async botInfo(){const config=await read();return {ready:Boolean(config.enabled&&config.webhookReady&&config.botToken),botUsername:config.botUsername||''};},
  // A test post to a linked channel, sent at once so the page can show Telegram's answer.
  async postNow(chatId,text){const config=await read();if(!config.enabled||!config.webhookReady)invalid('Enable the Pulse-II Telegram bot first (Telegram Integration page).');
   await call(config,'sendMessage',{chat_id:String(chatId),text:String(text).slice(0,4000),disable_web_page_preview:true});return true;},
  start(){if(!timer){timer=setInterval(()=>void drain(),10000);timer.unref?.();void ensureWebhook();}},
  // Sends at once (not through the outbox) a message with buttons to one private chat.
  async sendButtons(chatId,text,buttons,{parse_mode}={}){const config=await read();if(!config.enabled||!config.webhookReady)return false;await call(config,'sendMessage',{chat_id:String(chatId),text:String(text).slice(0,4000),disable_web_page_preview:true,...(parse_mode?{parse_mode}:{}),reply_markup:{inline_keyboard:buttons}});return true;},
  // Sends at once a plain message (HTML, or asking for a reply) to one private chat.
  async sendText(chatId,text,{parse_mode,reply_markup}={}){const config=await read();if(!config.enabled||!config.webhookReady)return false;await call(config,'sendMessage',{chat_id:String(chatId),text:String(text).slice(0,4000),disable_web_page_preview:true,...(parse_mode?{parse_mode}:{}),...(reply_markup?{reply_markup}:{})});return true;},
  stop(){clearInterval(timer);timer=null;},drain,
  async notify(event,ticket){
   const config=await read();if(!config.enabled||!config.webhookReady)return;
   if(!await automationOn('mis-ticket'))return;
   const targets=new Set();if(config.adminChatId)targets.add(config.adminChatId);
   if(event==='resolved'){const {rows}=await pool.query('SELECT chat_id FROM mis_telegram_links WHERE login_name=$1',[String(ticket.creatorLogin||'').toLowerCase()]);if(rows[0])targets.add(rows[0].chat_id);}
   const text=`Caliber Pulse-II MIS\nTicket ${ticket.reference} ${event==='resolved'?'resolved':'created'}\nSite: ${ticket.site}\nPriority: ${ticket.priority}\n${event==='resolved'?String(ticket.resolutionMessage||'Resolution available in MIS.'):String(ticket.message||'Audio description available in MIS.')}\nhttps://pulse-ll.cmll.in/?page=tickets`.slice(0,4000);
   for(const chatId of targets)await pool.query('INSERT INTO mis_telegram_outbox(event_key,chat_id,message) VALUES($1,$2,$3) ON CONFLICT(event_key) DO NOTHING',[`${event}:${ticket.reference}:${chatId}`,chatId,text]);
   // A11's Telegram channel, when linked: once per ticket event.
   await queueChannelCopy(pool,{eventKey:`${event}:${ticket.reference}`,message:text}).catch(()=>{});
   void drain();
  }
 };
}
