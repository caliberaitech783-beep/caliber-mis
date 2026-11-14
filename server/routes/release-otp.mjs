import {randomUUID} from 'node:crypto';
import {generateOtp,hashOtp,checkOtpAttempt,resendTooSoon,otpExpiresAt,OTP_TTL_MINUTES,OTP_RESEND_SECONDS} from '../../shared/otp-approval.mjs';

// Urgent production release approval. The production release workflow
// (.github/workflows/main_caliber-mis-783.yml) calls these with its GitHub OIDC
// token when someone chooses "Urgent" in Run workflow:
//   POST /api/release-otp/request  sends a six-digit OTP to the owner (Telegram,
//                                  WhatsApp only if Telegram is not linked);
//   POST /api/release-otp/verify   {otp} checks it once; the run then deploys.
// One pending OTP at a time, ten minutes, five wrong attempts, one request a minute.
export const RELEASE_OTP_KEY='production_release_otp';
const RECIPIENTS={telegram:'owner on Telegram',whatsapp:'owner on WhatsApp +91 ******5281'};

export function registerReleaseOtp(app,{pool,verifyIdentity,sendOtp,now=()=>Date.now(),audit=()=>{}}){
 const identity=async req=>verifyIdentity(String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim());
 const withRow=async work=>{
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const row=(await client.query('SELECT setting_value FROM app_settings WHERE setting_key=$1 FOR UPDATE',[RELEASE_OTP_KEY])).rows[0]?.setting_value||null;
   const save=value=>client.query(`INSERT INTO app_settings (setting_key,setting_value,updated_at) VALUES ($1,$2::jsonb,NOW())
     ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()`,[RELEASE_OTP_KEY,JSON.stringify(value)]);
   const result=await work(row,save);
   await client.query('COMMIT');
   return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 };
 const fail=(res,error)=>res.status(error.status||500).json({error:error.status?error.message:'The release OTP could not be processed.'});

 app.post('/api/release-otp/request',async(req,res)=>{
  try{
   const claims=await identity(req);
   const otp=generateOtp(),id=randomUUID(),actor=String(claims.actor||''),runId=String(claims.run_id||'');
   const {channel}=await withRow(async(row,save)=>{
    if(row?.status==='sent'&&resendTooSoon(row.requested_at,{now:now()}))throw Object.assign(new Error(`An OTP was sent less than ${OTP_RESEND_SECONDS} seconds ago. Use that OTP or wait a minute.`),{status:429});
    // The send happens inside the lock, so two requests never leave two live OTPs.
    const sent=await sendOtp({otp,actor,runId});
    await save({id,otp_hash:hashOtp(id,otp),status:'sent',attempts:0,requested_at:new Date(now()).toISOString(),expires_at:otpExpiresAt(now()),actor,run_id:runId,channel:sent.channel});
    return sent;
   });
   const recipient=RECIPIENTS[channel]||'owner';
   audit(req,{action:'Urgent release OTP sent',reference:runId,details:{actor,recipient}});
   res.json({recipient,expiresInMinutes:OTP_TTL_MINUTES});
  }catch(error){fail(res,error)}
 });

 app.post('/api/release-otp/verify',async(req,res)=>{
  try{
   const claims=await identity(req);
   const result=await withRow(async(row,save)=>{
    const outcome=checkOtpAttempt(row,req.body?.otp,{now:now()});
    if(row&&(outcome.status!==row.status||outcome.attempts!==row.attempts))await save({...row,status:outcome.status,attempts:outcome.attempts??row.attempts,...(outcome.ok?{used_at:new Date(now()).toISOString(),used_by_run:String(claims.run_id||'')}:{})});
    return outcome;
   });
   audit(req,{action:result.ok?'Urgent release approved by OTP':'Urgent release OTP rejected',reference:String(claims.run_id||''),details:{actor:claims.actor}});
   if(!result.ok)return res.status(400).json({error:result.message});
   res.json({approved:true});
  }catch(error){fail(res,error)}
 });
}
