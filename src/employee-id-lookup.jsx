import React,{useEffect,useState,useRef} from 'react';
// The Fetch box for a driver's or operator's Employee ID / Caliber ID.
// On a scanned card (scanMode) the number the scan read is shown, but it is not fetched by itself: the scan has
// already judged that number and held the card (shared/caliber-id-check.mjs), so only a number a person types, or
// the Fetch button, looks it up. A helper, mechanic or supervisor comes back as a question the person answers
// once ("Yes, … drove this vehicle"); the answer is kept with the employee.
export default function EmployeeIdLookup({token,caliberId='',suggestedId='',onResolved,onEnter,disabled=false,role='driver',location='',scanMode=false}){
 const [value,setValue]=useState(caliberId||suggestedId),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(null);
 const typed=useRef(false);
 useEffect(()=>{setValue(caliberId||suggestedId);setError('');setConfirm(null);typed.current=false},[caliberId,suggestedId]);
 const resolveRef=useRef(onResolved);resolveRef.current=onResolved;
 const ask=async(id,{signal,confirmDriver=false}={})=>{
  const r=await fetch('/api/log-books/employee-lookup'+(scanMode?'?scan=1':''),{method:'POST',signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({caliberId:id,location,...(scanMode?{kind:role==='operator'?'equipment':'vehicle'}:{}),...(confirmDriver?{confirmDriver:true}:{})})});
  const body=await r.json();
  if(!r.ok)throw Object.assign(new Error(body.error||'Employee lookup failed.'),{confirmDriver:body.confirmDriver?{...body.confirmDriver,id}:null});
  return body;
 };
 useEffect(()=>{const id=value.trim();if(disabled||!id||id===caliberId||(scanMode&&!typed.current)||!/^([A-Z]+-?)?\d{3,10}$/i.test(id))return;const controller=new AbortController();const timer=setTimeout(async()=>{setBusy(true);setError('');setConfirm(null);try{const body=await ask(id,{signal:controller.signal});if(!controller.signal.aborted){await resolveRef.current(body);setValue(body.caliberId);}}catch(e){if(!controller.signal.aborted){setError(e.message);setConfirm(e.confirmDriver||null)}}finally{if(!controller.signal.aborted)setBusy(false)}},600);return()=>{clearTimeout(timer);controller.abort();setBusy(false)}},[value,caliberId,disabled,token,location,scanMode]);
 const lookup=async(confirmDriver=false)=>{setBusy(true);setError('');setConfirm(null);try{const body=await ask(confirmDriver?confirm.id:value,{confirmDriver});await onResolved(body);setValue(body.caliberId);}catch(e){setError(e.message);setConfirm(e.confirmDriver||null)}finally{setBusy(false)}};
 return <div className="employee-id-lookup"><div style={{display:'flex',gap:6}}><input aria-label="Employee ID or Caliber ID lookup" value={value} disabled={disabled||busy} onChange={e=>{typed.current=true;setValue(e.target.value);setError('');setConfirm(null)}} placeholder="Enter Employee ID or Caliber ID" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(!e.repeat){if(value.trim()&&!busy)void lookup();onEnter?.()}}}}/><button type="button" disabled={disabled||busy||!value.trim()} onClick={()=>lookup()}>{busy?'Fetching…':'Fetch '+role}</button></div>{error&&<small role="alert" style={{color:'#a41935'}}>{error}</small>}{confirm&&<button type="button" className="employee-id-confirm" disabled={disabled||busy} onClick={()=>lookup(true)}>Yes, {confirm.name||'this person'} {role==='operator'?'operated this machine':'drove this vehicle'}</button>}</div>
}
