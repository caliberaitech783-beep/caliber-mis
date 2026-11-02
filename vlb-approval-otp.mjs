import {randomUUID} from 'node:crypto';
import {displaySiteName} from './region-scope.mjs';
import {generateOtp,hashOtp,otpExpiresAt,checkOtpAttempt,resendTooSoon,otpFail,OTP_TTL_MINUTES} from './otp-approval.mjs';

// PM approvals for VLB batch controls by one-time password. The site PM reads the code to the
// MIS user by phone instead of signing in; entering it records the PM's approval exactly as
// an on-screen decision would. Same controls as the express transfer OTP: six digits, hash
// only, ten minutes, five attempts, one request per minute, single use.
export const APPROVAL_PURPOSES={
 reopen:{label:'Reopen closed batch',verb:'reopen'},
 unlock_vlb:{label:'Unlock VLB',verb:'unlock VLB for'},
};
export const VLB_APPROVAL_OTP_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_vlb_approval_otps(
  id UUID PRIMARY KEY,batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id),purpose TEXT NOT NULL CHECK(purpose IN ('reopen','unlock_vlb')),
  request_id UUID,closure_revision INTEGER,reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),sent_to TEXT[] NOT NULL,channels TEXT[] NOT NULL DEFAULT '{}',
  otp_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','used','expired','cancelled')),used_at TIMESTAMPTZ,approved_by TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS mis_vlb_approval_one_live_otp ON mis_vlb_approval_otps(batch_id,purpose,requested_by) WHERE status='sent';`;

const text=value=>String(value??'').trim();
const formatDate=value=>{const m=text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:text(value)};

export function approvalOtpMessage({purpose,batch,reason,requestedBy,otp}){
 const what=purpose==='reopen'?'reopen the closed batch':'unlock the VLB side of batch';
 return [
  `Caliber Pulse: ${APPROVAL_PURPOSES[purpose]?.label||'batch approval'}`,
  `${requestedBy} asks to ${what} ${batch.name} (${displaySiteName(batch.site)}, ${formatDate(batch.report_date||batch.book_date)}, ${batch.shift}).`,
  `Reason: ${reason}`,
  `OTP ${otp}, valid ${OTP_TTL_MINUTES} minutes. Share it only if you approve. Reading out this code is your approval and is recorded in the batch audit.`,
 ].join('\n');
}

export const publicApprovalOtp=row=>row?{id:row.id,purpose:row.purpose,requestId:row.request_id||null,reason:row.reason,requestedBy:row.requested_by,requestedAt:row.requested_at,expiresAt:row.expires_at,sentTo:row.sent_to,channels:row.channels,attempts:row.attempts,status:row.status}:null;

// Cancels any live code for the same batch, purpose and requester (after the one-per-minute
// rule), sends a fresh one to the current PMs of the batch site and stores only its hash.
export async function issueApprovalOtp(client,{batch,purpose,reason,requestId=null,requestedBy,requesterName,pmLogins,deliver}){
 if(!APPROVAL_PURPOSES[purpose])otpFail('Select what the Project Manager should approve.',400);
 if(typeof deliver!=='function')otpFail('OTP delivery is not configured on this server. Ask the site PM to approve on screen.',503);
 const live=(await client.query("SELECT * FROM mis_vlb_approval_otps WHERE batch_id=$1 AND purpose=$2 AND requested_by=$3 AND status='sent' FOR UPDATE",[batch.id,purpose,requestedBy])).rows[0];
 if(live&&resendTooSoon(live.requested_at))otpFail('An OTP was sent less than a minute ago. Wait before requesting again.',429);
 if(live)await client.query("UPDATE mis_vlb_approval_otps SET status='cancelled' WHERE id=$1",[live.id]);
 const logins=await pmLogins(client,batch.site);
 if(!logins.length)otpFail(`No Project Manager is assigned to ${displaySiteName(batch.site)}. Ask an MIS administrator.`,409);
 const id=randomUUID(),otp=generateOtp(),expiresAt=otpExpiresAt();
 const message=approvalOtpMessage({purpose,batch,reason,requestedBy:requesterName||requestedBy,otp});
 const delivery=await deliver({logins,message,otp,eventKey:`vlb-approval-otp:${id}`});
 if(!delivery.sentTo.length)otpFail(`${displaySiteName(batch.site)} PM has no Telegram or mobile registered. ${(delivery.failures||[]).join(' ')}`.trim(),409);
 return (await client.query('INSERT INTO mis_vlb_approval_otps(id,batch_id,purpose,request_id,closure_revision,reason,requested_by,sent_to,channels,otp_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[id,batch.id,purpose,requestId,batch.closure_revision??null,reason,requestedBy,delivery.sentTo,delivery.channels,hashOtp(id,otp),expiresAt])).rows[0];
}

// Locks the row, applies the attempt rules and marks it used on success. Only the MIS user who
// asked for the code can enter it, and only against the batch it was issued for.
export async function consumeApprovalOtp(client,{otpId,batchId,login,otp}){
 const row=/^[0-9a-f-]{36}$/i.test(otpId||'')?(await client.query('SELECT * FROM mis_vlb_approval_otps WHERE id=$1 FOR UPDATE',[otpId])).rows[0]:null;
 if(!row||row.batch_id!==batchId||row.requested_by!==login)otpFail('This approval request is no longer available. Request a new OTP.',404);
 const check=checkOtpAttempt(row,otp);
 if(!check.ok){
  if(check.status!=='missing'&&(check.status!==row.status||check.attempts!==undefined&&check.attempts!==row.attempts))await client.query('UPDATE mis_vlb_approval_otps SET status=$2,attempts=$3 WHERE id=$1',[row.id,check.status,check.attempts??row.attempts]);
  otpFail(check.message,400);
 }
 return (await client.query("UPDATE mis_vlb_approval_otps SET status='used',used_at=NOW(),approved_by=$2 WHERE id=$1 RETURNING *",[row.id,row.sent_to.join(', ')])).rows[0];
}

export async function liveApprovalOtps(client,batchId,login){
 const {rows}=await client.query("SELECT * FROM mis_vlb_approval_otps WHERE batch_id=$1 AND requested_by=$2 AND status='sent' AND expires_at>clock_timestamp() ORDER BY requested_at DESC",[batchId,login]);
 return rows;
}
