import React,{useEffect,useState,useRef} from 'react';
const dmy=value=>{const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:String(value||'')};
// The Fetch box for a driver's or operator's Employee ID / Caliber ID.
// On a scanned card (scanMode) the number the scan read is shown, but it is not fetched by itself: the scan has
// already judged that number and held the card (shared/caliber-id-check.mjs), so only a number a person types, or
// the Fetch button, looks it up. A helper, mechanic or supervisor comes back as a question the person answers
// once ("Yes, … drove this vehicle"); the answer is kept with the employee.
// A number that belongs to a worker of another site comes back with the one approved way to move that worker
// (owner, 22 Nov 2026; shared/employee-site-moves.mjs): "Correct the number" first, because most such numbers are
// a misread, then "Fetch from Pulse-II with OTP". The OTP goes to the Project Manager of the site the worker is
// leaving; on it the site changes from the card's date (bookDate) and the worker is put on the card.
export default function EmployeeIdLookup({token,caliberId='',suggestedId='',onResolved,onEnter,disabled=false,role='driver',location='',scanMode=false,bookDate='',card=null}){
 const [value,setValue]=useState(caliberId||suggestedId),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(null),[move,setMove]=useState(null),[otp,setOtp]=useState(null),[code,setCode]=useState('');
 const typed=useRef(false),box=useRef(null);
 const clear=()=>{setError('');setConfirm(null);setMove(null);setOtp(null);setCode('')};
 useEffect(()=>{setValue(caliberId||suggestedId);clear();typed.current=false},[caliberId,suggestedId]);
 const resolveRef=useRef(onResolved);resolveRef.current=onResolved;
 const post=async(path,body,signal)=>{
  const r=await fetch(path,{method:'POST',signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const answer=await r.json();
  if(!r.ok)throw Object.assign(new Error(answer.error||'Employee lookup failed.'),{answer});
  return answer;
 };
 const ask=(id,{signal,confirmDriver=false}={})=>post('/api/log-books/employee-lookup'+(scanMode?'?scan=1':''),{caliberId:id,location,...(bookDate?{bookDate}:{}),...(scanMode?{kind:role==='operator'?'equipment':'vehicle'}:{}),...(confirmDriver?{confirmDriver:true}:{})},signal)
  .catch(e=>{throw Object.assign(e,{confirmDriver:e.answer?.confirmDriver?{...e.answer.confirmDriver,id}:null,siteMove:e.answer?.siteMove||null})});
 const refused=e=>{setError(e.message);setConfirm(e.confirmDriver||null);setMove(e.siteMove||null);setOtp(null);setCode('')};
 useEffect(()=>{const id=value.trim();if(disabled||!id||id===caliberId||(scanMode&&!typed.current)||!/^([A-Z]+-?)?\d{3,10}$/i.test(id))return;const controller=new AbortController();const timer=setTimeout(async()=>{setBusy(true);clear();try{const body=await ask(id,{signal:controller.signal});if(!controller.signal.aborted){await resolveRef.current(body);setValue(body.caliberId);}}catch(e){if(!controller.signal.aborted)refused(e)}finally{if(!controller.signal.aborted)setBusy(false)}},600);return()=>{clearTimeout(timer);controller.abort();setBusy(false)}},[value,caliberId,disabled,token,location,scanMode,bookDate]);
 const lookup=async(confirmDriver=false)=>{const id=confirmDriver?confirm.id:value;setBusy(true);clear();try{const body=await ask(id,{confirmDriver});await onResolved(body);setValue(body.caliberId);}catch(e){refused(e)}finally{setBusy(false)}};
 const askOtp=async()=>{setBusy(true);setError('');try{const body=await post('/api/log-books/employee-site-move',{caliberId:move.employeeId,location,bookDate,...(card?{card}:{})});setOtp(body.otp);setCode('');}catch(e){setError(e.message)}finally{setBusy(false)}};
 const confirmMove=async()=>{setBusy(true);setError('');try{const body=await post('/api/log-books/employee-site-move/'+otp.id+'/verify',{otp:code.trim()});clear();await onResolved(body);setValue(body.caliberId);}catch(e){setError(e.message)}finally{setBusy(false)}};
 return <div className="employee-id-lookup"><div style={{display:'flex',gap:6}}><input ref={box} aria-label="Employee ID or Caliber ID lookup" value={value} disabled={disabled||busy} onChange={e=>{typed.current=true;setValue(e.target.value);clear()}} placeholder="Enter Employee ID or Caliber ID" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(!e.repeat){if(value.trim()&&!busy)void lookup();onEnter?.()}}}}/><button type="button" disabled={disabled||busy||!value.trim()} onClick={()=>lookup()}>{busy?'Fetching…':'Fetch '+role}</button></div>{error&&<small role="alert" style={{color:'#a41935'}}>{error}</small>}{confirm&&<button type="button" className="employee-id-confirm" disabled={disabled||busy} onClick={()=>lookup(true)}>Yes, {confirm.name||'this person'} {role==='operator'?'operated this machine':'drove this vehicle'}</button>}{move&&!otp&&<div className="employee-site-move"><button type="button" className="employee-id-correct" disabled={disabled||busy} onClick={()=>{box.current?.focus();box.current?.select?.()}}>Correct the number</button><button type="button" className="employee-id-move" disabled={disabled||busy} onClick={askOtp}>Fetch from Pulse-II with OTP</button><small>Fetch moves {move.name||'this person'} from {move.from} to {move.to} from {dmy(move.fromDate)}, for salary and every record. The Project Manager of {move.from} gets the OTP.</small></div>}{move&&otp&&<div className="employee-site-move"><small>OTP sent to {(otp.sentTo||[]).join(', ')||'the Project Manager'} for {move.from}. Enter it to move {move.name||'this person'} to {move.to} from {dmy(move.fromDate)}.</small><div style={{display:'flex',gap:6}}><input aria-label="OTP for the site change" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit OTP" value={code} disabled={disabled||busy} onChange={e=>{setCode(e.target.value.replace(/\D/g,'').slice(0,6));setError('')}}/><button type="button" className="employee-id-move" disabled={disabled||busy||!/^\d{6}$/.test(code)} onClick={confirmMove}>Confirm the move</button></div><button type="button" className="employee-id-resend" disabled={disabled||busy} onClick={askOtp}>Send the OTP again</button></div>}</div>
}
