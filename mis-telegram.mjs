import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {requireMisAdministrator} from './mis-admin-access.mjs';
const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const key='mis-telegram';
const webhook='https://pulse-ll.cmll.in/api/mis-telegram/webhook';
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&x.length>0&&timingSafeEqual(x,y)};
export const MIS_TELEGRAM_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_telegram_links(login_name TEXT PRIMARY KEY,chat_id TEXT NOT NULL,linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS mis_telegram_pending(token_hash TEXT PRIMARY KEY,login_name TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ);
 CREATE TABLE IF NOT EXISTS mis_telegram_outbox(id BIGSERIAL PRIMARY KEY,event_key TEXT UNIQUE NOT NULL,chat_id TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),lease_until TIMESTAMPTZ,last_error TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`;
export function registerMisTelegram(app,{pool,store,requireSession,fetchImpl=fetch}){
 const hideAudit=(req,res,next)=>{req.audit=false;next()};
 const read=async()=>await store.read(key)||{};
 const login=req=>String(req.session.login||'').trim().toLowerCase();
 const call=async(config,method,body={})=>{
  try{
   const response=await fetchImpl(`https://api.telegram.org/bot${config.botToken}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
   const data=await response.json();if(!response.ok||data.ok!==true)throw Error();return data.result;
  }catch{throw Error('Telegram could not complete the request. Check the bot credentials, chat permissions and connection.');}
 };
 const view=config=>({configured:Boolean(config.botToken),enabled:config.enabled===true,botUsername:config.botUsername||'',adminChatId:config.adminChatId||'',webhookReady:config.webhookReady===true});
 const wrap=handler=>async(req,res,next)=>{req.audit=false;res.set('Cache-Control','no-store');try{await handler(req,res)}catch(error){res.status(error.status||503).json({error:error.publicMessage||'Telegram is temporarily unavailable. Please retry.'})}};
 const invalid=message=>{throw Object.assign(Error(message),{status:400,publicMessage:message})};
 const admin=[requireSession,requireMisAdministrator];
 app.get('/api/mis-telegram/settings',...admin,wrap(async(req,res)=>{
  const config=await read(),{rows}=await pool.query("SELECT status,count(*)::int AS count FROM mis_telegram_outbox GROUP BY status");res.json({...view(config),delivery:rows});
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
  await call(config,'setWebhook',{url:webhook,secret_token:config.webhookSecret,allowed_updates:['message'],drop_pending_updates:false});
  config.webhookReady=true;await store.write(key,config);res.json(view(config));
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
 app.post('/api/mis-telegram/webhook',wrap(async(req,res)=>{
  const config=await read();if(!equal(req.get('X-Telegram-Bot-Api-Secret-Token'),config.webhookSecret))return res.status(403).json({error:'Invalid webhook authentication.'});
  const message=req.body?.message,match=/^\/start(?:@\w+)? mis_([A-Za-z0-9_-]{32})$/.exec(message?.text||'');
  if(!config.enabled||!match||message?.chat?.type!=='private'||String(message.from?.id)!==String(message.chat.id)||!/^[1-9]\d{0,18}$/.test(String(message.chat.id)))return res.json({ok:true});
  const client=await pool.connect();let linked=false;
  try{
   await client.query('BEGIN');
   const {rows}=await client.query('UPDATE mis_telegram_pending SET used_at=NOW() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() RETURNING login_name',[digest(match[1])]);
   if(rows[0]){await client.query('INSERT INTO mis_telegram_links(login_name,chat_id) VALUES($1,$2) ON CONFLICT(login_name) DO UPDATE SET chat_id=EXCLUDED.chat_id,linked_at=NOW()',[rows[0].login_name,String(message.chat.id)]);linked=true;}
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  // Linking is committed before the optional welcome message; a Telegram outage cannot undo it.
  if(linked)await call(config,'sendMessage',{chat_id:String(message.chat.id),text:'Your Caliber Pulse-II MIS account is connected. Ticket resolution updates will appear here.'}).catch(()=>{});
  res.json({ok:true});
 }));
 let draining=false,timer;
 async function drain(){
  if(draining)return;draining=true;
  try{
   const config=await read();if(!config.enabled||!config.webhookReady)return;
   for(let i=0;i<5;i++){
    const {rows}=await pool.query("UPDATE mis_telegram_outbox SET status='sending',attempts=attempts+1,lease_until=NOW()+INTERVAL '60 seconds' WHERE id=(SELECT id FROM mis_telegram_outbox WHERE (status='pending' AND next_attempt_at<=NOW()) OR (status='sending' AND lease_until<NOW()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *");
    const row=rows[0];if(!row)break;
    try{await call(config,'sendMessage',{chat_id:row.chat_id,text:row.message,disable_web_page_preview:true});await pool.query("UPDATE mis_telegram_outbox SET status='sent',last_error='' WHERE id=$1",[row.id]);}
    catch{await pool.query("UPDATE mis_telegram_outbox SET status=$2,next_attempt_at=NOW()+($3::text||' seconds')::interval,last_error='Telegram delivery failed; check bot and chat permissions.' WHERE id=$1",[row.id,row.attempts>=5?'failed':'pending',Math.min(900,10*2**row.attempts)]);}
   }
  }catch{/* Notification failures do not change saved tickets. */}finally{draining=false}
 }
 return {
  async initialize(){await pool.query(MIS_TELEGRAM_SCHEMA);},
  start(){if(!timer){timer=setInterval(()=>void drain(),10000);timer.unref?.();}},
  stop(){clearInterval(timer);timer=null;},drain,
  async notify(event,ticket){
   const config=await read();if(!config.enabled||!config.webhookReady)return;
   const targets=new Set();if(config.adminChatId)targets.add(config.adminChatId);
   if(event==='resolved'){const {rows}=await pool.query('SELECT chat_id FROM mis_telegram_links WHERE login_name=$1',[String(ticket.creatorLogin||'').toLowerCase()]);if(rows[0])targets.add(rows[0].chat_id);}
   const text=`Caliber Pulse-II MIS\nTicket ${ticket.reference} ${event==='resolved'?'resolved':'created'}\nSite: ${ticket.site}\nPriority: ${ticket.priority}\n${event==='resolved'?String(ticket.resolutionMessage||'Resolution available in MIS.'):String(ticket.message||'Audio description available in MIS.')}\nhttps://pulse-ll.cmll.in/?page=tickets`.slice(0,4000);
   for(const chatId of targets)await pool.query('INSERT INTO mis_telegram_outbox(event_key,chat_id,message) VALUES($1,$2,$3) ON CONFLICT(event_key) DO NOTHING',[`${event}:${ticket.reference}:${chatId}`,chatId,text]);
   void drain();
  }
 };
}
