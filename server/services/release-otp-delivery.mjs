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
// Telegram HTML, professional layout (owner, 16 Nov 2026): headline in a quote box, then Approval details /
// What it fixes / Requested by, and the decision last. Every value from outside is escaped.
const html=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function releaseApprovalMessage({actor,runId,commit,subject,requester={},pr=null,brief=[]}){
 const points=(Array.isArray(brief)?brief:[]).filter(Boolean).slice(0,2);
 const run=`run ${html(runId||'unknown')}`;
 const facts=[
  ...(commit?[`Version <code>${html(String(commit).slice(0,7))}</code>${subject?' - '+html(String(subject).slice(0,200)):''}`]:[]),
  ...(pr?.changes?[html(pr.changes)]:[]),
 ];
 return [
  `<blockquote>🚀 <b>${pr?'PULSE-II · MERGE + RELEASE TO PRODUCTION':'PULSE-II · URGENT PRODUCTION RELEASE'}</b>\nApproval required · valid for ${RELEASE_APPROVAL_TTL_MINUTES} minutes</blockquote>`,
  '',
  '📋 <b>Approval details</b>',
  ...(pr?[`PR #${pr.prNumber}${pr.prTitle?' — '+html(pr.prTitle):''}`]:[]),
  ...(facts.length?[facts.join(' · ')]:[]),
  ...(points.length?['','🛠 <b>What it fixes</b>',...points.map((point,i)=>`${i+1}. ${html(point)}`)]:[]),
  '',
  '👤 <b>Requested by</b>',
  html(requester.requestedBy||'(name not given)'),
  `<b>Computer:</b> <code>${html(requester.computer||'(not given)')}</code> · <b>IP:</b> <code>${html(requester.ip||'(not given)')}</code>`,
  `<b>GitHub:</b> ${html(actor||'unknown')} ✓ · ${/^https:\/\//.test(requester.runUrl||'')?`<a href="${html(requester.runUrl)}">${run}</a>`:run}`,
  '<i>Name, computer and IP as given by the requester; GitHub account checked by GitHub.</i>',
  '━━━━━━━━━━━━━━━━',
  '⚠️ <b>Approve only if main should go live now.</b>',
  ...(pr?[`Approve = merge PR #${pr.prNumber} into main and make it live.`]:[]),
  '<b>Mr Anoop</b> or <b>Mr Mohit Chadda</b> — the first tap decides.',
 ].join('\n').replace(/\n{3,}/g,'\n\n');
}

// Sends the Approve / Reject message to every approver who has linked Telegram. Returns how many got it.
export function createReleaseApprovalDelivery({pool,sendButtons,alsoLogins=RELEASE_OTP_ALSO_LOGINS}){
 return async({id,actor,runId,commit,subject,requester={},pr=null,brief=[],sample=false})=>{
  const logins=await releaseApproverLogins(pool,alsoLogins);
  const {rows}=logins.length?await pool.query('SELECT DISTINCT chat_id FROM mis_telegram_links WHERE login_name=ANY($1::text[])',[logins]):{rows:[]};
  // A sample's buttons carry no release id, so a tap only answers "This button is no longer active."
  const ref=sample?'sample':id;
  const buttons=[[{text:pr?`✅ Approve merge + release`:'✅ Approve release',callback_data:`rel:${ref}:a`},{text:'❌ Reject',callback_data:`rel:${ref}:r`}]];
  const text=(sample?'🧪 <b>SAMPLE - format test only.</b> Nothing is merged or released; the buttons do nothing.\n\n':'')+releaseApprovalMessage({actor,runId,commit,subject,requester,pr,brief});
  let sent=0;
  for(const row of rows){try{if(await sendButtons(row.chat_id,text,buttons,{parse_mode:'HTML'}))sent++;}catch{}}
  return {sent};
 };
}

// Owner, 16 Nov 2026: an MIS administrator can send this sample to the approvers to see the real format.
export const RELEASE_APPROVAL_SAMPLE=Object.freeze({actor:'caliberaitech783-beep',runId:'43742987504',commit:'c9757ce',
 requester:{requestedBy:'Claude Code session for owner',computer:'ANOOP_PAUL',ip:'223.238.183.191',runUrl:'https://github.com/caliberaitech783-beep/caliber-mis/actions/runs/43742987504'},
 pr:{prNumber:348,prTitle:'Driver continuing into the next shift = OT, not a duplicate card',changes:'3 files, +104 / -11; checks passed (2)'},
 brief:['Driver continuing from one shift into another on the same trip card is counted as OT, not refused as duplicate','Same-shift duplicate checks unchanged']});
export function createReleaseApprovalSample(options){
 const deliver=createReleaseApprovalDelivery(options);
 return ()=>deliver({...RELEASE_APPROVAL_SAMPLE,sample:true});
}
