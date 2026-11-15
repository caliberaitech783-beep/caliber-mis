// "Send vehicle transfers to Pulse" switch (Pulse Master Sync page).
//
// ON (the default): a transfer accepted in Pulse-II is completed in Pulse first, through the MIS
// bridge, and the vehicle moves in Pulse-II only after Pulse answers; the Oracle transfer import
// keeps transfers as history and no longer changes a vehicle's site.
// OFF: the behaviour before 16 Nov 2026 returns: acceptance moves the vehicle in Pulse-II only,
// the transfer is listed under "Pending in Pulse", and the next hourly copy from Pulse puts the
// vehicle back until someone enters the transfer in Pulse.
// Kept in app_settings and read again after 15 seconds, so every server follows a change.
export const PULSE_TRANSFER_SETTING_KEY='pulse_transfer_write';
const CACHE_MS=15_000;

export function createPulseTransferSwitch({pool,now=Date.now,cacheMs=CACHE_MS}){
 let cached=null;
 const read=async()=>{
  if(cached&&now()-cached.at<cacheMs)return cached.value;
  let value={on:true,by:'',at:''};
  try{
   const {rows}=await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[PULSE_TRANSFER_SETTING_KEY]);
   const saved=rows[0]?.setting_value;
   if(saved&&typeof saved==='object')value={on:saved.on!==false,by:String(saved.by||''),at:String(saved.at||'')};
  }catch{/* No settings table yet (tests, first start): the default applies. */}
  cached={at:now(),value};
  return value;
 };
 return {
  status:read,
  async on(){return (await read()).on;},
  async set(on,by=''){
   const value={on:on===true,by:String(by||'').trim().toLowerCase(),at:new Date(now()).toISOString()};
   await pool.query(`INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2::jsonb,NOW())
    ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()`,[PULSE_TRANSFER_SETTING_KEY,JSON.stringify(value)]);
   cached={at:now(),value};
   return value;
  },
 };
}
