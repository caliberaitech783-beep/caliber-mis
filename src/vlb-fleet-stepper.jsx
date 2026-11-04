import React,{useState,useEffect} from 'react';
import SmartSelect from './smart-select.jsx';

// Pure helpers shared with the batch page and the UI tests.
export const fleetHours=(opening,closing)=>{
 if(opening===''||closing===''||opening==null||closing==null)return null;
 const a=Number(opening),b=Number(closing);if(!Number.isFinite(a)||!Number.isFinite(b))return null;
 return Math.round((b-a)*100)/100;
};
export const fleetIdleHours=(shiftHours,workingHours)=>{
 const shift=Number(shiftHours),working=Number(workingHours);
 if(!Number.isFinite(shift)||workingHours===null||!Number.isFinite(working))return null;
 return Math.round((shift-working)*100)/100;
};
export const focusNextElbField=event=>{
 if(event.key!=='Enter'||event.shiftKey||event.isComposing)return;
 const fields=[...event.currentTarget.querySelectorAll('[data-elb-entry]:not([disabled])')],index=fields.indexOf(event.target);
 if(index<0||index===fields.length-1)return;
 event.preventDefault();fields[index+1].focus();
};
export const firstUnsavedIndex=(fleet=[])=>{
 let index=fleet.findIndex(row=>!row.saved_at&&!row.skipped);
 if(index<0)index=fleet.findIndex(row=>!row.saved_at);
 return index<0?0:index;
};
export const statusAllowsTrips=(key,rule)=>rule&&typeof rule.allowsTrips==='boolean'?rule.allowsTrips:String(key).startsWith('working');
export const tripsHint=(row,statuses={})=>{
 const trips=Number(row?.trips)||0;if(trips<=0)return '';
 const cards=Number(row?.sourceCards??row?.source_cards)||0;
 const working=Object.entries(statuses).filter(([key,rule])=>statusAllowsTrips(key,rule)).map(([,rule])=>rule.label).join(' or ');
 return `${row.door} loaded ${trips} trip${trips===1?'':'s'} on ${cards} tipper card${cards===1?'':'s'} this shift.${working?' Only '+working+' can be saved.':''}`;
};
const text=value=>value==null?'':String(value);
export const fleetDraftFields=(row={})=>{
 const source=row.logbook||{};
 return {
  shiftStatus:'working',employeeId:text(source.employeeId),
  openingHmr:text(source.openingHmr),closingHmr:text(source.closingHmr),manualBreakdownHours:text(source.manualBreakdownHours),
  statusReason:text(source.statusReason),jobCardNo:text(source.jobCardNo),remark:text(source.remark),idleHours:text(source.idleHours??source.idleHoursEntered),
 };
};
// Walks the ELB fleet one machine at a time. Next saves through the fleet endpoint and moves on to
// the next unsaved machine. Pulse breakdowns are fetched for each selected machine.
export default function VlbFleetStepper({session,batch,options,onChanged,onDismiss,embedded=false}){
 const [fleet,setFleet]=useState(()=>batch?.fleet||[]);
 const [index,setIndex]=useState(()=>firstUnsavedIndex(batch?.fleet||[]));
 const [form,setForm]=useState(()=>fleetDraftFields((batch?.fleet||[])[firstUnsavedIndex(batch?.fleet||[])]));
 const [dirty,setDirty]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');

 const row=fleet[index]||null;
 const [activeTab,setActiveTab]=useState('working'),[pulseTick,setPulseTick]=useState(0),[pulseLookup,setPulseLookup]=useState({key:'',loading:false,data:null,error:''});
 const lookupKey=[batch?.id,row?.assetId,batch?.report_date,batch?.site,batch?.shift].join(':');
 const api=async(url,method,body,signal)=>{
  const response=await fetch(url,{method,signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  let data={};try{data=await response.json()}catch{data={}}
  if(!response.ok)throw Error(data.error||`Machine entry failed (HTTP ${response.status}).`);
  return data;
 };
 useEffect(()=>{
  if(!row?.assetId||!batch?.id)return;
  const controller=new AbortController();let cancelled=false;
  setPulseLookup({key:lookupKey,loading:true,data:null,error:''});
  void api(`/api/vlb-batches/${batch.id}/fleet/${row.assetId}/breakdowns`,'GET',undefined,controller.signal).then(data=>{if(!cancelled)setPulseLookup({key:lookupKey,loading:false,data,error:''});}).catch(error=>{if(!cancelled)setPulseLookup({key:lookupKey,loading:false,data:null,error:error.message});});
  return()=>{cancelled=true;controller.abort();};
 },[lookupKey,pulseTick,session.token]);
 const pulse=pulseLookup.key===lookupKey?pulseLookup.data:null;
 const pulseLoading=pulseLookup.key!==lookupKey||pulseLookup.loading;
 const pulseError=pulseLookup.key===lookupKey?pulseLookup.error:'';
 const goTo=next=>{const target=fleet[next];if(!target||target.saved_at)return;setIndex(next);setForm(fleetDraftFields(target));setDirty(false);setError('');setNotice('')};
 const nextUnsaved=(list,from)=>{
  for(let step=1;step<=list.length;step++){const i=(from+step)%list.length;if(!list[i].saved_at&&!list[i].skipped)return i}
  for(let step=1;step<=list.length;step++){const i=(from+step)%list.length;if(!list[i].saved_at)return i}
  return -1;
 };
 const update=(key,value)=>{setForm(current=>({...current,[key]:value}));setDirty(true);setError('')};
 const next=async()=>{
  if(!row||busy||pulseLoading||!pulse)return;setBusy(true);setError('');setNotice('');
  try{
   const result=await api(`/api/vlb-batches/${batch.id}/fleet/${row.assetId}`,'POST',{...form,idleHours:idleHours===null?'':String(idleHours),shiftStatus:'working',entryMode:'working-only',requestKey:crypto.randomUUID()});
   const list=result.fleet||fleet.map(item=>item.assetId===row.assetId?{...item,saved_at:new Date().toISOString(),shift_status:form.shiftStatus,draft:null,skipped:false}:item);
   setFleet(list);setDirty(false);onChanged?.(result);
   const target=nextUnsaved(list,list.findIndex(item=>item.assetId===row.assetId));
   if(target<0)setNotice('Every machine in the fleet list is saved. Close this dialog and close the batch.');
   else{const item=list[target];setIndex(target);setForm(fleetDraftFields(item))}
  }catch(e){setError(e.message)}finally{setBusy(false)}
 };
 const previous=()=>{if(index<=0||busy)return;goTo(index-1)};
 const skip=async()=>{
  if(!row||busy)return;setBusy(true);
  try{await api(`/api/vlb-batches/${batch.id}/fleet/${row.assetId}/draft`,'PUT',{draft:{skipped:true}})}catch(e){setError(e.message);setBusy(false);return}
  const list=fleet.map(item=>item.assetId===row.assetId?{...item,skipped:true}:item);setFleet(list);
  const target=nextUnsaved(list,index);setBusy(false);
  if(target>=0)goTo(target);else setNotice('No other machine is waiting. Return to the skipped machines before closing the batch.');
 };
 const dismiss=()=>onDismiss?.();
 const saved=fleet.filter(item=>item.saved_at).length,skipped=fleet.filter(item=>item.skipped&&!item.saved_at);
 if(!row)return embedded?<section className="logbook-section vlb-fleet-stepper"><p>The fleet list for this batch is empty.</p></section>:<div className="logbook-dialog-backdrop"><div role="dialog" aria-modal="true" aria-label="Machine entry" className="logbook-dialog vlb-fleet-stepper"><div className="mis-popup-close-bar"><button type="button" className="mis-popup-close" onClick={dismiss}  aria-label="Close window">× Close</button></div><p>The fleet list for this batch is empty.</p><div className="vlb-batch-actions"><button type="button" onClick={dismiss}>Close dialog</button></div></div></div>;
 const trips=Number(row.trips)||0;
 const workingStatus=true;
 const operatorRequired=Number(row.trips)>0||fleetHours(form.openingHmr,form.closingHmr)!==0;
 const hours=fleetHours(form.openingHmr,form.closingHmr);
 const idleHours=fleetIdleHours(pulse?.shiftHours,hours);
 const employees=(options?.employees||[]).slice().sort((a,b)=>String(a.name||a.employee||'').localeCompare(String(b.name||b.employee||'')));
 const content=<div role={embedded?undefined:'dialog'} aria-modal={embedded?undefined:true} aria-labelledby="vlb-fleet-stepper-title" className={(embedded?'logbook-section embedded-vlb-fleet-stepper':'logbook-dialog')+' vlb-fleet-stepper'}>{!embedded&&<div className="mis-popup-close-bar"><button type="button" className="mis-popup-close" onClick={dismiss} disabled={busy} aria-label="Close window">× Close</button></div>}
  {embedded&&<section className="logbook-section vlb-fleet-machine-list"><div className="logbook-section-title"><h2>Machines from VLB summaries</h2><span>{saved} of {fleet.length} saved · Unique machines matched with Equipment Master</span></div><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Machine no.</th><th>Equipment Master match</th><th>VLB trips</th><th>ELB status</th><th/></tr></thead><tbody>{fleet.map((item,itemIndex)=><tr key={item.assetId} aria-selected={itemIndex===index}><td>{item.door}</td><td>{item.equipmentName||'—'}</td><td>{Number(item.trips)||0}</td><td>{item.saved_at?'Saved'+(item.book_no?' · '+item.book_no:''):item.skipped?'Skipped':'Not saved'}</td><td><button type="button" disabled={busy||dirty||!!item.saved_at||itemIndex===index} onClick={()=>goTo(itemIndex)}>{item.saved_at?'Saved':itemIndex===index?'Selected':'Enter ELB'}</button></td></tr>)}</tbody></table></div></section>}
  <header className="vlb-fleet-stepper-header"><div><span className="logbook-eyebrow">Machine {index+1} of {fleet.length} · {saved} of {fleet.length} saved</span><h2 id="vlb-fleet-stepper-title">{!embedded&&<div className="mis-popup-close-bar"><button type="button" className="mis-popup-close" onClick={dismiss} disabled={busy} aria-label="Close window">× Close</button></div>}{row.door}{row.equipmentName?' · '+row.equipmentName:''}</h2><p>{embedded?<>{[batch.site,batch.report_date,batch.shift].filter(Boolean).join(' · ')} · {trips} VLB trip{trips===1?'':'s'} · {Number(row.sourceCards??row.source_cards)||0} source card{(Number(row.sourceCards??row.source_cards)||0)===1?'':'s'}</>:<>{trips} trip{trips===1?'':'s'} loaded · {Number(row.sourceCards??row.source_cards)||0} source card{(Number(row.sourceCards??row.source_cards)||0)===1?'':'s'}</>}{row.saved_at?' · Saved'+(row.book_no?' as '+row.book_no:''):row.skipped?' · Skipped':''}</p></div>{!embedded&&<button type="button" disabled={busy} onClick={dismiss}>Close dialog</button>}</header>
  {skipped.length>0&&<p className="vlb-fleet-skipped">Skipped: {skipped.map(item=>item.door).join(', ')}. Complete them before closing the batch.</p>}
  <nav className="vlb-status-buttons" role="tablist" aria-label="ELB entry tabs">
   <button type="button" id="elb-working-tab" role="tab" aria-selected={activeTab==='working'} aria-controls="elb-working-panel" onClick={()=>setActiveTab('working')}>Working</button>
   <button type="button" id="elb-breakdown-tab" role="tab" aria-selected={activeTab==='breakdowns'} aria-controls="elb-breakdown-panel" onClick={()=>setActiveTab('breakdowns')}>Breakdown details{pulse?' ('+(pulse.breakdowns?.length||0)+')':''}</button>
  </nav>
  <p className="logbook-message">{batch.site} · {batch.report_date} · {batch.shift} · {row.door}</p>
  {pulseLoading&&<p role="status">Fetching breakdown hours from Pulse…</p>}
  {pulseError&&<p className="logbook-message error" role="alert">Pulse breakdown lookup failed: {pulseError} <button type="button" onClick={()=>setPulseTick(n=>n+1)}>Retry Pulse</button></p>}
  <div id="elb-working-panel" role="tabpanel" aria-labelledby="elb-working-tab" hidden={activeTab!=='working'}>
  <section className="logbook-section"><div className="logbook-fields vlb-fleet-fields" onKeyDown={focusNextElbField}>
   {workingStatus&&<label className="logbook-field"><span>Operator{operatorRequired?' *':''}</span><SmartSelect data-elb-entry="operator" value={form.employeeId} disabled={busy} required={operatorRequired} onChange={e=>update('employeeId',e.target.value)}><option value="">Select operator</option>{employees.map(e=><option key={e.id} value={String(e.id)}>{(e.name||e.employee||'')+(e.caliberId?' · '+e.caliberId:'')}</option>)}</SmartSelect></label>}
   <label className="logbook-field"><span>Opening HMR{workingStatus?' *':''}</span><input data-elb-entry="opening-hmr" type="number" inputMode="decimal" step="0.01" min="0" value={form.openingHmr} disabled={busy} onChange={e=>update('openingHmr',e.target.value)}/></label>
   <label className="logbook-field"><span>Closing HMR{workingStatus?' *':''}</span><input data-elb-entry="closing-hmr" type="number" inputMode="decimal" step="0.01" min="0" value={form.closingHmr} disabled={busy} onChange={e=>update('closingHmr',e.target.value)}/><small>{hours===null?'Hours: closing − opening HMR':'Hours: '+hours}</small></label>
   <label className="logbook-field"><span>HMR Difference</span><input type="text" aria-label="HMR Difference" readOnly value={hours===null?'':String(hours)}/><small>Closing HMR − Opening HMR</small></label>
   <label className="logbook-field"><span>Breakdown Hrs · from Pulse</span><output aria-label="Breakdown Hrs">{pulse?Number(pulse.breakdownHours).toFixed(3):'—'}</output><small>{pulse?'Same equipment, site, date and shift':pulseLoading?'Fetching from Pulse…':'Pulse unavailable'}</small></label>
   <label className="logbook-field"><span>Idle hours</span><input type="number" inputMode="decimal" readOnly value={idleHours===null?'':String(idleHours)}/></label>
   <label className="logbook-field"><span>Remark{['breakdown','working_partial_breakdown'].includes(form.shiftStatus)?' *':''}</span><input data-elb-entry="remark" type="text" value={form.statusReason} disabled={busy} onChange={e=>update('statusReason',e.target.value)}/></label>
   <label className="logbook-field"><span>Job card no.</span><input data-elb-entry="job-card" type="text" value={form.jobCardNo} disabled={busy} onChange={e=>update('jobCardNo',e.target.value)}/></label>
  </div></section>
  </div>
  <section id="elb-breakdown-panel" role="tabpanel" aria-labelledby="elb-breakdown-tab" hidden={activeTab!=='breakdowns'} className="logbook-section">
   <div className="logbook-section-title"><h3>Breakdown details · Pulse</h3><span>{pulse?'Total BD in shift: '+Number(pulse.breakdownHours).toFixed(3)+' h':''}</span></div>
   {pulse&&!(pulse.breakdowns||[]).length&&<p>No breakdown found for this equipment in the selected site, date and shift.</p>}
   {pulse&&(pulse.breakdowns||[]).length>0&&<div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Pulse reference</th><th>Breakdown description</th><th>Start · IST</th><th>End · IST</th><th>Status</th><th>Hours in shift</th></tr></thead><tbody>{pulse.breakdowns.map((event,i)=><tr key={(event.reference||'event')+':'+i}><td>{event.reference||'—'}</td><td>{event.description}</td><td>{new Date(event.start).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</td><td>{event.end?new Date(event.end).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'Ongoing'}</td><td>{event.status}</td><td>{Number(event.hours).toFixed(3)}</td></tr>)}</tbody></table></div>}
   {pulse&&<p><small>Only time within this shift is counted. Overlapping events are counted once in the total. Source: pulse.cmll.in · Updated {new Date(pulse.fetchedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</small> <button type="button" disabled={busy||pulseLoading} onClick={()=>setPulseTick(n=>n+1)}>Refresh Pulse</button></p>}
  </section>
  <div className="vlb-batch-actions vlb-fleet-stepper-actions"><button type="button" disabled={busy||index<=0} onClick={previous}>Previous</button><button type="button" disabled={busy} onClick={skip}>Skip</button><button type="button" className="vlb-approval-primary" disabled={busy||pulseLoading||!pulse} onClick={next}>{busy?'Saving…':'Next'}</button>{dirty&&<span className="vlb-draft-indicator" role="status">Not saved · select Next to save this ELB</span>}</div>
  {error&&<p className="logbook-message error" role="alert">{error}</p>}
  {notice&&<p className="logbook-message success" role="status">{notice}</p>}
 </div>;
 return embedded?content:<div className="logbook-dialog-backdrop">{content}</div>;
}
