import {DELETION_PHONE} from '../rules/deletion-otp-routing.mjs';
import {OTP_TTL_MINUTES} from '../../shared/otp-approval.mjs';

// Urgent production release OTP goes to the owner only: on Telegram, to every
// MIS login whose registered mobile is the owner's number (DELETION_PHONE) and
// that has linked Telegram. Only when none is linked does it fall back to the
// owner-only WhatsApp connection. A caller can never choose the recipient.
const digits=value=>String(value??'').replace(/\D/g,'').slice(-10);
const OWNER=digits(DELETION_PHONE);

export function releaseOtpMessage({otp,actor,runId}){
 return [
  'Pulse-II urgent production release',
  `OTP: ${otp}`,
  `Requested by: ${actor||'unknown'} (GitHub run ${runId||'unknown'})`,
  `Valid for ${OTP_TTL_MINUTES} minutes. Share it only if you approve deploying main to production now.`,
 ].join('\n');
}

export function createReleaseOtpDelivery({pool,telegram,whatsapp}){
 const ownerLogins=async()=>{
  const {rows}=await pool.query("SELECT record_data FROM master_records WHERE master_name='Users & employees'");
  return [...new Set(rows.map(r=>r.record_data||{})
   .filter(u=>[u.mobile,u.phone,u.whatsapp,u.contact].some(v=>digits(v)===OWNER))
   .map(u=>String(u.login||'').trim().toLowerCase()).filter(Boolean))];
 };
 return async({otp,actor,runId})=>{
  const message=releaseOtpMessage({otp,actor,runId});
  for(const login of await ownerLogins()){
   try{if(await telegram.send(login,message,`release-otp:${runId}:${login}`))return {channel:'telegram'};}catch{}
  }
  if(whatsapp){await whatsapp({pool,otp});return {channel:'whatsapp'};}
  throw Object.assign(new Error('The owner has no linked Telegram, so the OTP could not be sent.'),{status:503});
 };
}
