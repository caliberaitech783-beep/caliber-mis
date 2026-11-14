import {isJayantSite} from '../shared/site-shift-hours.mjs';
import React,{useState,useEffect} from 'react';
import PreviousElbEntries from './previous-elb-entries.jsx';
import WorkOrderJobSelect from './work-order-job-select.jsx';
import {activeWorkOrders} from '../shared/trip-card-rules.mjs';
import SmartSelect from './smart-select.jsx';
import {matchesSmartSearch} from '../shared/smart-search.mjs';
import {splitEquipmentOperatorHmr} from '../shared/surface-miner-hmr.mjs';
import {employeeAtLocation} from '../shared/log-book-access.mjs';

// Pure helpers shared with the batch page and the UI tests.
export const fleetHours=(opening,closing)=>{
 if(opening===''||closing===''||opening==null||closing==null)return null;
 const a=Number(opening),b=Number(closing);if(!Number.isFinite(a)||!Number.isFinite(b))return null;
 return Math.round((b-a)*100)/100;
};
export const fleetIdleHours=(shiftHours,workingHours,breakdownHours=0)=>{
 const shift=Number(shiftHours),working=Number(workingHours);
 if(!Number.isFinite(shift)||workingHours===null||!Number.isFinite(working))return null;
 return Math.round((shift-working-breakdownHours)*100)/100;
};
export const focusNextElbField=event=>{
 if(event.key!=='Enter'||event.shiftKey||event.isComposing)return;
 const fields=[...event.currentTarget.querySelectorAll('[data-elb-entry]:not([disabled])')],index=fields.indexOf(event.target);
 if(index<0||index===fields.length-1)return;
 event.preventDefault();fields[index+1].focus();
};
export const firstUnsavedIndex=(fleet=[])=>{
 let index=fleet.findIndex(row=>!row.saved_at&&!row.skipped&&!row.tripExempt);
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
  ...(Array.isArray(source.jobDetails)?{jobDetails:source.jobDetails}:{}),
  shiftStatus:'working',manualShift:source.manualShift||'',shiftHours:source.shiftHours??'',employeeId:text(source.employeeId),
  ...(source.operatorSplit?{secondOperatorId:text(source.operatorSplit.secondOperatorId),handoverHmr:text(source.operatorSplit.handoverHmr)}:{}),
  openingHmr:text(source.openingHmr),closingHmr:text(source.closingHmr),manualBreakdownHours:text(source.manualBreakdownHours),
  statusReason:text(source.statusReason),jobCardNo:text(source.jobCardNo),remark:text(source.remark),idleHours:text(source.idleHours??source.idleHoursEntered),
 };
};
// Walks the ELB fleet one machine at a time. Next saves through the fleet endpoint and moves on to
// the next unsaved machine. Pulse breakdowns are fetched for each selected machine.
const machineStatus=item=>item.saved_at?'Saved':item.tripExempt?'Trip-exempt':item.skipped?'Skipped':'Not saved';
const machineColumns=[
 {key:'door',label:'Machine no.',value:item=>item.door},
 {key:'equipment',label:'Equipment Master match',value:item=>item.equipmentName||'—'},
 {key:'trips',label:'VLB trips',value:item=>Number(item.trips)||0},
 {key:'status',label:'ELB status',value:item=>machineStatus(item)+(item.saved_at&&item.book_no?' · '+item.book_no:'')},
];
const machineCollator=new Intl.Collator('en-IN',{numeric:true,sensitivity:'base'});

export default function VlbFleetStepper({session,batch,options,onChanged,onDismiss,embedded=false,ExportMenu,canDeleteElb}){
 const [fleet,setFleet]=useState(()=>batch?.fleet||[]);
 const [index,setIndex]=useState(()=>firstUnsavedIndex(batch?.fleet||[]));
 const [form,setForm]=useState(()=>fleetDraftFields((batch?.fleet||[])[firstUnsavedIndex(batch?.fleet||[])]));
 const [dirty,setDirty]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');

 const row=fleet[index]||null;
 const jayantSite=isJayantSite({site:batch.site});
 const lookupShiftHours=Number(form.shiftHours)||8;
 const canEditSaved=batch?.canEditSavedFleet===true;
 const [activeTab,setActiveTab]=useState('working'),[pulseTick,setPulseTick]=useState(0),[pulseLookup,setPulseLookup]=useState({key:'',loading:false,data:null,error:''});
 const [reliefRequestKey,setReliefRequestKey]=useState('');
 const additional=Boolean(reliefRequestKey);
 const lookupKey=[batch?.id,row?.assetId,batch?.report_date,batch?.site,batch?.shift,form.manualShift||'',lookupShiftHours].join(':');
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
  const parameters=new URLSearchParams({manualShift:form.manualShift||'',...(!jayantSite?{shiftHours:lookupShiftHours}:{})});
  void api(`/api/vlb-batches/${batch.id}/fleet/${row.assetId}/breakdowns?${parameters}`,'GET',undefined,controller.signal).then(data=>{if(!cancelled){setPulseLookup({key:lookupKey,loading:false,data,error:''});if(jayantSite&&Number(data.shiftHours)>0)setForm(current=>({...current,shiftHours:Number(data.shiftHours)}));}}).catch(error=>{if(!cancelled)setPulseLookup({key:lookupKey,loading:false,data:null,error:error.message});});
  return()=>{cancelled=true;controller.abort();};
 },[lookupKey,pulseTick,session.token]);
 const pulse=pulseLookup.key===lookupKey?pulseLookup.data:null;
 const pulseLoading=pulseLookup.key!==lookupKey||pulseLookup.loading;
 const pulseError=pulseLookup.key===lookupKey?pulseLookup.error:'';
 const goTo=next=>{const target=fleet[next];if(!target||target.saved_at&&!canEditSaved)return;setReliefRequestKey('');setIndex(next);setEditingJobs(false);setForm(fleetDraftFields(target));setDirty(false);setError('');setNotice('')};
 const nextUnsaved=(list,from)=>{
  for(let step=1;step<=list.length;step++){const i=(from+step)%list.length;if(!list[i].saved_at&&!list[i].skipped&&!list[i].tripExempt)return i}
  for(let step=1;step<=list.length;step++){const i=(from+step)%list.length;if(!list[i].saved_at)return i}
  return -1;
 };
 const update=(key,value)=>{setForm(current=>({...current,[key]:value}));setDirty(true);setError('')};
 const next=async()=>{
  if(!row||busy||pulseLoading||!pulse||row.saved_at&&!canEditSaved&&!additional)return;
  if(operatorSplit?.error){setError(operatorSplit.error);return}
  setBusy(true);setError('');setNotice('');
  try{
   const result=await api(`/api/vlb-batches/${batch.id}/fleet/${row.assetId}`,'POST',{...form,...(jayantSite&&pulse?.shiftHours?{shiftHours:pulse.shiftHours}:{}),...(additional?{additionalCard:true}:{revision:row.logbook_revision}),idleHours:idleHours===null?'':String(idleHours),shiftStatus:'working',entryMode:'working-only',requestKey:reliefRequestKey||crypto.randomUUID()});
   const list=result.fleet||fleet.map(item=>item.assetId===row.assetId?{...item,saved_at:new Date().toISOString(),shift_status:form.shiftStatus,draft:null,skipped:false}:item);
   setFleet(list);setReliefRequestKey('');setDirty(false);onChanged?.(result);
   const target=nextUnsaved(list,list.findIndex(item=>item.assetId===row.assetId));
   if(target<0){setForm(fleetDraftFields(list.find(item=>item.assetId===row.assetId)));setNotice('Every machine in the fleet list is saved. Close this dialog and close the batch.');}
   else{const item=list[target];setIndex(target);setForm(fleetDraftFields(item))}
  }catch(e){setError(e.message)}finally{setBusy(false)}
 };
 const deleteSaved=async item=>{
  if(busy||dirty||!item.logbook_id||!window.confirm('Delete ELB '+item.book_no+' from this batch?'))return;
  setBusy(true);setError('');setNotice('');
  try{
   await api('/api/log-books/equipment/'+item.logbook_id,'DELETE',{revision:item.logbook_revision});
   const result=await api('/api/vlb-batches/'+batch.id+'/fleet','GET');
   setFleet(result.fleet);onChanged?.(result);
   if(row?.assetId===item.assetId)setForm(fleetDraftFields(result.fleet.find(machine=>machine.assetId===item.assetId)));
   setNotice('ELB '+item.book_no+' deleted.');
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
 const [machineQuery,setMachineQuery]=useState('');
 const [statusFilter,setStatusFilter]=useState('');
 const [machineSort,setMachineSort]=useState('');
 const [sortKey,direction]=machineSort.split(':');
 const sortColumn=machineColumns.find(column=>column.key===sortKey);
 const visibleMachines=embedded?fleet.map((item,itemIndex)=>({item,itemIndex})).filter(({item})=>
  (!statusFilter||machineStatus(item)===statusFilter)&&matchesSmartSearch(machineQuery,machineColumns.map(column=>column.value(item)))
 ):[];
 if(sortColumn)visibleMachines.sort((a,b)=>
  machineCollator.compare(sortColumn.value(a.item),sortColumn.value(b.item))*(direction==='desc'?-1:1)
 );
 const reportMachines=visibleMachines.map(({item})=>item);
 const machineReportTitle=['ELB Manual machines',batch?.name,batch?.site,batch?.report_date,batch?.shift].filter(Boolean).join(' · ');
 const [editingJobs,setEditingJobs]=useState(false);
 if(!row)return embedded?<section className="logbook-section vlb-fleet-stepper"><p>The fleet list for this batch is empty.</p></section>:<div className="logbook-dialog-backdrop"><div role="dialog" aria-modal="true" aria-label="Machine entry" className="logbook-dialog vlb-fleet-stepper"><div className="mis-popup-close-bar"><button type="button" className="mis-popup-close" onClick={dismiss}  aria-label="Close window">× Close</button></div><p>The fleet list for this batch is empty.</p><div className="vlb-batch-actions"><button type="button" onClick={dismiss}>Close dialog</button></div></div></div>;
 const trips=Number(row.trips)||0;
 const workingStatus=true;
 const operatorRequired=Number(row.trips)>0||fleetHours(form.openingHmr,form.closingHmr)!==0;
 const hours=fleetHours(form.openingHmr,form.closingHmr);
 const operatorSplit=form.secondOperatorId?splitEquipmentOperatorHmr(form):null;
 const idleHours=fleetIdleHours(lookupShiftHours,hours,pulse?.breakdownHours);
 const jobs=form.jobDetails||[];
 const contracts=activeWorkOrders(options?.workOrders||[],batch.site,batch.report_date);
 const employees=(options?.employees||[]).filter(employee=>employeeAtLocation(employee,batch?.site)).sort((a,b)=>String(a.name||a.employee||'').localeCompare(String(b.name||b.employee||'')));
 const machineEntry=<>{!embedded&&<div className="mis-popup-close-bar"><button type="button" className="mis-popup-close" onClick={dismiss} disabled={busy} aria-label="Close window">× Close</button></div>}
  <header className="vlb-fleet-stepper-header"><div><span className="logbook-eyebrow">Machine {index+1} of {fleet.length} · {saved} of {fleet.length} saved</span><h2 id="vlb-fleet-stepper-title">{!embedded&&<div className="mis-popup-close-bar"><button type="button" className="mis-popup-close" onClick={dismiss} disabled={busy} aria-label="Close window">× Close</button></div>}{row.door}{row.equipmentName?' · '+row.equipmentName:''}</h2><p>{embedded?<>{[batch.site,batch.report_date,batch.shift].filter(Boolean).join(' · ')} · {trips} VLB trip{trips===1?'':'s'} · {Number(row.sourceCards??row.source_cards)||0} source card{(Number(row.sourceCards??row.source_cards)||0)===1?'':'s'}</>:<>{trips} trip{trips===1?'':'s'} loaded · {Number(row.sourceCards??row.source_cards)||0} source card{(Number(row.sourceCards??row.source_cards)||0)===1?'':'s'}</>}{row.saved_at?' · Saved'+(row.book_no?' as '+row.book_no:''):row.skipped?' · Skipped':''}</p></div>{!embedded&&<button type="button" disabled={busy} onClick={dismiss}>Close dialog</button>}</header>
  {skipped.length>0&&<p className="vlb-fleet-skipped">Skipped: {skipped.map(item=>item.door).join(', ')}. Skipped machines with trips still need an ELB before closing.</p>}
  <nav className="vlb-status-buttons" role="tablist" aria-label="ELB entry tabs">
   <button type="button" id="elb-working-tab" role="tab" aria-selected={activeTab==='working'} aria-controls="elb-working-panel" onClick={()=>setActiveTab('working')}>Working</button>
   <button type="button" id="elb-breakdown-tab" role="tab" aria-selected={activeTab==='breakdowns'} aria-controls="elb-breakdown-panel" onClick={()=>setActiveTab('breakdowns')}>Breakdown details{pulse?' ('+(pulse.breakdowns?.length||0)+')':''}</button>
   <button type="button" id="elb-previous-tab" role="tab" aria-selected={activeTab==='previous'} aria-controls="elb-previous-panel" onClick={()=>setActiveTab('previous')}>Previous ELB entries</button>
  </nav>
  <p className="logbook-message">{batch.site} · {batch.report_date} · {batch.shift} · {row.door}</p>
  <div className="logbook-fields"><label className="logbook-field"><span>Shift</span><SmartSelect aria-label="Manual ELB Shift" disabled={busy||additional} value={form.manualShift||''} onChange={event=>{const manualShift=event.target.value;setForm(current=>({...current,manualShift,shiftHours:['day','night'].includes(manualShift)?12:(current.shiftHours||pulse?.shiftHours||8)}));setDirty(true);setError('');}}><option value="">Batch shift · {batch.shift}</option><option value="day">Day</option><option value="night">Night</option></SmartSelect></label><label className="logbook-field"><span>Shift Hrs</span><SmartSelect aria-label="Manual ELB Shift Hrs" disabled={busy||jayantSite||additional} value={lookupShiftHours} onChange={event=>update('shiftHours',Number(event.target.value))}>{jayantSite?<option value={lookupShiftHours}>{lookupShiftHours} Hrs</option>:<><option value={8}>8 Hrs</option><option value={12}>12 Hrs</option></>}</SmartSelect></label></div><p className="vlb-fleet-pulse-status" role="status">{pulseLoading?'Fetching breakdown hours from Pulse…':pulse?'Pulse breakdown hours loaded.':''}</p>
  {pulseError&&<p className="logbook-message error" role="alert">Pulse breakdown lookup failed: {pulseError} <button type="button" onClick={()=>setPulseTick(n=>n+1)}>Retry Pulse</button></p>}
  <div id="elb-working-panel" role="tabpanel" aria-labelledby="elb-working-tab" hidden={activeTab!=='working'}>
  <section className="logbook-section"><div className="logbook-fields vlb-fleet-fields" onKeyDown={focusNextElbField}>
   {workingStatus&&<label className="logbook-field"><span>Caliber ID{operatorRequired?' *':''}</span><SmartSelect data-elb-entry="operator" value={form.employeeId} disabled={busy} required={operatorRequired} onChange={e=>update('employeeId',e.target.value)}><option value="">Select Caliber ID</option>{employees.map(e=><option key={e.id} value={String(e.id)}>{(e.caliberId||e.employeeCode||'')+' · '+(e.name||e.employee||'')}</option>)}</SmartSelect></label>}
   <label className="logbook-field"><span>Opening HMR{workingStatus?' *':''}</span><input data-elb-entry="opening-hmr" type="number" inputMode="decimal" step="0.01" min="0" value={form.openingHmr} disabled={busy} onChange={e=>update('openingHmr',e.target.value)}/></label>
   <label className="logbook-field"><span>Closing HMR{workingStatus?' *':''}</span><input data-elb-entry="closing-hmr" type="number" inputMode="decimal" step="0.01" min="0" value={form.closingHmr} disabled={busy} onChange={e=>update('closingHmr',e.target.value)}/><small>{hours===null?'Hours: closing − opening HMR':'Hours: '+hours}</small></label>
   <label className="logbook-field"><span>Second operator (optional)</span>
    <SmartSelect data-elb-entry="second-operator" value={form.secondOperatorId||''} disabled={busy} onChange={event=>{
     const secondOperatorId=event.target.value;
     setForm(current=>({...current,secondOperatorId,handoverHmr:secondOperatorId?current.handoverHmr:''}));
     setDirty(true);setError('');
    }}>
     <option value="">Single operator</option>
     {employees.map(employee=><option key={employee.id} value={String(employee.id)}>{(employee.caliberId||employee.employeeCode||'')+' · '+(employee.name||employee.employee||'')}</option>)}
    </SmartSelect>
   </label>
   {operatorSplit&&<label className="logbook-field"><span>Handover HMR *</span>
    <input data-elb-entry="handover-hmr" type="number" inputMode="decimal" step="0.01" min="0" required value={form.handoverHmr||''} disabled={busy} onChange={event=>update('handoverHmr',event.target.value)}/>
    <small>Enter the meter reading when the second operator takes over.</small>
   </label>}
   {operatorSplit&&!operatorSplit.error&&<p className="logbook-message">First operator {operatorSplit.firstHours.toFixed(2)} h · Second operator {operatorSplit.secondHours.toFixed(2)} h · Combined HMR {operatorSplit.totalHours.toFixed(2)} h</p>}
   <label className="logbook-field"><span>HMR Difference</span><input type="text" aria-label="HMR Difference" readOnly value={hours===null?'':String(hours)}/><small>Closing HMR − Opening HMR</small></label>
   <label className="logbook-field"><span>Breakdown Hrs · from Pulse</span><output aria-label="Breakdown Hrs">{pulse?Number(pulse.breakdownHours).toFixed(3):'—'}</output><small>{pulse?(additional?'Equipment shift total, shared by both cards':'Same equipment, site, date and shift'):pulseLoading?'Fetching from Pulse…':'Pulse unavailable'}</small></label>
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
  <section id="elb-previous-panel" role="tabpanel" aria-labelledby="elb-previous-tab" hidden={activeTab!=='previous'} className="logbook-section">
   {activeTab==='previous'&&<PreviousElbEntries key={lookupKey} session={session} batch={batch} assetId={row.assetId} canDelete={canDeleteElb} onDeleted={async record=>{
    setBusy(true);setError('');
    try{
     const result=await api('/api/vlb-batches/'+batch.id+'/fleet','GET');
     setFleet(result.fleet);onChanged?.(result);
     if(!dirty&&String(record.id)===String(row.logbook_id))setForm(fleetDraftFields(result.fleet.find(machine=>machine.assetId===row.assetId)));
    }catch(e){setError(e.message)}finally{setBusy(false)}
   }}/>}
  </section>
  <section className="logbook-section">
   <div className="logbook-section-title"><h3>Equipment jobs</h3><button type="button" disabled={busy} onClick={()=>setEditingJobs(value=>!value)}>{editingJobs?'Done editing jobs':'Edit jobs'}</button></div>
   {jobs.map((job,i)=><div className="vlb-batch-actions" key={i}>
    <WorkOrderJobSelect row={job} contracts={contracts} label={'Equipment job '+(i+1)} disabled={!editingJobs||busy} onChange={value=>update('jobDetails',jobs.map((entry,n)=>n===i?{...entry,...value}:entry))}/>
    {editingJobs&&<button type="button" disabled={busy} onClick={()=>update('jobDetails',jobs.filter((_,n)=>n!==i))}>Remove job</button>}
   </div>)}
   {editingJobs&&<button type="button" disabled={busy||jobs.length>=300} onClick={()=>update('jobDetails',[...jobs,{}])}>Add job</button>}
  </section>
  <div className="vlb-batch-actions vlb-fleet-stepper-actions"><button type="button" disabled={busy||index<=0} onClick={previous}>Previous</button><button type="button" disabled={busy||!!row.saved_at} onClick={skip}>Skip</button><button type="button" className="vlb-approval-primary" disabled={busy||pulseLoading||!pulse||!!row.saved_at&&!canEditSaved&&!additional} onClick={next}>{busy?'Saving…':additional?'Save relief card':row.saved_at?'Save changes':'Next'}</button>{additional&&<button type="button" disabled={busy} onClick={()=>{setReliefRequestKey('');setForm(fleetDraftFields(row));setDirty(false);setError('')}}>Cancel relief card</button>}{dirty&&<span className="vlb-draft-indicator" role="status">{additional?'Relief card has unsaved changes':'Not saved · select Next to save this ELB'}</span>}</div>
  {error&&<p className="logbook-message error" role="alert">{error}</p>}
  {notice&&<p className="logbook-message success" role="status">{notice}</p>}
 </>;
 const machineRows=visibleMachines.map(({item,itemIndex})=><tr key={item.assetId} aria-selected={itemIndex===index}>{machineColumns.map(column=><td key={column.key}>{column.value(item)}</td>)}<td><button type="button" disabled={busy||dirty||!!item.saved_at&&!canEditSaved||itemIndex===index} onClick={()=>goTo(itemIndex)}>{item.saved_at?(canEditSaved?(itemIndex===index?'Editing':'Edit'):'Saved'):itemIndex===index?'Selected':'Enter ELB'}</button>{batch.stage==='elb_open'&&(batch.canEnterFleet||canEditSaved)&&item.saved_at&&<button type="button" disabled={busy||dirty} onClick={()=>{setIndex(itemIndex);setReliefRequestKey(crypto.randomUUID());setForm({...fleetDraftFields(),manualShift:item.logbook?.manualShift||'',shiftHours:item.logbook?.shiftHours??'',openingHmr:text(item.logbook?.closingHmr)});setError('');setNotice('')}}>Add relief card</button>}{batch.stage==='elb_open'&&(batch.canEnterFleet||canEditSaved)&&item.saved_at&&item.logbook_id&&<button type="button" disabled={busy||dirty} aria-label={'Delete ELB '+item.book_no} onClick={()=>deleteSaved(item)}>Delete ELB</button>}</td></tr>);
 const content=<div role={embedded?undefined:'dialog'} aria-modal={embedded?undefined:true} aria-labelledby="vlb-fleet-stepper-title" className={(embedded?'logbook-section embedded-vlb-fleet-stepper':'logbook-dialog')+' vlb-fleet-stepper'}>{embedded?<><section className="logbook-section vlb-fleet-machine-list"><div className="logbook-section-title"><h2>Site equipment</h2><span>{saved} of {fleet.length} saved · ELB is optional for machines with zero trips</span></div><div className="vlb-fleet-machine-toolbar"><label>Smart Search<input data-smart-search type="search" placeholder="Machine, equipment, trips or ELB book no." value={machineQuery} onChange={event=>setMachineQuery(event.target.value)}/></label><label>ELB status<select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="">All statuses</option>{['Not saved','Skipped','Saved','Trip-exempt'].map(status=><option key={status}>{status}</option>)}</select></label><label>Sort by<select value={machineSort} onChange={event=>setMachineSort(event.target.value)}><option value="">Batch order</option>{machineColumns.map(({key,label})=><optgroup key={key} label={label}><option value={key+':asc'}>{label} · {key==='trips'?'Lowest first':'A–Z'}</option><option value={key+':desc'}>{label} · {key==='trips'?'Highest first':'Z–A'}</option></optgroup>)}</select></label><button type="button" disabled={!machineQuery&&!statusFilter&&!machineSort} onClick={()=>{setMachineQuery('');setStatusFilter('');setMachineSort('')}}>Reset view</button>{ExportMenu&&visibleMachines.length>0&&<div className="vlb-fleet-machine-exports"><ExportMenu title={machineReportTitle} columns={machineColumns} rows={reportMachines}/></div>}</div><p className="vlb-fleet-machine-count" role="status">{visibleMachines.length} of {fleet.length} machines shown</p><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr>{machineColumns.map(({key,label})=><th key={key} scope="col" aria-sort={sortKey===key?(direction==='desc'?'descending':'ascending'):undefined}>{label}</th>)}<th scope="col">Action</th></tr></thead><tbody>{machineRows}{!visibleMachines.length&&<tr><td colSpan={machineColumns.length+1}>No machines match this search and status filter.</td></tr>}</tbody></table></div></section><section className="vlb-fleet-machine-editor" aria-labelledby="vlb-fleet-stepper-title">{machineEntry}</section></>:machineEntry}</div>;
 return embedded?content:<div className="logbook-dialog-backdrop">{content}</div>;
}
