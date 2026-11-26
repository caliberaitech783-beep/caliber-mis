import React,{useEffect,useMemo,useState} from 'react';
import {Plus,Save,Trash2} from 'lucide-react';
import SmartSelect from './smart-select.jsx';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {employeeAtLocation} from '../shared/log-book-access.mjs';
import {matchingWorkOrders} from '../shared/trip-card-rules.mjs';
import {bookShiftCode} from '../shared/trip-card-rules.mjs';
import {DRILL_SHIFT_PERIODS,blankDrillBreakdown,drillJobMetrics,fixedDrillJobs,isDrillMachine} from '../shared/drill-log-book.mjs';
import './drill-log-book.css';

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const fresh=(batch=null,shiftId='')=>({batchId:batch?.id||'',location:batch?.site||'',bookDate:batch?.report_date||today(),assetId:'',workOrderId:batch?.work_order_id?String(batch.work_order_id):'',employeeId:'',shiftId,shiftPeriod:'day',drillCardNo:'',compressorOpening:'',compressorClosing:'',machineOpening:'',machineClosing:'',jobRows:fixedDrillJobs(),breakdowns:[blankDrillBreakdown(),blankDrillBreakdown()],requestKey:crypto.randomUUID()});
const delta=(a,b)=>a!==''&&b!==''&&Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Number(b)>=Number(a)?Math.round((Number(b)-Number(a))*1000)/1000:null;
const show=value=>value===null||value===undefined?'—':Number(value).toLocaleString('en-IN',{maximumFractionDigits:3});

function Field({label,children,wide=false}){return <label className={'dlb-field'+(wide?' wide':'')}><span>{label}</span>{children}</label>}

export default function DrillLogBook({session,onExit}){
 const [form,setForm]=useState(fresh),[batch,setBatch]=useState(null),[options,setOptions]=useState(null),[records,setRecords]=useState([]),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const api=async(url,config={})=>{const response=await fetch(url,{...config,headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json',...config.headers}});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'Could not reach the Drill Log Book service.');return body};
 const load=async()=>{setLoading(true);setError('');try{let batchId='';try{batchId=sessionStorage.getItem('vlb-entry-batch:'+String(session.login||session.name||''))||''}catch{}if(!batchId)throw new Error('Open the DLB stage from Create Batch before entering a Drill Log Book.');const [masters,saved,selected]=await Promise.all([api('/api/log-books/options'),api('/api/drill-log-books'),api('/api/vlb-batches/'+encodeURIComponent(batchId))]);if(selected.stage!=='dlb_open')throw new Error('This batch is not at the DLB stage. Lock LMV first, or return to Create Batch.');const shift=(masters.shifts||[]).find(row=>canonicalSiteName(row.site)===canonicalSiteName(selected.site)&&[row.shiftCode,row.shiftName,row.name].some(value=>bookShiftCode(value)===selected.shift));setBatch(selected);setOptions(masters);setRecords((saved.records||[]).filter(row=>row.data?.batchId===selected.id));setForm(fresh(selected,shift?String(shift.id):''));}catch(e){setError(e.message)}finally{setLoading(false)}};
 useEffect(()=>{void load()},[session.token]);
 const update=(key,value)=>{setNotice('');setForm(current=>({...current,[key]:value}))};
 const sameSite=row=>!form.location||canonicalSiteName(row.site)===canonicalSiteName(form.location);
 const rigs=useMemo(()=>(options?.assets||[]).filter(row=>isDrillMachine(row)&&sameSite(row)),[options,form.location]);
 const employees=useMemo(()=>(options?.employees||[]).filter(row=>!form.location||employeeAtLocation(row,form.location,form.bookDate)),[options,form.location,form.bookDate]);
 const shifts=useMemo(()=>(options?.shifts||[]).filter(sameSite),[options,form.location]);
 const workOrders=useMemo(()=>matchingWorkOrders(options?.workOrders||[],form.location,form.bookDate),[options,form.location,form.bookDate]);
 const compressorRunning=delta(form.compressorOpening,form.compressorClosing),machineRunning=delta(form.machineOpening,form.machineClosing);
 const jobMetrics=form.jobRows.map(row=>drillJobMetrics(row,compressorRunning));
 useEffect(()=>{setForm(current=>{const valid=rigs.some(row=>String(row.id)===String(current.assetId)),assetId=valid?current.assetId:rigs.length===1?rigs[0].id:'';return assetId===current.assetId?current:{...current,assetId};});},[form.location,rigs]);
 const changeRow=(list,index,key,value)=>setForm(current=>({...current,[list]:current[list].map((row,i)=>i===index?{...row,[key]:value}:row)}));
 const removeRow=(list,index)=>setForm(current=>({...current,[list]:current[list].filter((_,i)=>i!==index)}));
 const submit=async event=>{event.preventDefault();setSaving(true);setError('');setNotice('');try{const saved=await api('/api/drill-log-books',{method:'POST',body:JSON.stringify(form)});setRecords(current=>[saved,...current.filter(row=>row.id!==saved.id)]);setNotice(`Saved ${saved.book_no}.`);setForm(fresh(batch,form.shiftId));}catch(e){setError(e.message)}finally{setSaving(false)}};
 if(loading)return <section className="dlb-page"><p role="status">Loading Drill Log Book…</p></section>;
 return <section className="dlb-page">
  <header className="dlb-title"><div><h1>Drill Log Book</h1><p>{batch?`${batch.name} · DLB open`:'DLB manual entry'} · only drill machines assigned to the selected site are available.</p></div><div>{onExit&&<button type="button" onClick={onExit}>Back to batch</button>}<strong>Caliber Pulse-II · MIS Workspace</strong></div></header>
  {error&&<p className="dlb-message error" role="alert">{error}</p>}{notice&&<p className="dlb-message success" role="status">{notice}</p>}
  <form onSubmit={submit}>
   <div className="dlb-fields">
    <Field label="Location"><input readOnly value={form.location}/></Field>
    <Field label="Doc type"><input readOnly value="DLB"/></Field><Field label="Book date"><input required type="date" value={form.bookDate} onChange={e=>update('bookDate',e.target.value)}/></Field>
    <Field label="Book NO"><input readOnly value="AUTO"/></Field><Field label="Project name"><input readOnly value={form.location}/></Field>
    <Field label="Door NO"><SmartSelect searchable required value={form.assetId} onChange={e=>update('assetId',e.target.value)}><option value="">Select site drill machine</option>{rigs.map(row=><option key={row.id} value={row.id}>{row.door||row.name} · {row.name}</option>)}</SmartSelect><small>{form.location?rigs.length===1?'Fetched automatically from Equipment Master':`${rigs.length} drill machines fetched from Equipment Master for this site`:'Select location first'}</small></Field>
    <Field label="WO / Contract"><SmartSelect searchable value={form.workOrderId} onChange={e=>update('workOrderId',e.target.value)}><option value="">Select Work Order</option>{workOrders.map(row=><option key={row.id} value={row.id}>{row.number}</option>)}</SmartSelect></Field>
    <Field label="Employee ID"><SmartSelect searchable required value={form.employeeId} onChange={e=>update('employeeId',e.target.value)}><option value="">Select operator</option>{employees.map(row=><option key={row.id} value={row.id}>{row.caliberId} · {row.name}</option>)}</SmartSelect></Field>
    <Field label="Shift"><SmartSelect searchable required value={form.shiftId} onChange={e=>update('shiftId',e.target.value)}><option value="">Select batch shift</option>{shifts.filter(row=>[row.shiftCode,row.shiftName,row.name].some(value=>bookShiftCode(value)===batch?.shift)).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</SmartSelect></Field>
    <Field label="Shift Hrs"><select required value={form.shiftPeriod} onChange={e=>update('shiftPeriod',e.target.value)}>{DRILL_SHIFT_PERIODS.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select></Field>
    <Field label="Drill card NO"><input value={form.drillCardNo} onChange={e=>update('drillCardNo',e.target.value)}/></Field>
   </div>
   <h2>Detail - HMR readings</h2>
   <div className="dlb-meter-grid"><b></b><b>Opening reading</b><b>Closing reading</b><b>Running HMR</b>
    <strong>Compressor HMR</strong><input required type="number" step="0.001" value={form.compressorOpening} onChange={e=>update('compressorOpening',e.target.value)}/><input required type="number" step="0.001" value={form.compressorClosing} onChange={e=>update('compressorClosing',e.target.value)}/><output>{show(compressorRunning)}</output>
    <strong>Machine HMR</strong><input required type="number" step="0.001" value={form.machineOpening} onChange={e=>update('machineOpening',e.target.value)}/><input required type="number" step="0.001" value={form.machineClosing} onChange={e=>update('machineClosing',e.target.value)}/><output>{show(machineRunning)}</output>
   </div>
   <div className="dlb-section-title"><h2>Detail - drill job details</h2><small>Fixed job types for every DLB entry</small></div>
   <div className="dlb-table-wrap"><table className="dlb-job-table"><thead><tr><th>Job type</th><th>No. of holes</th><th>Length of hole</th><th>Total metrage</th><th>Holes/hr</th><th>Meter/hr</th></tr></thead><tbody>{form.jobRows.map((row,index)=><tr key={row.jobType}><td><strong>{index+1}. {row.jobType}</strong></td><td><input aria-label={`No. of holes ${row.jobType}`} type="number" min="0" step="1" value={row.holes} onChange={e=>changeRow('jobRows',index,'holes',e.target.value)}/></td><td><input aria-label={`Length of hole ${row.jobType}`} type="number" min="0" step="0.001" value={row.holeLength} onChange={e=>changeRow('jobRows',index,'holeLength',e.target.value)}/></td><td><output>{show(jobMetrics[index].totalMetrage)}</output></td><td><output>{show(jobMetrics[index].holesPerHour)}</output></td><td><output>{show(jobMetrics[index].metersPerHour)}</output></td></tr>)}</tbody></table></div>
   <p className="dlb-note">Holes/hr and Meter/hr are calculated using compressor running HMR. Machine running HMR must not exceed compressor running HMR.</p>
   <div className="dlb-section-title"><h2>Breakdown detail</h2><button type="button" onClick={()=>setForm(current=>({...current,breakdowns:[...current.breakdowns,blankDrillBreakdown()]}))}><Plus/> Add row</button></div>
   <div className="dlb-table-wrap"><table><thead><tr><th>Breakdown detail</th><th>Start time</th><th>End time</th><th>Action taken</th><th>Mechanic</th><th>TM execution</th><th>Remark</th><th></th></tr></thead><tbody>{form.breakdowns.map((row,index)=><tr key={index}>{[['detail','text'],['startTime','time'],['endTime','time'],['actionTaken','text'],['mechanic','text'],['tmExecution','text'],['remark','text']].map(([key,type])=><td key={key}><input aria-label={`${key} ${index+1}`} type={type} value={row[key]} onChange={e=>changeRow('breakdowns',index,key,e.target.value)}/></td>)}<td><button type="button" aria-label={`Remove breakdown row ${index+1}`} onClick={()=>removeRow('breakdowns',index)}><Trash2/></button></td></tr>)}</tbody></table></div>
   <div className="dlb-actions"><button className="primary" disabled={saving} type="submit"><Save/> {saving?'Saving…':'Save DLB'}</button></div>
  </form>
  <section className="dlb-saved"><h2>Saved Drill Log Books</h2>{records.length?<div className="dlb-table-wrap"><table><thead><tr><th>Book NO</th><th>Date</th><th>Location</th><th>Rig NO</th><th>Operator</th><th>Shift</th><th>Compressor HMR</th><th>Machine HMR</th></tr></thead><tbody>{records.map(row=><tr key={row.id}><td>{row.book_no}</td><td>{row.data.bookDate}</td><td>{row.data.location}</td><td>{row.data.rigNo}</td><td>{row.data.operatorName}</td><td>{row.data.shiftName}</td><td>{show(row.data.compressorRunning)}</td><td>{show(row.data.machineRunning)}</td></tr>)}</tbody></table></div>:<p>No DLB has been saved yet.</p>}</section>
 </section>
}
