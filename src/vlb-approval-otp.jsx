import React,{useEffect,useState} from 'react';
import {displaySiteName} from '../shared/region-scope.mjs';
import {otpCountdown,otpSentText} from './vlb-batch-holds.jsx';

// PM approval by OTP for reopening a closed batch. The MIS user asks
// for the code, phones the site PM, and enters it; the server records the PM's approval.
const post=async(session,url,body)=>{
 const response=await fetch(url,{method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:JSON.stringify(body||{})});
 let data={};try{data=await response.json()}catch{data={}}
 if(!response.ok)throw Error(data.error||(response.status===404?'PM approval by OTP is not available on this server yet. Ask the site PM to approve on screen.':'Request failed (HTTP '+response.status+').'));
 return data;
};
const useClock=active=>{const [now,setNow]=useState(()=>Date.now());useEffect(()=>{if(!active)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[active]);return now};
export const otpLabels={reopen:'Reopen OTP'};
export const liveOtpFor=(batch,purpose)=>(batch?.approvalOtps||[]).find(otp=>otp.purpose===purpose&&otp.status==='sent')||null;
export const validOtp=code=>/^\d{6}$/.test(String(code||'').trim());

export function ApprovalOtpPanel({session,batch,purpose,reason,disabled=false,onApproved,requestLabel='Request PM OTP'}){
 const [otp,setOtp]=useState(()=>liveOtpFor(batch,purpose));
 const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const now=useClock(Boolean(otp));
 const expired=Boolean(otp)&&otpCountdown(otp.expiresAt,now)==='expired';
 const request=async()=>{if(busy)return;setBusy(true);setMessage('');try{const data=await post(session,'/api/vlb-batches/'+batch.id+'/approval-otp',{purpose,reason});setOtp(data.otp);setCode('')}catch(e){setMessage(e.message)}finally{setBusy(false)}};
 const verify=async()=>{if(busy||!otp?.id)return;setBusy(true);setMessage('');try{const data=await post(session,'/api/vlb-batches/'+batch.id+'/approval-otp/'+otp.id+'/verify',{otp:code.trim()});await onApproved?.(data)}catch(e){setMessage(e.message)}finally{setBusy(false)}};
 return <div className="vlb-approval-otp">
  {!otp&&<p className="vlb-approval-help">Faster: the site PM can approve by phone. Request a one-time password, call the PM of {displaySiteName(batch.site)}, and enter the six-digit code they read out. Entering it is recorded as the PM's approval.</p>}
  {!otp&&<button type="button" disabled={disabled||busy} onClick={request}>{busy?'Sending…':requestLabel}</button>}
  {otp&&<><p role="status" className="vlb-approval-feedback">{otpSentText(otp)} · {otpCountdown(otp.expiresAt,now)}. Phone the PM and enter the code.</p>
   <div className="vlb-hold-otp"><label>OTP<input type="text" inputMode="numeric" maxLength={6} aria-label={otpLabels[purpose]||'PM OTP'} value={code} disabled={busy||expired} onChange={e=>setCode(e.target.value)}/></label>
    <button type="button" className="vlb-approval-primary" disabled={busy||expired||!validOtp(code)} onClick={verify}>{busy?'Verifying…':'Verify OTP'}</button>
    <button type="button" disabled={busy||disabled} onClick={request}>{expired?'Request new OTP':'Resend'}</button></div></>}
  {message&&<p className="logbook-message error" role="alert">{message}</p>}
 </div>;
}
