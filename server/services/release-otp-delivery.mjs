import {DELETION_PHONE} from '../rules/deletion-otp-routing.mjs';
import {OTP_TTL_MINUTES} from '../../shared/otp-approval.mjs';

// Urgent production release OTP goes on Telegram to every MIS login whose
// registered mobile is the owner's number (DELETION_PHONE), and to Mr Mohit
// Chadda's login, whichever have linked Telegram. Only when none is linked does it fall back to the
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

// MIS logins whose registered mobile is the owner's number. Also used by the
// site-wise batch completion report (scan-batch-report.mjs).
export async function ownerTelegramLogins(pool){
 const {rows}=await pool.query("SELECT record_data FROM master_records WHERE master_name='Users & employees'");
 return [...new Set(rows.map(r=>r.record_data||{})
  .filter(u=>[u.mobile,u.phone,u.whatsapp,u.contact].some(v=>digits(v)===OWNER))
  .map(u=>String(u.login||'').trim().toLowerCase()).filter(Boolean))];
}

// The owner asked on 15 Nov 2026 that Mr Mohit Chadda gets every release OTP too. A login, not a number, so no
// phone number sits in this public code.
export const RELEASE_OTP_ALSO_LOGINS=Object.freeze(['mohitchadda']);

export function createReleaseOtpDelivery({pool,telegram,whatsapp,alsoLogins=RELEASE_OTP_ALSO_LOGINS}){
 const logins=async()=>[...new Set([...await ownerTelegramLogins(pool),...alsoLogins.map(l=>String(l).trim().toLowerCase()).filter(Boolean)])];
 return async({otp,actor,runId})=>{
  const message=releaseOtpMessage({otp,actor,runId});
  // Every linked person gets the same OTP; either of them can approve.
  let sent=0;
  for(const login of await logins()){
   try{if(await telegram.send(login,message,`release-otp:${runId}:${login}`))sent++;}catch{}
  }
  if(sent)return {channel:'telegram'};
  if(whatsapp){await whatsapp({pool,otp});return {channel:'whatsapp'};}
  throw Object.assign(new Error('The owner has no linked Telegram, so the OTP could not be sent.'),{status:503});
 };
}
