import React,{useEffect,useState} from 'react';
import './master-sync.css';

// Express transfers and new assets approved by OTP that still have to be applied in Pulse by hand.
export default function PendingInPulse({session}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
 const call=async(path,method='GET',body)=>{const r=await fetch(path,{method,cache:'no-store',headers:{Authorization:`Bearer ${session.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Pending Pulse list unavailable.');return d;};
 const load=()=>call('/api/pulse-pending').then(setData).catch(e=>setError(e.message));
 useEffect(()=>{void load();const t=setInterval(()=>void load(),30000);return()=>clearInterval(t);},[session.token]);
 const applied=async item=>{
  const note=window.prompt(`Confirm that ${item.kind==='transfer'?'transfer '+item.reference+' ('+item.door+' '+item.from+' → '+item.to+')':'asset '+item.door+' at '+item.to} has been applied in Pulse. Optional note:`,'');
  if(note===null)return;
  setBusy(item.kind+item.id);setError('');setNotice('');
  try{await call(`/api/pulse-pending/${item.kind}/${item.id}/applied`,'POST',{note});setNotice(`${item.reference} marked as applied in Pulse.`);await load();}catch(e){setError(e.message)}finally{setBusy('')}
 };
 if(!data&&!error)return null;
 const items=data?.items||[];
 return <section className="master-sync-page pulse-pending"><header><div><h1>Pending in Pulse</h1><p>{data?.mode==='live'?'Pulse writes are live. Items here were approved before the switch and still need to be applied in Pulse.':'Pulse-II cannot write to Pulse yet. Changes approved by OTP before this release were recorded here only; apply each one in Pulse, then mark it applied. New express requests are refused until the Pulse integration is live.'}</p></div></header>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {items.length===0?<p>Nothing is pending in Pulse.</p>:<div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Type</th><th>Reference</th><th>Asset</th><th>From</th><th>To</th><th>Approved by</th><th>Requested by</th><th>When</th><th>Details</th><th></th></tr></thead><tbody>
   {items.map(item=><tr key={item.kind+item.id}><td>{item.kind==='transfer'?'Express transfer':'New asset'}</td><td>{item.reference}</td><td>{item.door}</td><td>{item.from||'—'}</td><td>{item.to}</td><td>{item.approvedBy||'—'}</td><td>{item.requestedBy||'—'}</td><td>{item.at?new Date(item.at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'—'}</td><td>{item.kind==='equipment'?[item.make,item.model,item.registration,item.chassis].filter(Boolean).join(' · ')||'—':item.note||'—'}</td><td><button type="button" disabled={busy===item.kind+item.id} onClick={()=>void applied(item)}>Mark applied in Pulse</button></td></tr>)}
  </tbody></table></div>}
 </section>;
}
