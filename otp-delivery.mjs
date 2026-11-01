// Delivers a PM approval OTP: Telegram when the PM has linked a chat, otherwise WhatsApp
// to the registered mobile. Senders are injected so tests and the test platform can
// swap them without touching real chats.
const text=value=>String(value??'').trim();
export function createOtpDelivery({pool,telegram=null,whatsapp=null}={}){
 const userRecord=async login=>(await pool.query("SELECT record_data FROM master_records WHERE master_name='Users & employees' AND lower(trim(record_data->>'login'))=$1 ORDER BY id DESC LIMIT 1",[text(login).toLowerCase()])).rows[0]?.record_data||{};
 return {
  async send({logins=[],message,otp,eventKey}){
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
  async send(login,message,eventKey){
   const {rows}=await pool.query('SELECT chat_id FROM mis_telegram_links WHERE login_name=$1',[login]);
   if(!rows[0])return false;
   await pool.query('INSERT INTO mis_telegram_outbox(event_key,chat_id,message) VALUES($1,$2,$3) ON CONFLICT(event_key) DO NOTHING',[eventKey||`otp:${login}:${Date.now()}`,rows[0].chat_id,String(message).slice(0,4000)]);
   void Promise.resolve().then(()=>drain()).catch(()=>{});
   return true;
  },
 };
}
