import {createHash,randomBytes} from 'node:crypto';
import {AUTOMATIONS} from '../rules/automation-catalogue.mjs';
import {automationForEventKey} from './automation-switches.mjs';

// A Telegram channel per automation (16 Nov 2026, owner's request).
//
// A Telegram bot cannot create a channel, so a person creates it once in Telegram, adds the Pulse-II bot
// as an administrator and posts a one-time code (pulse-link-xxxxxxxxxx) in it. The MIS bot webhook sees the
// post, checks the code and links the channel to that automation. From then on every message of the
// automation is also posted once in the channel, besides the personal chats it already goes to, and anyone
// with the channel's join link can follow it and set their own notification style in Telegram.
//
// Only automations marked channel:true in the catalogue can have one. Approval codes (OTPs) are personal
// and never go to a channel, whatever is stored.

export const AUTOMATION_CHANNELS_SETTING_KEY='automation_channels';
export const AUTOMATION_CHANNELS_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_telegram_channel_pending(token_hash TEXT PRIMARY KEY,automation_key TEXT NOT NULL,login_name TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ);`;
export const CHANNEL_AUTOMATION_KEYS=new Set(AUTOMATIONS.filter(item=>item.channel===true).map(item=>item.key));
export const CHANNEL_CODE_PATTERN=/\bpulse-link-([a-z0-9]{10})\b/i;
const CODE_MINUTES=30;
const CACHE_MS=15_000;
const digest=value=>createHash('sha256').update(String(value).toLowerCase()).digest('hex');
const text=(value,max=200)=>String(value??'').trim().slice(0,max);

export function normalizeAutomationChannels(value){
 const result={};
 for(const [key,entry] of Object.entries(value&&typeof value==='object'?value:{})){
  if(!CHANNEL_AUTOMATION_KEYS.has(key)||!entry||typeof entry!=='object'||!/^-100\d{5,16}$/.test(String(entry.chatId||'')))continue;
  result[key]={chatId:String(entry.chatId),title:text(entry.title),username:text(entry.username,64),inviteLink:/^https:\/\/t\.me\//.test(String(entry.inviteLink||''))?text(entry.inviteLink):'',
   linkedBy:text(entry.linkedBy,120),linkedAt:text(entry.linkedAt,40),lostAt:text(entry.lostAt,40)};
 }
 return result;
}

export async function readAutomationChannels(db){
 try{const {rows}=await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[AUTOMATION_CHANNELS_SETTING_KEY]);return normalizeAutomationChannels(rows[0]?.setting_value);}
 catch(error){if(error.code==='42P01')return {};throw error;}
}
// One cache per database pool, so tests with their own database never share it.
const caches=new WeakMap();
async function writeAutomationChannels(db,channels){
 const value=normalizeAutomationChannels(channels);
 await db.query(`INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2::jsonb,NOW())
  ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()`,[AUTOMATION_CHANNELS_SETTING_KEY,JSON.stringify(value)]);
 caches.set(db,{value,at:Date.now()});
 return value;
}
export async function automationChannelFor(db,key){
 if(!key||!CHANNEL_AUTOMATION_KEYS.has(key))return null;
 let cached=caches.get(db);
 if(!cached||Date.now()-cached.at>CACHE_MS){
  try{cached={value:await readAutomationChannels(db),at:Date.now()};}
  // A failed read keeps the last known channels; with none known nothing goes to a channel.
  catch{cached={value:cached?.value||{},at:Date.now()};}
  caches.set(db,cached);
 }
 const channel=cached.value[key];
 return channel&&!channel.lostAt?channel:null;
}

// The channel copy of a message is queued once per event, not once per person: a personal event key ends
// with the person's login, which is dropped (vlb-alert keys already have no login).
export function channelEventKey(eventKey,login=''){
 const parts=String(eventKey||'').split(':');
 if(parts.length>2&&login&&parts.at(-1)===String(login))parts.pop();
 return 'channel:'+parts.join(':');
}
export async function queueChannelCopy(db,{eventKey,login='',message,parseMode='',photo=null}){
 const channel=await automationChannelFor(db,automationForEventKey(eventKey));
 if(!channel)return false;
 await db.query('INSERT INTO mis_telegram_outbox(event_key,chat_id,message,parse_mode,photo) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO NOTHING',
  [channelEventKey(eventKey,login),channel.chatId,String(message).slice(0,4000),parseMode||'',photo?JSON.stringify(photo):null]);
 return true;
}

export async function createChannelCode(db,{key,login}){
 if(!CHANNEL_AUTOMATION_KEYS.has(key))throw Object.assign(Error('This automation cannot post to a channel.'),{status:400});
 await db.query(AUTOMATION_CHANNELS_SCHEMA);
 // Ten letters and digits; lower case so a phone keyboard cannot change it.
 const alphabet='abcdefghjkmnpqrstuvwxyz23456789',bytes=randomBytes(10);
 const code='pulse-link-'+[...bytes].map(byte=>alphabet[byte%alphabet.length]).join('');
 await db.query("DELETE FROM mis_telegram_channel_pending WHERE expires_at<NOW()-INTERVAL '1 day'");
 await db.query(`INSERT INTO mis_telegram_channel_pending(token_hash,automation_key,login_name,expires_at) VALUES($1,$2,$3,NOW()+($4::text||' minutes')::interval)`,
  [digest(code.slice('pulse-link-'.length)),key,text(login,120).toLowerCase(),String(CODE_MINUTES)]);
 return {code,expiresInMinutes:CODE_MINUTES};
}

const automationName=key=>{const item=AUTOMATIONS.find(entry=>entry.key===key);return item?item.code+' '+item.name:key;};

// A channel post with a code. call(method, body) is the MIS bot's Telegram API call.
// Returns {linked:key} when a channel was linked, otherwise null. Never throws for a bad code.
export async function linkChannelFromPost(db,post,{call}){
 const chat=post?.chat,match=CHANNEL_CODE_PATTERN.exec(String(post?.text||post?.caption||''));
 if(chat?.type!=='channel'||!match||!/^-100\d{5,16}$/.test(String(chat.id)))return null;
 await db.query(AUTOMATION_CHANNELS_SCHEMA);
 const {rows}=await db.query('UPDATE mis_telegram_channel_pending SET used_at=NOW() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() RETURNING automation_key,login_name',[digest(match[1])]);
 const pending=rows[0];
 if(!pending||!CHANNEL_AUTOMATION_KEYS.has(pending.automation_key))return null;
 const chatId=String(chat.id),key=pending.automation_key;
 // The bot can post here (it saw the post as an administrator); the join link needs "Invite users via link".
 let inviteLink=chat.username?'https://t.me/'+chat.username:'';
 if(!inviteLink){try{inviteLink=text((await call('createChatInviteLink',{chat_id:chatId,name:text(automationName(key),32)}))?.invite_link);}catch{/* shown on the page as "no join link" */}}
 const channels=await readAutomationChannels(db);
 channels[key]={chatId,title:text(chat.title)||automationName(key),username:text(chat.username,64),inviteLink,linkedBy:pending.login_name,linkedAt:new Date().toISOString(),lostAt:''};
 await writeAutomationChannels(db,channels);
 // The code is not needed in the channel any more; deleting needs "Delete messages", so it may stay.
 await call('deleteMessage',{chat_id:chatId,message_id:post.message_id}).catch(()=>{});
 await call('sendMessage',{chat_id:chatId,text:`This channel now receives ${automationName(key)} from Caliber Pulse-II.`,disable_web_page_preview:true}).catch(()=>{});
 return {linked:key};
}

// The bot was removed from a channel or lost its administrator rights: its automations stop posting there,
// and the page asks to link a channel again. Added back as administrator: posting starts again.
export async function noteChannelMembership(db,update){
 const chat=update?.chat,status=String(update?.new_chat_member?.status||'');
 if(chat?.type!=='channel')return false;
 const channels=await readAutomationChannels(db);let changed=false;
 for(const entry of Object.values(channels)){
  if(entry.chatId!==String(chat.id))continue;
  const canPost=status==='creator'||status==='administrator'&&update.new_chat_member?.can_post_messages!==false;
  const lostAt=canPost?'':entry.lostAt||new Date().toISOString();
  if(lostAt!==entry.lostAt){entry.lostAt=lostAt;changed=true;}
  if(chat.title&&chat.title!==entry.title){entry.title=text(chat.title);changed=true;}
 }
 if(changed)await writeAutomationChannels(db,channels);
 return changed;
}

export async function unlinkAutomationChannel(db,key){
 const channels=await readAutomationChannels(db);
 const removed=channels[key]||null;delete channels[key];
 await writeAutomationChannels(db,channels);
 return removed;
}

// Channel posts sent per automation, from the MIS Telegram outbox.
export async function channelPostCounts(db){
 let rows=[];
 try{rows=(await db.query(`SELECT split_part(event_key,':',2) AS prefix,
   CASE WHEN event_key LIKE '%|not_created:%' THEN 'not_created' WHEN event_key LIKE '%|not_closed:%' THEN 'not_closed' ELSE '' END AS kind,
   count(*) FILTER (WHERE status='sent')::int AS sent,max(created_at) FILTER (WHERE status='sent') AS last
  FROM mis_telegram_outbox WHERE event_key LIKE 'channel:%' GROUP BY 1,2`)).rows;}
 catch(error){if(error.code!=='42P01')throw error;}
 const result={};
 for(const row of rows){
  const key=automationForEventKey(row.prefix+':'+(row.kind?'x|'+row.kind+':':''));
  if(!key)continue;
  const entry=result[key]||={sent:0,lastSentAt:null};
  entry.sent+=row.sent;
  if(row.last&&(!entry.lastSentAt||new Date(row.last)>new Date(entry.lastSentAt)))entry.lastSentAt=row.last;
 }
 return result;
}
