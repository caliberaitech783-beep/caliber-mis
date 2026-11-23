// The lock on every Pulse-II door that adds, edits or deletes an employee (shared/employee-master-door.mjs).
// It opens only when the owner taps Allow on Telegram: an administrator asks from the Employee Master page,
// the owner gets one message with Allow / Refuse, and Allow opens the doors for DOOR_OPEN_MINUTES.
//   GET  /api/employee-master/door         open or closed, for the page;
//   POST /api/employee-master/door/ask     {reason} sends Allow / Refuse to the owner;
//   POST /api/employee-master/door/close   closes an open door before its time.
// The state is one line in app_settings, read under a row lock when it changes.
import {randomUUID} from 'node:crypto';
import {EMPLOYEE_MASTER_DOOR_KEY,DOOR_OPEN_MINUTES,DOOR_ASK_TTL_MINUTES,DOOR_ASK_RESEND_SECONDS,EMPLOYEE_MASTER_LOCKED,doorOpen,askWaiting,askTooSoon,doorStatus,istClock} from '../../shared/employee-master-door.mjs';

// "From my Telegram" (owner, 23 Nov 2026): Mr Mohit Chadda's login. A login, not a number, so no phone number
// sits in this public code.
export const EMPLOYEE_DOOR_OWNER_LOGINS=Object.freeze(['mohitchadda']);
const SETTINGS_SCHEMA="CREATE TABLE IF NOT EXISTS app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";
const READ_SQL='SELECT setting_value FROM app_settings WHERE setting_key=$1';
const SAVE_SQL=`INSERT INTO app_settings (setting_key,setting_value,updated_at) VALUES ($1,$2::jsonb,NOW())
 ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()`;
const CHATS_SQL='SELECT DISTINCT chat_id FROM mis_telegram_links WHERE login_name=ANY($1::text[])';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const clean=(value,max)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,max);
const html=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const lower=value=>String(value||'').trim().toLowerCase();

export function doorAskMessage({name,login,reason}){
 return [
  `<blockquote>🔒 <b>PULSE-II · EMPLOYEE MASTER</b>\nPermission required · valid for ${DOOR_ASK_TTL_MINUTES} minutes</blockquote>`,
  '',
  `<b>${html(name||login||'An administrator')}</b>${login&&name&&lower(login)!==lower(name)?` (${html(login)})`:''} asks to add, edit or delete employees in Pulse-II.`,
  `<b>Reason:</b> ${html(reason)}`,
  '',
  `Allow opens Employee Master in Pulse-II for ${DOOR_OPEN_MINUTES} minutes. It then closes by itself.`,
  '<i>Employees are created, edited and deleted in HR Pulse.</i>',
 ].join('\n');
}

export function createEmployeeMasterDoor({pool,sendButtons=null,ownerLogins=EMPLOYEE_DOOR_OWNER_LOGINS,now=()=>Date.now()}){
 const owners=ownerLogins.map(lower).filter(Boolean);
 let schema=null;
 const ensure=()=>schema??=pool.query(SETTINGS_SCHEMA).catch(error=>{schema=null;throw error;});
 const read=async()=>{await ensure();return (await pool.query(READ_SQL,[EMPLOYEE_MASTER_DOOR_KEY])).rows[0]?.setting_value||null;};
 const withRow=async work=>{
  await ensure();
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   // The line may not exist yet; the lock is on the key, so two requests never both see "nothing asked".
   await client.query('SELECT pg_advisory_xact_lock(709224111)');
   const row=(await client.query(READ_SQL,[EMPLOYEE_MASTER_DOOR_KEY])).rows[0]?.setting_value||null;
   const result=await work(row,value=>client.query(SAVE_SQL,[EMPLOYEE_MASTER_DOOR_KEY,JSON.stringify(value)]));
   await client.query('COMMIT');
   return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
 };
 const iso=()=>new Date(now()).toISOString();

 async function ask({login,name,reason}){
  const why=clean(reason,200);
  if(why.length<5)throw fail(400,'Write why Employee Master has to be opened in Pulse-II.');
  if(!sendButtons)throw fail(503,'Telegram buttons are not set up on this server.');
  return withRow(async(row,save)=>{
   if(doorOpen(row,now()))throw fail(409,`Employee Master is already open until ${istClock(row.openUntil)} IST.`);
   if(askTooSoon(row,now()))throw fail(429,`The owner was asked less than ${DOOR_ASK_RESEND_SECONDS} seconds ago. Wait a minute.`);
   const id=randomUUID().replace(/-/g,'').slice(0,16);
   const {rows}=await pool.query(CHATS_SQL,[owners]);
   const buttons=[[{text:`✅ Allow ${DOOR_OPEN_MINUTES} minutes`,callback_data:`emd:${id}:a`},{text:'❌ Refuse',callback_data:`emd:${id}:r`}]];
   const text=doorAskMessage({name:clean(name,80),login:clean(login,80),reason:why});
   let sent=0;
   for(const chat of rows){try{if(await sendButtons(chat.chat_id,text,buttons,{parse_mode:'HTML'}))sent++;}catch{/* the next chat is tried */}}
   if(!sent)throw fail(503,'The owner has not connected Telegram to Pulse-II, so the request could not be sent. Employee Master stays closed.');
   await save({...row,ask:{id,by:clean(login,80),name:clean(name,80),reason:why,at:iso(),expiresAt:new Date(now()+DOOR_ASK_TTL_MINUTES*60000).toISOString(),status:'awaiting'}});
   return {sent};
  });
 }

 async function close({login}){
  return withRow(async(row,save)=>{
   if(!doorOpen(row,now()))return {closed:false};
   await save({...row,openUntil:null,closedBy:clean(login,80),closedAt:iso()});
   return {closed:true};
  });
 }

 // Called by the Telegram webhook when a button is tapped. logins = the MIS logins linked to that chat.
 async function handleTelegramCallback({data,logins}){
  const match=/^emd:([0-9a-f]{16}):([ar])$/.exec(String(data||''));
  if(!match)return null;
  const by=(logins||[]).map(lower).find(login=>owners.includes(login));
  if(!by)return {answer:'Only the owner can allow this.'};
  return withRow(async(row,save)=>{
   const asked=row?.ask;
   if(!asked||asked.id!==match[1])return {answer:'This request is no longer active.',done:true};
   if(asked.status!=='awaiting')return {answer:asked.status==='refused'?`Already refused by ${asked.decidedBy||'the owner'}.`:`Already allowed by ${asked.decidedBy||'the owner'}.`,done:true};
   if(!askWaiting(row,now())){await save({...row,ask:{...asked,status:'expired'}});return {answer:'This request has expired. Employee Master stays closed.',done:true};}
   const at=iso();
   if(match[2]==='r'){
    await save({...row,ask:{...asked,status:'refused',decidedBy:by,decidedAt:at}});
    return {answer:`❌ Refused by ${by} at ${istClock(at)} IST. Employee Master stays closed in Pulse-II.`,done:true};
   }
   const openUntil=new Date(now()+DOOR_OPEN_MINUTES*60000).toISOString();
   await save({...row,openUntil,allowedBy:by,allowedAt:at,ask:{...asked,status:'allowed',decidedBy:by,decidedAt:at}});
   return {answer:`✅ Allowed by ${by} at ${istClock(at)} IST. Employee Master is open in Pulse-II until ${istClock(openUntil)} IST, then it closes by itself.`,done:true};
  });
 }

 // In front of every route that adds, edits or deletes an employee. A door that cannot be read is closed.
 async function requireOpen(req,res,next){
  try{
   if(doorOpen(await read(),now()))return next();
   res.status(423).json({error:EMPLOYEE_MASTER_LOCKED,locked:true});
  }catch(error){next(error);}
 }
 const status=async()=>doorStatus(await read(),now());
 return {requireOpen,status,ask,close,handleTelegramCallback};
}

export function registerEmployeeMasterDoor(app,{door,requireSession,requireAdministrator}){
 const protect=[requireSession,requireAdministrator];
 const wrap=handler=>async(req,res,next)=>{
  try{await handler(req,res);}
  catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}
 };
 const who=req=>({login:req.session?.login||'',name:req.session?.name||req.session?.login||''});
 app.get('/api/employee-master/door',...protect,wrap(async(req,res)=>{res.set('Cache-Control','no-store').json(await door.status());}));
 app.post('/api/employee-master/door/ask',...protect,wrap(async(req,res)=>{
  const result=await door.ask({...who(req),reason:req.body?.reason});
  req.audit={eventType:'Master data',module:'Employee master',action:'Ask the owner to open Employee Master',targetType:'Employee master',targetReference:'Pulse-II',details:{reason:clean(req.body?.reason,200),sent:result.sent}};
  res.json(await door.status());
 }));
 app.post('/api/employee-master/door/close',...protect,wrap(async(req,res)=>{
  const result=await door.close(who(req));
  if(result.closed)req.audit={eventType:'Master data',module:'Employee master',action:'Close Employee Master',targetType:'Employee master',targetReference:'Pulse-II',details:{}};
  res.json({...result,...await door.status()});
 }));
}
