import React,{useEffect,useState} from 'react';
import {otpCountdown,otpSentText} from './vlb-batch-holds.jsx';

// Approval of one equipment alias pair by OTP. Route 1 is the fixed mapping approver by
// Telegram only ("Resend" always available after the one-per-minute rule). Route 2, the
// emergency OTP to the site Project Manager, is always visible and needs a reason. Either
// approval makes the pair permanent. The same panel revokes an alias (purpose revoke_alias).
export const EMERGENCY_REASON_OPTIONS=[['on_leave','On leave'],['unwell','Unwell'],['not_answering','Not answering'],['other','Other (describe)']];
export const aliasApi=session=>async(path,body,method=body?'POST':'GET')=>{
 const response=await fetch(path,{method,cache:'no-store',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 let data={};try{data=await response.json()}catch{data={}}
 if(!response.ok)throw Error(data.error||'Request failed (HTTP '+response.status+').');
 return data;
};
const useClock=active=>{const [now,setNow]=useState(()=>Date.now());useEffect(()=>{if(!active)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[active]);return now};
export const liveAliasOtp=(alias,purpose,route)=>(alias?.otps||[]).find(otp=>otp.purpose===purpose&&otp.status==='sent'&&(!route||otp.route===route))||null;

export default function EquipmentAliasOtpPanel({session,alias,purpose='map_equipment',site='',counts=null,approver=null,approverTelegramLinked=true,onApproved,onAlias,disabled=false}){
 const api=aliasApi(session);
 const [otp,setOtp]=useState(()=>liveAliasOtp(alias,purpose));
 const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[emergency,setEmergency]=useState(false),[reason,setReason]=useState('not_answering'),[note,setNote]=useState('');
 useEffect(()=>{setOtp(liveAliasOtp(alias,purpose));setCode('');},[alias?.id,purpose]);
 const now=useClock(Boolean(otp));
 const expired=Boolean(otp)&&otpCountdown(otp.expiresAt,now)==='expired';
 const approverName=approver?.login?approver.login.toUpperCase():'the approver';
 const request=async route=>{if(busy)return;setBusy(true);setMessage('');try{const data=await api('/api/equipment-aliases/'+alias.id+'/otp',{purpose,route,site,counts,emergencyReason:route==='site_pm'?reason:undefined,emergencyNote:route==='site_pm'?note:undefined});setOtp(data.otp);setCode('');setEmergency(false);}catch(e){setMessage(e.message)}finally{setBusy(false)}};
 const verify=async()=>{if(busy||!otp?.id)return;setBusy(true);setMessage('');try{const data=await api('/api/equipment-aliases/'+alias.id+'/otp/'+otp.id+'/verify',{otp:code.trim()});onAlias?.(data.alias);await onApproved?.(data);}catch(e){setMessage(e.message)}finally{setBusy(false)}};
 const verb=purpose==='revoke_alias'?'revoke':'approve';
 return <div className="vlb-approval-otp scan-alias-otp">
  {otp&&<p role="status" className="vlb-approval-feedback">{otp.route==='nitish'?'OTP sent to '+approverName+' by Telegram':otpSentText(otp)} · {otpCountdown(otp.expiresAt,now)}{otp.route==='site_pm'&&otp.reason?' · emergency: '+otp.reason:''}. Phone them and enter the code they read out.</p>}
  {otp&&<div className="vlb-hold-otp"><label>OTP<input type="text" inputMode="numeric" maxLength={6} aria-label={purpose==='revoke_alias'?'Revoke alias OTP':'Equipment mapping OTP'} value={code} disabled={busy||expired} onChange={e=>setCode(e.target.value)}/></label>
   <button type="button" className="vlb-approval-primary" disabled={busy||expired||!/^\d{6}$/.test(code.trim())} onClick={verify}>{busy?'Verifying…':'Approve'}</button></div>}
  <div className="scan-alias-routes">
   {!otp&&<p className="vlb-approval-help">{approverTelegramLinked?`Send a one-time password to ${approverName} by Telegram. Phone ${approverName}; reading out the code is the approval and is recorded in the batch audit.`:`${approverName} has not linked Telegram from the ${approverName} login, so only the emergency route to the site PM is available until they do.`}</p>}
   <button type="button" disabled={disabled||busy||!approverTelegramLinked} onClick={()=>request('nitish')}>{busy?'Sending…':otp?.route==='nitish'?'Resend to '+approverName:'Send OTP to '+approverName}</button>
   <button type="button" className="scan-alias-emergency" disabled={disabled||busy} aria-expanded={emergency} onClick={()=>setEmergency(v=>!v)}>Emergency OTP to site PM…</button>
   {emergency&&<div className="scan-alias-emergency-form"><p>Use this when {approverName} cannot be reached. The site Project Manager(s) receive the code by Telegram, then WhatsApp. The reason is recorded.</p>
    <label>Why {approverName} cannot be reached<select aria-label="Emergency reason" value={reason} onChange={e=>setReason(e.target.value)}>{EMERGENCY_REASON_OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {reason==='other'&&<label>Describe<input type="text" maxLength={300} aria-label="Emergency reason detail" value={note} onChange={e=>setNote(e.target.value)}/></label>}
    <button type="button" className="vlb-approval-primary" disabled={busy||(reason==='other'&&note.trim().length<5)} onClick={()=>request('site_pm')}>{busy?'Sending…':'Send emergency OTP to site PM'}</button></div>}
  </div>
  {message&&<p className="logbook-message error" role="alert">{message}</p>}
  {!otp&&purpose==='map_equipment'&&<p className="scan-alias-note">The pair is already applied to this batch. Saving and locking continue; only permanence waits for the {verb}al.</p>}
 </div>;
}
