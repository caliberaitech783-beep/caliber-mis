import React,{useEffect,useState} from 'react';

// "Send vehicle transfers to Pulse" (Pulse Master Sync page). ON: a transfer accepted in Pulse-II is
// completed in Pulse first, so the hourly copy never moves the vehicle back. OFF: the old behaviour.
export default function PulseTransferSwitch({session}){
 const [state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const call=async(method,body)=>{const r=await fetch('/api/pulse-transfer-write',{method,headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'The switch could not be read.');return d;};
 const load=async()=>{try{setState(await call('GET'));setError('');}catch(e){setError(e.message);}};
 useEffect(()=>{void load();const t=setInterval(()=>void load(),30000);return()=>clearInterval(t);},[session.token]);
 const flip=async()=>{
  const next=!state?.on;
  if(!window.confirm(next?'Send vehicle transfers to Pulse again? Each accepted transfer is completed in Pulse first.':'Stop sending vehicle transfers to Pulse? Accepted transfers will move the vehicle in Pulse-II only, and the next hourly copy from Pulse moves it back until someone enters the transfer in Pulse.'))return;
  setBusy(true);try{setState(await call('PUT',{on:next}));setError('');}catch(e){setError(e.message);}finally{setBusy(false);}
 };
 if(!state&&!error)return null;
 return <div className="master-sync-note pulse-transfer-switch"><p><strong>Send vehicle transfers to Pulse: {state?.on?'ON':'OFF'}</strong>{' '}
  <button type="button" onClick={()=>void flip()} disabled={busy||!state}>{busy?'Saving…':state?.on?'Switch OFF':'Switch ON'}</button></p>
  <p>{state?.on?'A transfer accepted in Pulse-II is completed in Pulse first, so the vehicle never moves back at the hourly copy. Oracle transfer imports are kept as history and do not change vehicle sites.':'Accepted transfers change Pulse-II only and are listed under Pending in Pulse.'}
   {state?.waiting?` ${state.waiting} accepted transfer${state.waiting===1?' is':'s are'} waiting for Pulse and will finish by themselves.`:''}
   {state?.by?` Last changed by ${state.by}${state.at?' on '+new Date(state.at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):''}.`:''}</p>
  {error&&<p className="master-sync-error-text" role="alert">{error}</p>}</div>;
}
