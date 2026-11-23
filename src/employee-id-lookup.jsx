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
// With a Submit button (submitLabel; the Caliber ID Re-check lines, owner 23 Nov 2026) a number that is typed or
// fetched only shows whose it is: nothing is handed over until the person presses that button, so a pause in typing
// can never choose a driver by itself. A "Yes, … drove this vehicle" or a confirmed OTP is already a person's answer
// naming that worker, so those two hand the worker over at once, as before. submitHint says what Submit does on that
// page ("to put this person on the card", since Submit there corrects the card at once).
// Refresh (owner, 23 Nov 2026): a number HR's employee list does not carry comes back as "ID not found. Please contact
// your HR team." with a Refresh button. Refresh asks HR Pulse for that number at once; when HR has added the person the
// answer is the worker, exactly as after a Fetch, so the card goes on. refreshFirst shows the button before any Fetch,
// for a scanned card the scan already held for that reason. This file imports nothing but React (its tests run it bare).
export default function EmployeeIdLookup({token,caliberId='',suggestedId='',onResolved,onEnter,disabled=false,role='driver',location='',scanMode=false,bookDate='',card=null,submitLabel='',submitHint='to choose this person',refreshFirst=false,refreshHint='Check the number on the card first. Press Refresh after HR has added or corrected this ID in HR Pulse.'}){
 const [value,setValue]=useState(caliberId||suggestedId),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(null),[move,setMove]=useState(null),[otp,setOtp]=useState(null),[code,setCode]=useState(''),[found,setFound]=useState(null),[looking,setLooking]=useState(false),[refresh,setRefresh]=useState('');
 const typed=useRef(false),box=useRef(null),latest=useRef(value),asked=useRef('');
 latest.current=value;
 const clear=()=>{setError('');setConfirm(null);setMove(null);setOtp(null);setCode('');setFound(null);setRefresh('')};
 useEffect(()=>{setValue(caliberId||suggestedId);clear();typed.current=false},[caliberId,suggestedId]);
 const resolveRef=useRef(onResolved);resolveRef.current=onResolved;
 const post=async(path,body,signal)=>{
  const r=await fetch(path,{method:'POST',signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const answer=await r.json();
  if(!r.ok)throw Object.assign(new Error(answer.error||'Employee lookup failed.'),{answer});
  return answer;
 };
 // refreshId: the number of a refusal HR settles (the server marks it refresh), which Refresh then asks HR Pulse about.
 const call=(path,id,{signal,confirmDriver=false}={})=>post(path+(scanMode?'?scan=1':''),{caliberId:id,location,...(bookDate?{bookDate}:{}),...(scanMode?{kind:role==='operator'?'equipment':'vehicle'}:{}),...(confirmDriver?{confirmDriver:true}:{})},signal)
  .catch(e=>{throw Object.assign(e,{confirmDriver:e.answer?.confirmDriver?{...e.answer.confirmDriver,id}:null,siteMove:e.answer?.siteMove||null,refreshId:e.answer?.refresh===true?id:''})});
 const ask=(id,options)=>call('/api/log-books/employee-lookup',id,options);
 const refused=e=>{setError(e.message);setConfirm(e.confirmDriver||null);setMove(e.siteMove||null);setOtp(null);setCode('');setRefresh(e.refreshId||'')};
 // Refresh: HR Pulse is asked for the number now. The worker it gives is handed on as a Fetch would hand him on.
 const refreshNow=async()=>{const id=(refresh||value).trim();if(!id)return;setBusy('refresh');setError('');try{const employee=await call('/api/log-books/employee-refresh',id);clear();if(submitLabel){asked.current=id;setFound({id,employee});}else{await onResolved(employee);setValue(employee.caliberId);}}catch(e){refused(e);setFound(null)}finally{setBusy(false)}};
 // Submit mode: whose number it is, shown under the box. A number already shown or being asked is not asked twice
 // (again = the person pressed Fetch), and an answer for a number the person has since changed is dropped. The box
 // stays open for typing meanwhile.
 const show=async(id,again=false)=>{if(!id||(!again&&asked.current===id))return;asked.current=id;setLooking(true);clear();try{const employee=await ask(id);if(latest.current.trim()===id)setFound({id,employee})}catch(e){if(latest.current.trim()===id)refused(e)}finally{setLooking(false)}};
 // Submit: the person shown (or, when Submit is pressed before the name came, the person the number fetches) is handed over.
 const submit=async()=>{const id=value.trim();if(!id)return setError('Type the right Employee ID or Caliber ID from the paper card, then press '+submitLabel+'.');setBusy('submit');setError('');try{const employee=found?.id===id?found.employee:await ask(id);await onResolved(employee);clear();}catch(e){refused(e);setFound(null)}finally{setBusy(false)}};
 useEffect(()=>{const id=value.trim();if(disabled||!id||id===caliberId||(scanMode&&!typed.current)||!/^([A-Z]+-?)?\d{3,10}$/i.test(id))return;if(submitLabel){const timer=setTimeout(()=>show(id),600);return()=>clearTimeout(timer)}const controller=new AbortController();const timer=setTimeout(async()=>{setBusy(true);clear();try{const body=await ask(id,{signal:controller.signal});if(!controller.signal.aborted){await resolveRef.current(body);setValue(body.caliberId);}}catch(e){if(!controller.signal.aborted)refused(e)}finally{if(!controller.signal.aborted)setBusy(false)}},600);return()=>{clearTimeout(timer);controller.abort();setBusy(false)}},[value,caliberId,disabled,token,location,scanMode,bookDate]);
 const lookup=async(confirmDriver=false)=>{const id=confirmDriver?confirm.id:value;if(submitLabel&&!confirmDriver)return show(id.trim(),true);setBusy(true);clear();try{const body=await ask(id,{confirmDriver});await onResolved(body);if(!submitLabel)setValue(body.caliberId);}catch(e){refused(e)}finally{setBusy(false)}};
 const askOtp=async()=>{setBusy(true);setError('');try{const body=await post('/api/log-books/employee-site-move',{caliberId:move.employeeId,location,bookDate,...(card?{card}:{})});setOtp(body.otp);setCode('');}catch(e){setError(e.message)}finally{setBusy(false)}};
 const confirmMove=async()=>{setBusy(true);setError('');try{const body=await post('/api/log-books/employee-site-move/'+otp.id+'/verify',{otp:code.trim()});clear();await onResolved(body);if(!submitLabel)setValue(body.caliberId);}catch(e){setError(e.message)}finally{setBusy(false)}};
 const shown=submitLabel&&found?.id===value.trim()?found.employee:null;
 return <div className="employee-id-lookup"><div style={{display:'flex',gap:6}}><input ref={box} aria-label="Employee ID or Caliber ID lookup" value={value} disabled={disabled||busy} onChange={e=>{typed.current=true;asked.current='';setValue(e.target.value);clear()}} placeholder="Enter Employee ID or Caliber ID" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(!e.repeat){if(value.trim()&&!busy)void(shown?submit():lookup());onEnter?.()}}}}/><button type="button" disabled={disabled||busy||looking||!value.trim()} onClick={()=>lookup()}>{(submitLabel?looking:busy&&busy!=='refresh')?'Fetching…':'Fetch '+role}</button>{submitLabel?<button type="button" className="employee-id-submit" disabled={disabled||busy||looking} onClick={submit}>{busy==='submit'?'Submitting…':submitLabel}</button>:null}</div>{shown&&<small className="employee-id-found" role="status"><strong>{shown.caliberId} · {shown.name}</strong> Press {submitLabel} {submitHint}.</small>}{error&&<small role="alert" style={{color:'#a41935'}}>{error}</small>}{(refresh||(refreshFirst&&!shown&&!confirm&&!move&&value.trim()))&&<div className="employee-id-refresh"><button type="button" className="employee-id-refresh-button" disabled={disabled||Boolean(busy)||looking} onClick={refreshNow}>{busy==='refresh'?'Checking HR Pulse…':'Refresh'}</button><small>{refreshHint}</small></div>}{confirm&&<button type="button" className="employee-id-confirm" disabled={disabled||busy} onClick={()=>lookup(true)}>Yes, {confirm.name||'this person'} {role==='operator'?'operated this machine':'drove this vehicle'}</button>}{move&&!otp&&<div className="employee-site-move"><button type="button" className="employee-id-correct" disabled={disabled||busy} onClick={()=>{box.current?.focus();box.current?.select?.()}}>Correct the number</button><button type="button" className="employee-id-move" disabled={disabled||busy} onClick={askOtp}>Fetch from Pulse-II with OTP</button><small>Fetch moves {move.name||'this person'} from {move.from} to {move.to} from {dmy(move.fromDate)}, for salary and every record. The Project Manager of {move.from} gets the OTP.</small></div>}{move&&otp&&<div className="employee-site-move"><small>OTP sent to {(otp.sentTo||[]).join(', ')||'the Project Manager'} for {move.from}. Enter it to move {move.name||'this person'} to {move.to} from {dmy(move.fromDate)}.</small><div style={{display:'flex',gap:6}}><input aria-label="OTP for the site change" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit OTP" value={code} disabled={disabled||busy} onChange={e=>{setCode(e.target.value.replace(/\D/g,'').slice(0,6));setError('')}}/><button type="button" className="employee-id-move" disabled={disabled||busy||!/^\d{6}$/.test(code)} onClick={confirmMove}>Confirm the move</button></div><button type="button" className="employee-id-resend" disabled={disabled||busy} onClick={askOtp}>Send the OTP again</button></div>}</div>
}
