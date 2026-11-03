import React,{useState} from 'react';
import SmartSelect from './smart-select.jsx';

// Pure helpers shared with the batch page and the UI tests.
export const fleetHours=(opening,closing)=>{
 if(opening===''||closing===''||opening==null||closing==null)return null;
 const a=Number(opening),b=Number(closing);if(!Number.isFinite(a)||!Number.isFinite(b))return null;
 return Math.round((b-a)*100)/100;
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
  shiftStatus:text(source.shiftStatus||row.shift_status||row.shiftStatus||''),employeeId:text(source.employeeId),
  openingHmr:text(source.openingHmr),closingHmr:text(source.closingHmr),manualBreakdownHours:text(source.manualBreakdownHours),
  statusReason:text(source.statusReason),jobCardNo:text(source.jobCardNo),remark:text(source.remark),idleHours:text(source.idleHours??source.idleHoursEntered),
 };
};
// Walks the ELB fleet one machine at a time. Next saves through the fleet endpoint and moves on to
// the next unsaved machine; field changes are written to the draft row after a short pause.
export default function VlbFleetStepper({session,batch,options,onChanged,onDismiss,embedded=false}){
 const [fleet,setFleet]=useState(()=>batch?.fleet||[]);
 const [index,setIndex]=useState(()=>firstUnsavedIndex(batch?.fleet||[]));
 const [form,setForm]=useState(()=>fleetDraftFields((batch?.fleet||[])[firstUnsavedIndex(batch?.fleet||[])]));
 const [dirty,setDirty]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const statuses=batch?.statuses||{};
 const row=fleet[index]||null;
 const api=async(url,method,body)=>{
  const response=await fetch(url,{method,cache:'no-store',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  let data={};try{data=await response.json()}catch{data={}}
  if(!response.ok)throw Error(data.error||`Machine entry failed (HTTP ${response.status}).`);
  return data;
 };
 const goTo=next=>{const target=fleet[next];if(!target)return;setIndex(next);setForm(fleetDraftFields(target));setDirty(false);setError('');setNotice('')};
 const nextUnsaved=(list,from)=>{
  for(let step=1;step<=list.length;step++){const i=(from+step)%list.length;if(!list[i].saved_at&&!list[i].skipped)return i}
  for(let step=1;step<=list.length;step++){const i=(from+step)%list.length;if(!list[i].saved_at)return i}
  return -1;
 };
 const update=(key,value)=>{setForm(current=>({...current,[key]:value}));setDirty(true);setError('')};
 const next=async()=>{
  if(!row||busy)return;setBusy(true);setError('');setNotice('');
  try{
   const result=await api(`/api/vlb-batches/${batch.id}/fleet/${row.assetId}`,'POST',{...form,requestKey:crypto.randomUUID()});
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
 if(!row)return embedded?<section className="logbook-section vlb-fleet-stepper"><p>The fleet list for this batch is empty.</p></section>:<div className="logbook-dialog-backdrop"><div role="dialog" aria-modal="true" aria-label="Machine entry" className="logbook-dialog vlb-fleet-stepper"><p>The fleet list for this batch is empty.</p><div className="vlb-batch-actions"><button type="button" onClick={dismiss}>Close dialog</button></div></div></div>;
 const trips=Number(row.trips)||0,hint=tripsHint(row,statuses),rule=statuses[form.shiftStatus]||{};
 const workingStatus=statusAllowsTrips(form.shiftStatus,rule),partial=rule.needsBreakdown==='partial'||form.shiftStatus==='working_partial_breakdown';
 const hours=fleetHours(form.openingHmr,form.closingHmr);
 const employees=(options?.employees||[]).slice().sort((a,b)=>String(a.name||a.employee||'').localeCompare(String(b.name||b.employee||'')));
 const content=<div role={embedded?undefined:'dialog'} aria-modal={embedded?undefined:true} aria-labelledby="vlb-fleet-stepper-title" className={(embedded?'logbook-section embedded-vlb-fleet-stepper':'logbook-dialog')+' vlb-fleet-stepper'}>
  {embedded&&<section className="logbook-section vlb-fleet-machine-list"><div className="logbook-section-title"><h2>Batch machines</h2><span>{saved} of {fleet.length} saved · Select any machine to enter or review its ELB</span></div><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Door</th><th>Equipment</th><th>VLB trips</th><th>ELB status</th><th/></tr></thead><tbody>{fleet.map((item,itemIndex)=><tr key={item.assetId} aria-selected={itemIndex===index}><td>{item.door}</td><td>{item.equipmentName||'—'}</td><td>{Number(item.trips)||0}</td><td>{item.saved_at?'Saved'+(item.book_no?' · '+item.book_no:''):item.skipped?'Skipped':'Not saved'}</td><td><button type="button" disabled={busy||dirty||itemIndex===index} onClick={()=>goTo(itemIndex)}>{itemIndex===index?'Selected':'Enter ELB'}</button></td></tr>)}</tbody></table></div></section>}
  <header className="vlb-fleet-stepper-header"><div><span className="logbook-eyebrow">Machine {index+1} of {fleet.length} · {saved} of {fleet.length} saved</span><h2 id="vlb-fleet-stepper-title">{row.door}{row.equipmentName?' · '+row.equipmentName:''}</h2><p>{embedded?<>{[batch.site,batch.report_date,batch.shift].filter(Boolean).join(' · ')} · {trips} VLB trip{trips===1?'':'s'} · {Number(row.sourceCards??row.source_cards)||0} source card{(Number(row.sourceCards??row.source_cards)||0)===1?'':'s'}</>:<>{trips} trip{trips===1?'':'s'} loaded · {Number(row.sourceCards??row.source_cards)||0} source card{(Number(row.sourceCards??row.source_cards)||0)===1?'':'s'}</>}{row.saved_at?' · Saved'+(row.book_no?' as '+row.book_no:''):row.skipped?' · Skipped':''}</p></div>{!embedded&&<button type="button" disabled={busy} onClick={dismiss}>Close dialog</button>}</header>
  {skipped.length>0&&<p className="vlb-fleet-skipped">Skipped: {skipped.map(item=>item.door).join(', ')}. Complete them before closing the batch.</p>}
  <section className="logbook-section vlb-fleet-status"><div className="logbook-section-title"><h3>Shift status</h3><span>{hint||(trips===0?'Zero trips: Working needs closing HMR above opening HMR; otherwise choose the status that applies.':'')}</span></div>
   <div className="vlb-status-buttons" role="group" aria-label="Shift status">{Object.entries(statuses).map(([key,status])=>{const allowed=trips<=0||statusAllowsTrips(key,status);return <button key={key} type="button" aria-pressed={form.shiftStatus===key} disabled={busy||!allowed} title={allowed?undefined:hint} onClick={()=>update('shiftStatus',key)}>{status.label||key}</button>})}</div>
  </section>
  <section className="logbook-section"><div className="logbook-fields vlb-fleet-fields">
   {workingStatus&&<label className="logbook-field"><span>Operator *</span><SmartSelect value={form.employeeId} disabled={busy} required onChange={e=>update('employeeId',e.target.value)}><option value="">Select operator</option>{employees.map(e=><option key={e.id} value={String(e.id)}>{(e.name||e.employee||'')+(e.caliberId?' · '+e.caliberId:'')}</option>)}</SmartSelect></label>}
   <label className="logbook-field"><span>Opening HMR{workingStatus?' *':''}</span><input type="number" inputMode="decimal" step="0.01" min="0" value={form.openingHmr} disabled={busy} onChange={e=>update('openingHmr',e.target.value)}/></label>
   <label className="logbook-field"><span>Closing HMR{workingStatus?' *':''}</span><input type="number" inputMode="decimal" step="0.01" min="0" value={form.closingHmr} disabled={busy} onChange={e=>update('closingHmr',e.target.value)}/><small>{hours===null?'Hours: closing − opening HMR':'Hours: '+hours}</small></label>
   {partial&&<label className="logbook-field"><span>Breakdown hours *</span><input type="number" inputMode="decimal" step="0.25" min="0" value={form.manualBreakdownHours} disabled={busy} onChange={e=>update('manualBreakdownHours',e.target.value)}/></label>}
   <label className="logbook-field"><span>Idle hours</span><input type="number" inputMode="decimal" step="0.25" min="0" value={form.idleHours} disabled={busy} onChange={e=>update('idleHours',e.target.value)}/></label>
   <label className="logbook-field"><span>Status reason{['breakdown','working_partial_breakdown'].includes(form.shiftStatus)?' *':''}</span><input type="text" value={form.statusReason} disabled={busy} onChange={e=>update('statusReason',e.target.value)}/></label>
   <label className="logbook-field"><span>Job card no.</span><input type="text" value={form.jobCardNo} disabled={busy} onChange={e=>update('jobCardNo',e.target.value)}/></label>
   <label className="logbook-field wide"><span>Remark</span><input type="text" value={form.remark} disabled={busy} onChange={e=>update('remark',e.target.value)}/></label>
  </div></section>
  <div className="vlb-batch-actions vlb-fleet-stepper-actions"><button type="button" disabled={busy||index<=0} onClick={previous}>Previous</button><button type="button" disabled={busy} onClick={skip}>Skip</button><button type="button" className="vlb-approval-primary" disabled={busy||!form.shiftStatus} onClick={next}>{busy?'Saving…':'Next'}</button>{dirty&&<span className="vlb-draft-indicator" role="status">Not saved · select Next to save this ELB</span>}</div>
  {error&&<p className="logbook-message error" role="alert">{error}</p>}
  {notice&&<p className="logbook-message success" role="status">{notice}</p>}
 </div>;
 return embedded?content:<div className="logbook-dialog-backdrop">{content}</div>;
}
