// RHR unlock with OTP (owner, 27 Nov 2026): a batch of a day locked by attendance approval is reopened only after the
// RHR of the site's region gives an OTP. The user writes why, "Send OTP request to RHR" sends the OTP to RHR on Telegram
// (WhatsApp if Telegram is not connected), and the OTP entered here unlocks the day. The day then climbs Site HR,
// Office HR, RHR and Directors again once its batch is closed. Shown in the Reopen saved batch window and on a locked
// day in Masters › Attendance approval. Nothing is drawn for a day that is not locked.
// Routes: GET /api/attendance-approval/lock, POST /api/attendance-approval/unlock, POST /api/attendance-approval/unlock/verify.
import React,{useEffect,useState} from 'react';
import {UNLOCK_REASON_MIN,displayDate} from '../shared/attendance-approval.mjs';

export default function AttendanceUnlock({session,site,date,onLockChange=null,onUnlocked=null}){
 const [lock,setLock]=useState(null),[reason,setReason]=useState(''),[otp,setOtp]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 const headers={Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'};
 const day=String(date||'').slice(0,10);
 useEffect(()=>{
  if(!site||!/^\d{4}-\d{2}-\d{2}$/.test(day))return;
  let live=true;
  fetch(`/api/attendance-approval/lock?site=${encodeURIComponent(site)}&date=${day}`,{headers,cache:'no-store'}).then(r=>r.ok?r.json():null).then(answer=>{if(live&&answer){setLock(answer);onLockChange?.(answer.locked);}}).catch(()=>{});
  return()=>{live=false};
 },[site,day]);
 if(!lock?.locked&&!done)return null;
 if(done)return <p className="logbook-message" role="status">{done}</p>;
 const post=async(path,body)=>{
  const response=await fetch(path,{method:'POST',headers,cache:'no-store',body:JSON.stringify(body)});
  const answer=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(answer.error||'This could not be done.');
  return answer;
 };
 const ask=async()=>{
  if(reason.trim().length<UNLOCK_REASON_MIN){setError(`Write why this day has to be reopened (at least ${UNLOCK_REASON_MIN} letters).`);return;}
  setBusy(true);setError('');
  try{const {request}=await post('/api/attendance-approval/unlock',{site,date:day,reason});setLock(current=>({...current,request}));setOtp('');}
  catch(e){setError(e.message);}finally{setBusy(false);}
 };
 const verify=async()=>{
  if(!/^\d{6}$/.test(otp.trim())){setError('Enter the six-digit OTP from RHR.');return;}
  setBusy(true);setError('');
  try{
   await post('/api/attendance-approval/unlock/verify',{id:lock.request.id,otp:otp.trim()});
   setDone(`${lock.site} · ${displayDate(day)} is unlocked. Reopen the batch, correct it and close it again; the day then goes through Site HR, Office HR, RHR and Directors again.`);
   onLockChange?.(false);await onUnlocked?.();
  }catch(e){setError(e.message);}finally{setBusy(false);}
 };
 const request=lock.request;
 return <div className="attendance-unlock" style={{border:'1px solid #A32D2D',borderRadius:8,padding:'10px 12px',margin:'10px 0'}}>
  <strong>🔒 Attendance of {lock.site} on {displayDate(day)} is locked</strong>
  <p style={{margin:'4px 0'}}>Site HR, Office HR, RHR and Directors approved this day. To reopen its batch, ask RHR ({lock.rhr.length?lock.rhr.join(', '):'not set'}) for an OTP.</p>
  {!request?<>
   <label style={{display:'block'}}>Reason to reopen<textarea value={reason} onChange={e=>{setReason(e.target.value);setError('');}} maxLength={500} rows={2} style={{width:'100%'}} placeholder="Shift III card of DT-112 has the wrong driver"/></label>
   <button type="button" disabled={busy||!lock.rhr.length} onClick={()=>void ask()}>{busy?'Sending…':'Send OTP request to RHR'}</button>
  </>:<>
   <p style={{margin:'4px 0'}}>OTP sent to {request.sentTo.join(', ')} ({request.channels.join(', ')||'Telegram'}), valid 10 minutes. Reason: “{request.reason}”</p>
   <label>OTP from RHR <input value={otp} onChange={e=>{setOtp(e.target.value.replace(/\D/g,'').slice(0,6));setError('');}} inputMode="numeric" autoComplete="one-time-code" style={{width:110}}/></label>{' '}
   <button type="button" disabled={busy} onClick={()=>void verify()}>{busy?'Checking…':'Unlock with OTP'}</button>{' '}
   <button type="button" disabled={busy} onClick={()=>{setLock(current=>({...current,request:null}));setError('');}}>Ask again</button>
  </>}
  {error&&<p className="logbook-message error" role="alert">{error}</p>}
 </div>;
}
