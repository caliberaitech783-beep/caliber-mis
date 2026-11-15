import {DELETION_PHONE} from '../rules/deletion-otp-routing.mjs';
import {OTP_TTL_MINUTES,RELEASE_APPROVAL_TTL_MINUTES} from '../../shared/otp-approval.mjs';

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

// Everyone who may approve an urgent release: the owner's logins and RELEASE_OTP_ALSO_LOGINS.
export async function releaseApproverLogins(pool,alsoLogins=RELEASE_OTP_ALSO_LOGINS){
 return [...new Set([...await ownerTelegramLogins(pool),...alsoLogins.map(l=>String(l).trim().toLowerCase()).filter(Boolean)])];
}

// Whom you are approving (owner's request, 15 Nov 2026): name, computer and IP as given by the person or
// session that started the run, and the GitHub account, which GitHub vouches for. pr: merge + release.
// brief: at most two short points on what the release fixes, shown first so the approver knows what goes live.
export function releaseApprovalMessage({actor,runId,commit,subject,requester={},pr=null,brief=[]}){
 const points=(Array.isArray(brief)?brief:[]).filter(Boolean).slice(0,2);
 return [
  pr?'Pulse-II: MERGE + RELEASE to production':'Pulse-II urgent production release',
  ...(pr?[`PR #${pr.prNumber}: ${pr.prTitle||''}`.trim()]:[]),
  ...(points.length?['','What it fixes:',...points.map((point,i)=>`${i+1}. ${point}`),'']:[]),
  ...(pr?.changes?[`Changes: ${pr.changes}`]:[]),
  ...(commit?[`Version: ${String(commit).slice(0,7)}${subject?' - '+String(subject).slice(0,200):''}`]:[]),
  '',
  `Requested by: ${requester.requestedBy||'(name not given)'}`,
  `Computer: ${requester.computer||'(not given)'}`,
  `IP address: ${requester.ip||'(not given)'}`,
  '(name, computer and IP as given by the requester)',
  `GitHub account: ${actor||'unknown'} (checked by GitHub), run ${runId||'unknown'}`,
  ...(requester.runUrl?[requester.runUrl]:[]),
  '',
  pr?`Approve = merge PR #${pr.prNumber} into main and make it live now.`:'Approve only if main should go live now.',
  `Mr Anoop or Mr Mohit Chadda: the first tap decides. Valid for ${RELEASE_APPROVAL_TTL_MINUTES} minutes.`,
 ].join('\n').replace(/\n{3,}/g,'\n\n');
}

// Sends the Approve / Reject message to every approver who has linked Telegram. Returns how many got it.
export function createReleaseApprovalDelivery({pool,sendButtons,alsoLogins=RELEASE_OTP_ALSO_LOGINS}){
 return async({id,actor,runId,commit,subject,requester={},pr=null,brief=[]})=>{
  const logins=await releaseApproverLogins(pool,alsoLogins);
  const {rows}=logins.length?await pool.query('SELECT DISTINCT chat_id FROM mis_telegram_links WHERE login_name=ANY($1::text[])',[logins]):{rows:[]};
  const buttons=[[{text:pr?`✅ Approve merge + release`:'✅ Approve release',callback_data:`rel:${id}:a`},{text:'❌ Reject',callback_data:`rel:${id}:r`}]];
  let sent=0;
  for(const row of rows){try{if(await sendButtons(row.chat_id,releaseApprovalMessage({actor,runId,commit,subject,requester,pr,brief}),buttons))sent++;}catch{}}
  return {sent};
 };
}
