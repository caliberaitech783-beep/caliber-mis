import React,{useEffect,useState} from 'react';
import {employeeAtLocation} from '../shared/log-book-access.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {OPERATIONAL_START} from '../shared/operational-start.mjs';
import {bookShiftCode,selectedMasterShift,systemBookDate} from '../shared/trip-card-rules.mjs';
import {ZERO_TRIP_REASONS} from '../shared/zero-trip-reasons.mjs';
import SmartSelect from './smart-select.jsx';
import VtcTrainingPeople from './vtc-training-people.jsx';

// training: the VTC Training entry (shared/vtc-training.mjs), its own form beside "Present — 0 trips": From and To date,
// no shift, no machine, no zero-trip reason, where the training was held is required. Every day of it is saved as present
// in its own colour.
export default function ShiftAttendance({kind,session,batch,onClose,training=false}){
 const [options,setOptions]=useState(null),[error,setError]=useState(''),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false);
 const [site,setSite]=useState(batch?.site||''),[date,setDate]=useState(batch?.report_date||systemBookDate()),[toDate,setToDate]=useState(batch?.report_date||systemBookDate());
 const [shift,setShift]=useState(bookShiftCode(batch?.shift)||''),[employeeId,setEmployee]=useState(''),[assetId,setAsset]=useState(''),[trainees,setTrainees]=useState([]);
 const [reason,setReason]=useState(''),[remarks,setRemarks]=useState('');
 const headers={Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'};
 useEffect(()=>{
  const controller=new AbortController();
  fetch('/api/shift-attendance?kind='+kind,{headers:{Authorization:`Bearer ${session.token}`},signal:controller.signal}).then(async response=>{
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'Could not load attendance options.');
   setOptions(data);setSite(current=>current||data.accountLocation||'');
  }).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
  return ()=>controller.abort();
 },[kind,session.token]);
 const siteKey=canonicalSiteName(site);
 const shifts=['S1','S2','S3','D','N'].map(code=>({
  code,row:selectedMasterShift((options?.shifts||[]).filter(row=>(bookShiftCode(row.shiftCode)||bookShiftCode(row.name))===code),site,code,date)
 })).filter(({code,row})=>row||code==='D'||code==='N');
 const selectedShift=shifts.find(({code})=>code===shift);
 const ready=training?Boolean(date&&toDate&&toDate>=date&&trainees.length):Boolean(selectedShift);
 const submit=async event=>{
  event.preventDefault();if(!ready)return;setBusy(true);setError('');setSaved(false);
  try{
   const response=await fetch(training?'/api/training-attendance':'/api/shift-attendance',{method:'POST',headers,body:JSON.stringify(training
    ?{kind,location:site,fromDate:date,toDate,employeeIds:trainees,remarks}
    :{kind,location:site,bookDate:date,...(selectedShift.row?{shiftId:selectedShift.row.id}:{shiftCode:shift}),employeeId,assetId,reason,remarks})});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'Could not save attendance.');
   setSaved(training?data:true);
  }catch(error){setError(error.message);}finally{setBusy(false);}
 };
 const vehicle=kind==='vehicle';
 return <form className="logbook-section" onSubmit={submit} onChange={()=>setSaved(false)}>
  <div className="logbook-section-title"><h2>{training?'VTC Training':'Present — 0 trips'}</h2><button type="button" onClick={onClose} disabled={busy}>Close</button></div>
  {training&&<p className="vtc-training-note">Every {vehicle?'driver':'operator'} ticked below is marked present on every day from From date to To date as VTC Training (P, purple in attendance). It is not a 0-trip entry.</p>}
  {error&&<p role="alert">{error}</p>}
  {saved&&<p role="status">{training?`VTC Training saved: ${saved.people} ${saved.people===1?'person':'people'} present on ${saved.days} day${saved.days===1?'':'s'} (${saved.from} to ${saved.to}).`:'Attendance saved. Enter any later trips in the usual logbook.'}</p>}
  {!options&&!error&&<p role="status">Loading attendance options…</p>}
  {options&&<fieldset className="logbook-edit-fields" disabled={busy}>
   <div className="logbook-fields">
    <label className="logbook-field">Site<select required value={site} onChange={e=>{setSite(e.target.value);setShift('');setEmployee('');setAsset('');setTrainees([]);}}>
     <option value="">Select site</option>{[...new Set([...(site?[site]:[]),...options.sites])].map(value=><option key={value}>{value}</option>)}
    </select></label>
    {training?<>
    <label className="logbook-field">From date<input type="date" required min={OPERATIONAL_START} max={systemBookDate()} value={date} onChange={e=>{setDate(e.target.value);if(!toDate||toDate<e.target.value)setToDate(e.target.value);}}/></label>
    <label className="logbook-field">To date<input type="date" required min={date||OPERATIONAL_START} max={systemBookDate()} value={toDate} onChange={e=>setToDate(e.target.value)}/></label>
    </>:<>
    <label className="logbook-field">Book date<input type="date" required min={OPERATIONAL_START} value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label className="logbook-field">Shift<select required value={selectedShift?shift:''} onChange={e=>setShift(e.target.value)}>
     <option value="">Select shift</option>{shifts.map(({code,row})=><option key={code} value={code}>{row?(row.name||code)+' · '+row.startTime+'–'+row.endTime:code==='D'?'Day Shift':'Night Shift'}</option>)}
    </select></label>
    </>}
    {training?<VtcTrainingPeople label={vehicle?'Drivers':'Operators'} people={options.employees.filter(row=>employeeAtLocation(row,site))} chosen={trainees} onChange={list=>{setTrainees(list);setSaved(false);}}/>:
    <label className="logbook-field">{vehicle?'Driver':'Operator'}<SmartSelect searchable required aria-label={vehicle?'Driver':'Operator'} value={employeeId} onChange={e=>setEmployee(e.target.value)}>
     <option value="">Select employee</option>{options.employees.filter(row=>employeeAtLocation(row,site)).map(row=><option key={row.id} value={row.id}>{row.name} · {row.caliberId||row.employeeCode}</option>)}
    </SmartSelect></label>}
    {training?<label className="logbook-field">Training place / remarks (required)<input required maxLength={2000} placeholder="VTC, place and topic" value={remarks} onChange={e=>setRemarks(e.target.value)}/></label>:<>
    <label className="logbook-field">{vehicle?'Vehicle':'Equipment'} (optional)<select value={assetId} onChange={e=>setAsset(e.target.value)}>
     <option value="">Unassigned</option>{options.assets.filter(row=>row.kind===kind&&canonicalSiteName(row.site)===siteKey).map(row=><option key={row.id} value={row.id}>{row.door} · {row.name}</option>)}
    </select></label>
    <label className="logbook-field">Reason<select required value={reason} onChange={e=>setReason(e.target.value)}>
     <option value="">Select reason</option>{ZERO_TRIP_REASONS.map(value=><option key={value}>{value}</option>)}
    </select></label>
    <label className="logbook-field">Remarks {reason==='Other'?'(required)':'(optional)'}<input required={reason==='Other'} maxLength={2000} value={remarks} onChange={e=>setRemarks(e.target.value)}/></label>
    </>}
   </div>
   <button type="submit" disabled={!ready||Boolean(saved)}>{busy?'Saving…':training?'Save VTC Training':'Save attendance'}</button>
  </fieldset>}
 </form>;
}
