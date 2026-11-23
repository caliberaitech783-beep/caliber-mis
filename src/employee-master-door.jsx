// The lock on Employee Master (owner, 23 Nov 2026; shared/employee-master-door.mjs): employees are created, edited
// and deleted only in HR Pulse. This panel says so, and lets an administrator ask the owner on Telegram to open
// Pulse-II's doors for a short time. The answer comes from Telegram, so the panel looks again by itself.
import React,{useEffect,useState} from 'react';

const clock=value=>value?new Date(value).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}):'';
export const DOOR_CLOSED_TITLE='Switched off: employees are changed only in HR Pulse.';

export default function EmployeeMasterDoor({session,onChange}){
 const [door,setDoor]=useState(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const api=async(path,body)=>{
  const response=await fetch('/api/employee-master/door'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'The Employee Master lock could not be read.');
  return data;
 };
 const take=value=>{setDoor(value);onChange?.(value.open===true);};
 const read=()=>api('').then(take).catch(e=>setError(e.message));
 useEffect(()=>{void read();},[session.token]);
 const waiting=door?.asked?.status==='awaiting',open=door?.open===true;
 useEffect(()=>{if(!waiting&&!open)return undefined;const timer=setInterval(()=>void read(),15000);return()=>clearInterval(timer);},[waiting,open,session.token]);
 const ask=async event=>{event.preventDefault();setBusy(true);setError('');try{take(await api('/ask',{reason}));setReason('');}catch(e){setError(e.message);}finally{setBusy(false);}};
 const close=async()=>{setBusy(true);setError('');try{take(await api('/close',{}));}catch(e){setError(e.message);}finally{setBusy(false);}};
 if(!door)return error?<p className="employee-error" role="alert">{error}</p>:null;
 return <section className={'employee-door '+(open?'employee-door-open':'employee-door-closed')} aria-label="Employee Master lock">
  {open?<>
    <p><strong>Open until {clock(door.openUntil)}.</strong> The owner ({door.allowedBy}) allowed adding and editing employees in Pulse-II for {door.openMinutes} minutes. It closes by itself.</p>
    <button type="button" disabled={busy} onClick={close}>Close now</button>
   </>:<>
    <p><strong>Switched off.</strong> {door.message}</p>
    {waiting?<p role="status">Sent to the owner on Telegram at {clock(door.asked.at)} by {door.asked.by}. Waiting for Allow.</p>
     :<form onSubmit={ask}>
       {door.asked?.status==='refused'&&<p role="status">The owner refused the last request.</p>}
       {door.asked?.status==='expired'&&<p role="status">The last request was not answered in time.</p>}
       <label>Why it must be opened here<input value={reason} maxLength={200} required minLength={5} disabled={busy} placeholder="Reason for the owner" onChange={event=>setReason(event.target.value)}/></label>
       <button disabled={busy||reason.trim().length<5}>Ask the owner on Telegram</button>
      </form>}
   </>}
  {error&&<p className="employee-error" role="alert">{error}</p>}
 </section>;
}
