import React,{useCallback,useEffect,useRef,useState} from 'react';
import TableSmartPrint from './table-smart-print.jsx';
import {createPortal} from 'react-dom';
import {startVisiblePoll} from './visible-poll.mjs';
import {MISMATCH_KINDS} from '../shared/equipment-pulse-mismatch.mjs';
import './equipment-pulse-mismatch.css';

const path='/api/reports/equipment-pulse-mismatch';
const stamp=value=>value?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)).replace(/\//g,'-').replace(',',''):'';
async function call(token,route='',method='GET',body){
 const response=await fetch(path+route,{method,cache:'no-store',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Object.assign(Error(data.error||'Could not read the equipment list check.'),{status:response.status});
 return data;
}
const machineName=machine=>machine.door||machine.registration||machine.chassis||'Unnamed machine';
const side=(site,group)=>site?site+(group?' · '+group:''):'Not there';

// Shown under the Equipment Deployment table: does this list agree with the Pulse equipment list?
export function EquipmentPulseMatch({session}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const load=useCallback(()=>call(session.token).then(result=>{setData(result);setError('')}).catch(e=>setError(e.message)),[session.token]);
 useEffect(()=>{setData(null);void load()},[load]);
 const check=async()=>{setBusy(true);setError('');setNotice('');try{const result=await call(session.token,'/check','POST');await load();setNotice(result.matches?'Checked now: both lists match.':'Checked now: '+result.machines+' machine'+(result.machines===1?'':'s')+' differ.')}catch(e){setError(e.message)}finally{setBusy(false)}};
 if(!data&&!error)return <section className="equipment-match" aria-busy="true"><p role="status">Loading the Pulse equipment list check…</p></section>;
 const run=data?.run,result=run?.result;
 return <section className="equipment-match" aria-label="Match with Pulse equipment list">
  <header>
   <div><h2>Match with Pulse equipment list</h2>
    <p>{data?.settings.enabled?'Checked automatically every '+data.settings.intervalHours+' hours.':'The automatic check is switched off.'} {run?'Last checked '+stamp(run.checkedAt)+'.':'Not checked yet.'}</p></div>
   {run&&<strong className={'equipment-match-state '+(run.matches?'is-match':'is-mismatch')}>{run.matches?'Matches Pulse':run.machineCount+' machine'+(run.machineCount===1?'':'s')+' differ'}</strong>}
   {data?.canCheck&&<button type="button" disabled={busy} onClick={check}>{busy?'Checking…':'Check now'}</button>}
  </header>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {data?.lastAttempt?.status==='failed'&&<p role="alert">The latest check ({stamp(data.lastAttempt.startedAt)}) could not read Pulse: {data.lastAttempt.error} The result below is from the check before it.</p>}
  {result&&<p className="equipment-match-totals">Pulse-II: <b>{result.pulseIITotal}</b> machines · Pulse: <b>{result.pulseTotal}</b> machines. Vehicles from Pulse's LMV Master are not part of this check.</p>}
  {result&&!run.matches&&<>
   {result.counts.length>0&&<div className="equipment-match-table"><h3>Where the counts differ</h3><TableSmartPrint row title="Equipment list check · Where the counts differ"/><table>
    <thead><tr><th>Equipment</th><th>Site</th><th>Pulse-II</th><th>Pulse</th><th>Difference</th></tr></thead>
    <tbody>{result.counts.map(row=><tr key={row.equipment+'|'+row.siteKey}><td>{row.equipment}</td><td>{row.site}</td><td>{row.pulseII}</td><td>{row.pulse}</td><td>{row.difference>0?'+'+row.difference:row.difference}</td></tr>)}</tbody>
   </table></div>}
   {result.machines.length>0&&<div className="equipment-match-table"><h3>Machines that differ</h3><TableSmartPrint row title="Equipment list check · Machines that differ"/><table>
    <thead><tr><th>Sr. No.</th><th>Machine</th><th>Make / model</th><th>What differs</th><th>In Pulse-II</th><th>In Pulse</th></tr></thead>
    <tbody>{result.machines.map((machine,index)=><tr key={index}><td>{index+1}</td><td>{machineName(machine)}</td><td>{[machine.make,machine.model].filter(Boolean).join(' ')}</td>
     <td>{MISMATCH_KINDS[machine.kind]||machine.label}</td><td>{side(machine.pulseIISite,machine.pulseIIGroup)}</td><td>{side(machine.pulseSite,machine.pulseGroup)}</td></tr>)}</tbody>
   </table></div>}
  </>}
 </section>;
}

// The pop-up notice. It returns after every scheduled check that still finds a difference.
export function EquipmentMismatchNotice({session,onOpen}){
 const token=session?.token;
 const [notice,setNotice]=useState(null),[saving,setSaving]=useState(false);
 const stopped=useRef(false);
 useEffect(()=>{
  if(!token)return undefined;
  stopped.current=false;let active=true;
  const stop=startVisiblePoll(async()=>{
   if(stopped.current)return;
   try{const result=await call(token,'/notice');if(active)setNotice(result.notice||null);}
   catch(error){if([401,403].includes(error.status))stopped.current=true;}
  },10*60000);
  return()=>{active=false;stop();};
 },[token]);
 if(!notice)return null;
 const close=async open=>{
  setSaving(true);
  try{await call(token,'/notice/seen','POST',{id:notice.id});}catch{/* The notice returns on the next check if this could not be saved. */}
  setSaving(false);setNotice(null);if(open)onOpen?.();
 };
 return createPortal(<div className="equipment-mismatch-backdrop"><section className="equipment-mismatch-notice" role="alertdialog" aria-modal="true" aria-labelledby="equipment-mismatch-title">
  <h2 id="equipment-mismatch-title">Equipment list does not match Pulse</h2>
  <p>Checked {stamp(notice.checkedAt)}. Pulse-II has <b>{notice.pulseIITotal}</b> machines, Pulse has <b>{notice.pulseTotal}</b>. <b>{notice.machineCount}</b> machine{notice.machineCount===1?'':'s'} differ.</p>
  <ul>{Object.entries(MISMATCH_KINDS).filter(([kind])=>notice.byKind?.[kind]).map(([kind,label])=><li key={kind}>{label}: <b>{notice.byKind[kind]}</b></li>)}</ul>
  {notice.machines.length>0&&<><TableSmartPrint row portalClassName="equipment-mismatch-print-layer" title={'Equipment list does not match Pulse · checked '+stamp(notice.checkedAt)}/><table><thead><tr><th>Machine</th><th>What differs</th><th>Pulse-II</th><th>Pulse</th></tr></thead>
   <tbody>{notice.machines.map((machine,index)=><tr key={index}><td>{machineName(machine)}</td><td>{MISMATCH_KINDS[machine.kind]}</td><td>{side(machine.pulseIISite,machine.pulseIIGroup)}</td><td>{side(machine.pulseSite,machine.pulseGroup)}</td></tr>)}</tbody></table></>}
  {notice.machineCount>notice.machines.length&&<p>…and {notice.machineCount-notice.machines.length} more in the full list.</p>}
  <p className="equipment-mismatch-repeat">This notice returns every {notice.intervalHours} hours until the two lists match.</p>
  <div className="equipment-mismatch-actions"><button type="button" disabled={saving} onClick={()=>close(true)}>Open full list</button><button type="button" disabled={saving} onClick={()=>close(false)}>OK</button></div>
 </section></div>,document.body);
}
