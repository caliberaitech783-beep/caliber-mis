import React,{useEffect,useState} from 'react';
import VlbFleetStepper from './vlb-fleet-stepper.jsx';

export default function ElbBatchManual({session,batch,onExit}){
 const [options,setOptions]=useState(null),[current,setCurrent]=useState(batch),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();fetch('/api/log-books/options',{signal:controller.signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token}}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'Could not load ELB options.');return data}).then(data=>{if(!controller.signal.aborted)setOptions(data)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[session.token]);
 const changed=result=>setCurrent(value=>({...value,...Object.fromEntries(Object.entries(result||{}).filter(([key])=>key!=='record'))}));
 return <section className="elb-batch-manual" aria-label="ELB batch manual entry"><header className="logbook-page-header"><div><h1>ELB Manual · {current.name}</h1><p>{current.site} · {current.report_date} · {current.shift} · Select a machine, save its ELB and continue to the next unsaved machine.</p></div><button type="button" onClick={onExit}>Change batch</button></header>{error&&<p className="logbook-message error" role="alert">{error}</p>}{!options?<p role="status">Loading operators and ELB options…</p>:<VlbFleetStepper embedded session={session} batch={current} options={options} onChanged={changed} onDismiss={onExit}/>}</section>;
}
