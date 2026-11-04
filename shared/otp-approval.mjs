import {createHash,randomInt,timingSafeEqual} from 'node:crypto';

// Shared controls for PM approvals by one-time password, aligned with the
// Vehicle transfers OTP note: six digits, hash only, single use, ten minutes,
// five wrong attempts, one request per minute.
export const OTP_TTL_MINUTES=10;
export const OTP_MAX_ATTEMPTS=5;
export const OTP_RESEND_SECONDS=60;

export const generateOtp=()=>String(randomInt(100000,1000000));
export const hashOtp=(id,otp)=>createHash('sha256').update(`${id}:${String(otp).trim()}`).digest('hex');
export function otpMatches(id,otp,hash){
 const candidate=Buffer.from(hashOtp(id,otp)),stored=Buffer.from(String(hash||''));
 return candidate.length===stored.length&&timingSafeEqual(candidate,stored);
}
export const validOtpInput=value=>/^\d{6}$/.test(String(value||'').trim());
export const otpExpiresAt=(now=Date.now())=>new Date(now+OTP_TTL_MINUTES*60000).toISOString();
export const otpFail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};

// Evaluates a stored OTP row against an entered code. Returns the next row state;
// the caller persists it. Never reveals whether the code or the row was the problem
// beyond what the operator needs to retry.
export function checkOtpAttempt(row,otp,{now=Date.now()}={}){
 if(!row)return {ok:false,status:'missing',message:'This approval request is no longer available. Request a new OTP.'};
 if(row.status!=='sent')return {ok:false,status:row.status,message:row.status==='used'?'This OTP was already used.':'This OTP was cancelled. Request a new OTP.'};
 if(new Date(row.expires_at).getTime()<=now)return {ok:false,status:'expired',message:'This OTP has expired. Request a new OTP.'};
 if(!validOtpInput(otp))return {ok:false,status:'sent',attempts:row.attempts,message:'Enter the six-digit OTP.'};
 if(!otpMatches(row.id,otp,row.otp_hash)){
  const attempts=Number(row.attempts||0)+1,dead=attempts>=OTP_MAX_ATTEMPTS;
  return {ok:false,status:dead?'cancelled':'sent',attempts,message:dead?'Too many wrong attempts. Request a new OTP.':`Wrong OTP. ${OTP_MAX_ATTEMPTS-attempts} attempt${OTP_MAX_ATTEMPTS-attempts===1?'':'s'} left.`};
 }
 return {ok:true,status:'used',attempts:Number(row.attempts||0)};
}

export function resendTooSoon(requestedAt,{now=Date.now()}={}){
 const at=requestedAt?new Date(requestedAt).getTime():0;
 return at&&now-at<OTP_RESEND_SECONDS*1000;
}
