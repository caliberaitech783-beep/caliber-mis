// Delivers a PM approval OTP: Telegram when the PM has linked a chat, otherwise WhatsApp
// to the registered mobile. Senders are injected so tests and the test platform can
// swap them without touching real chats.
import {automationOnForEventKey} from './automation-switches.mjs';
import {queueChannelCopy} from './automation-channels.mjs';
const text=value=>String(value??'').trim();
export function createOtpDelivery({pool,telegram=null,whatsapp=null}={}){
 const userRecord=async login=>(await pool.query("SELECT record_data FROM master_records WHERE master_name='Users & employees' AND lower(trim(record_data->>'login'))=$1 ORDER BY id DESC LIMIT 1",[text(login).toLowerCase()])).rows[0]?.record_data||{};
 return {
  async send({logins=[],message,otp,eventKey}){
   // Switched off on the Automation Centre: no Telegram and no WhatsApp fallback.
   if(eventKey&&!await automationOnForEventKey(eventKey))return {sentTo:[],channels:[],failures:['Switched off in the Automation Centre.']};
   const sentTo=[],channels=new Set(),failures=[];
   for(const login of [...new Set(logins.map(l=>text(l).toLowerCase()).filter(Boolean))]){
    let delivered=false;
    if(telegram){try{delivered=await telegram.send(login,message,eventKey?`${eventKey}:${login}`:undefined);if(delivered)channels.add('telegram');}catch(error){failures.push(`${login}: ${error.message}`);}}
    if(!delivered&&whatsapp){
     const user=await userRecord(login),mobile=text(user.whatsapp||user.mobile||user.phone||user.contact);
     if(mobile){try{delivered=await whatsapp.send(mobile,otp,message);if(delivered)channels.add('whatsapp');}catch(error){failures.push(`${login}: ${error.message}`);}}
    }
    if(delivered)sentTo.push(login);
   }
   return {sentTo,channels:[...channels],failures};
  },
 };
}

// Telegram sender backed by the MIS Telegram outbox created by registerMisTelegram.
export function telegramOutboxSender(pool,{drain=()=>{}}={}){
 return {
  // html: the message is Telegram HTML (for a bold line). photo {site,kind}: a site picture is sent with the message as its caption.
  async send(login,message,eventKey,{html=false,photo=null}={}){
   if(!await automationOnForEventKey(eventKey))return false;
   // The automation's Telegram channel, when one is linked, gets the message once per event, even
   // when this person has not connected Telegram. Approval codes never have a channel.
   let channel=false;
   try{channel=await queueChannelCopy(pool,{eventKey,login,message,parseMode:html?'HTML':'',photo});}catch{/* the personal message still goes */}
   const {rows}=await pool.query('SELECT chat_id FROM mis_telegram_links WHERE login_name=$1',[login]);
   if(!rows[0]){if(channel)void Promise.resolve().then(()=>drain()).catch(()=>{});return false;}
   await pool.query('INSERT INTO mis_telegram_outbox(event_key,chat_id,message,parse_mode,photo) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO NOTHING',
    [eventKey||`otp:${login}:${Date.now()}`,rows[0].chat_id,String(message).slice(0,4000),html?'HTML':'',photo?JSON.stringify(photo):null]);
   void Promise.resolve().then(()=>drain()).catch(()=>{});
   return true;
  },
 };
}
