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
const RECIPIENTS={telegram:'owners (Mr Anoop and Mr Mohit Chadda) on Telegram',whatsapp:'owner on WhatsApp +91 ******5281'};

export function registerReleaseOtp(app,{pool,verifyIdentity,sendOtp,sendApproval=null,isApprover=async()=>false,now=()=>Date.now(),audit=()=>{}}){
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

 // Approve / Reject on Telegram (owner's choice, 15 Nov 2026: "instead of OTP send him approve or reject").
 //   POST /api/release-otp/request-approval  sends the buttons to the approvers; the run then waits;
 //   POST /api/release-otp/decision {id}      what was tapped. "approved" is handed out once, to the run that asked.
 app.post('/api/release-otp/request-approval',async(req,res)=>{
  try{
   if(!sendApproval)throw Object.assign(new Error('Approval buttons are not set up on this server.'),{status:503});
   const claims=await identity(req);
   const id=randomUUID().replace(/-/g,'').slice(0,16),actor=String(claims.actor||''),runId=String(claims.run_id||'');
   const commit=String(req.body?.commit||'').replace(/[^0-9a-f]/gi,'').slice(0,40),subject=String(req.body?.subject||'').slice(0,200);
   await withRow(async(row,save)=>{
    if(['sent','awaiting'].includes(row?.status)&&resendTooSoon(row.requested_at,{now:now()}))throw Object.assign(new Error(`An approval was asked less than ${OTP_RESEND_SECONDS} seconds ago. Wait a minute.`),{status:429});
    const {sent}=await sendApproval({id,actor,runId,commit,subject});
    if(!sent)throw Object.assign(new Error('Nobody who can approve has linked Telegram, so no approval buttons could be sent.'),{status:503});
    await save({id,mode:'buttons',status:'awaiting',attempts:0,requested_at:new Date(now()).toISOString(),expires_at:otpExpiresAt(now()),actor,run_id:runId,channel:'telegram'});
   });
   audit(req,{action:'Urgent release approval asked on Telegram',reference:runId,details:{actor}});
   res.json({id,recipient:RECIPIENTS.telegram,expiresInMinutes:OTP_TTL_MINUTES});
  }catch(error){fail(res,error)}
 });

 app.post('/api/release-otp/decision',async(req,res)=>{
  try{
   const claims=await identity(req),id=String(req.body?.id||'');
   const result=await withRow(async(row,save)=>{
    if(!row||row.mode!=='buttons'||row.id!==id)return {status:'missing'};
    if(row.status==='awaiting'&&new Date(row.expires_at).getTime()<=now()){await save({...row,status:'expired'});return {status:'expired'};}
    if(row.status==='approved'){
     if(String(claims.run_id||'')!==row.run_id)return {status:'missing'};
     await save({...row,status:'used',used_at:new Date(now()).toISOString(),used_by_run:row.run_id});
     return {status:'approved',by:row.decided_by};
    }
    return {status:row.status,by:row.decided_by||''};
   });
   if(result.status==='approved')audit(req,{action:'Urgent release approved on Telegram',reference:String(claims.run_id||''),details:{by:result.by}});
   res.json(result);
  }catch(error){fail(res,error)}
 });

 // Called by the Telegram webhook when a button is tapped. logins = the MIS logins linked to that chat.
 return {
  async handleTelegramCallback({data,logins}){
   const match=/^rel:([0-9a-f]{16}):([ar])$/.exec(String(data||''));
   if(!match)return null;
   const approvers=[];for(const login of logins||[])if(await isApprover(login))approvers.push(login);
   if(!approvers.length)return {answer:'Only the owners can approve a release.'};
   const by=approvers[0],approve=match[2]==='a';
   return withRow(async(row,save)=>{
    if(!row||row.mode!=='buttons'||row.id!==match[1])return {answer:'This approval request is no longer active.',done:true};
    if(row.status!=='awaiting')return {answer:row.decided_by?`Already ${row.status==='rejected'?'rejected':'approved'} by ${row.decided_by}.`:'This approval request is closed.',done:true};
    if(new Date(row.expires_at).getTime()<=now()){await save({...row,status:'expired'});return {answer:'This approval request has expired.',done:true};}
    const at=new Date(now()).toISOString();
    await save({...row,status:approve?'approved':'rejected',decided_by:by,decided_at:at});
    const when=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));
    return {answer:`${approve?'✅ Approved':'❌ Rejected'} by ${by} at ${when} IST.`,done:true};
   });
  }
 };
}
