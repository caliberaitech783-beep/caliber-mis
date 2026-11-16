import {suggestedCaliberId} from '../shared/employee-identity.mjs';
import SmartSelect from './smart-select.jsx';
import React,{useEffect,useState,useRef} from 'react';
import {StepBackButton} from './step-back.jsx';
import {EMPLOYEE_FIELDS} from '../shared/employee-master-fields.mjs';
import './employee-master.css';
const labelGroups={Identity:['caliberId','caliberCode','employeeCode','name','employeeShortName','gender','dateOfBirth','fatherName','spouseName','maritalStatus','bloodGroup'],Employment:['departmentName','designationName','employeeGrade','currentDepartmentName','currentDesignationName','dateOfAppointment','dateOfJoining','shiftName','staffType','employeeType','locationName','currentLocation','currentStaffType','status','companyName','skills','workCentre','resignationStatus','resignationAcceptenceDate'],Contact:['presentAddress','presentCity','presentState','presentPhoneNo','permanentAddress','permanentCity','permanentState','officeMobileNo','officeEmailId','personalMobileNo','personalEmailId']};
export default function EmployeeMaster({session,ExportMenu,PrintButton,parseCsv,downloadEmployeeExcel}){
 const [data,setData]=useState({records:[],total:0,sites:[]}),[q,setQ]=useState(''),[site,setSite]=useState(''),[page,setPage]=useState(0),[selected,setSelected]=useState(null),[draft,setDraft]=useState(null),[tab,setTab]=useState('Identity'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[exportRows,setExportRows]=useState(null);const file=useRef(),profile=useRef();
 useEffect(()=>{if(selected||draft)profile.current?.scrollIntoView({behavior:'smooth',block:'start'});},[selected?.id,Boolean(draft)]);
 const api=async(path='',options={})=>{const r=await fetch('/api/employee-master'+path,{...options,headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'}});const b=await r.json();if(!r.ok)throw new Error(b.error||'Employee Master unavailable.');return b;};
 const query=`?q=${encodeURIComponent(q)}&site=${encodeURIComponent(site)}&page=${page}`;
 const load=async()=>{setError('');try{setData(await api(query));}catch(e){setError(e.message)}};
 useEffect(()=>{let live=true;setExportRows(null);const t=setTimeout(()=>api(query).then(d=>{if(live)setData(d)}).catch(e=>live&&setError(e.message)),250);return()=>{live=false;clearTimeout(t)}},[q,site,page,session.token]);
 const save=async e=>{e.preventDefault();setBusy(true);setError('');try{const r=await api(draft.id?'/'+draft.id:'',{method:draft.id?'PUT':'POST',body:JSON.stringify(draft)});setSelected(r);setDraft(null);setNotice('Employee saved. Login access is managed separately in Login Details.');await load()}catch(e){setError(e.message)}finally{setBusy(false)}};
 const importFile=async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;setBusy(true);try{const text=await f.text(),records=f.name.endsWith('.json')?JSON.parse(text):parseCsv(text,EMPLOYEE_FIELDS.map(([k,l])=>[k,l]));const r=await api('/import',{method:'POST',body:JSON.stringify({records})});setNotice(`${r.added} added · ${r.updated} updated by Employee ID`);await load()}catch(e){setError(e.message)}finally{setBusy(false)}};
 const current=draft||selected;const known=Object.values(labelGroups).flat();const visible=EMPLOYEE_FIELDS.filter(([k])=>tab==='Other details'?!known.includes(k):(labelGroups[tab]||[]).includes(k));const columns=EMPLOYEE_FIELDS.map(([key,label])=>({label,value:r=>r[key]??''}));
 const [exporting,setExporting]=useState(false);
 const exportExcel=async()=>{
  setExporting(true);
  setError('');
  try{
   const {records,total}=await api(query+'&export=1');
   if(!records.length) throw new Error('No employees match the current filters.');
   if(records.length<total) throw new Error(`This export is limited to ${records.length.toLocaleString('en-IN')} employees. Narrow your search or select a location.`);
   await downloadEmployeeExcel(columns,records);
  }catch(e){setError(e.message)}finally{setExporting(false)}
 };
 return <section className="employee-master"><header className="employee-master-hero"><div><small>MASTERS / EMPLOYEES</small><h1>Employee Master</h1><p>Employee profiles · Separate Employee ID and Caliber ID</p></div><div className="employee-actions"><button onClick={()=>{setDraft({});setSelected(null);setTab('Identity');}} disabled={busy}>New employee</button><button onClick={load}>Refresh</button><button onClick={()=>file.current.click()} disabled={busy}>Import CSV / JSON</button><button type="button" onClick={exportExcel} disabled={busy||exporting}>{exporting?'Exporting…':'Export to Excel'}</button><button onClick={async()=>{try{setBusy(true);setExportRows((await api(query+'&export=1')).records)}catch(e){setError(e.message)}finally{setBusy(false)}}} disabled={busy||exporting}>Prepare filtered export</button>{exportRows&&<ExportMenu title="Employee Master" columns={columns} rows={exportRows}/>}</div></header><input hidden type="file" ref={file} accept=".csv,.json" onChange={importFile}/>
 {error&&<p className="employee-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <div className="employee-search"><label>Search employees<input placeholder="Employee ID, Caliber ID, name or department" value={q} onChange={e=>{setQ(e.target.value);setPage(0)}}/></label><label>Location<SmartSelect value={site} onChange={e=>{setSite(e.target.value);setPage(0)}}><option value="">All locations</option>{data.sites.map(s=><option key={s}>{s}</option>)}</SmartSelect></label><strong>{data.total.toLocaleString('en-IN')} employees</strong></div>
 <div className="employee-register"><table><thead><tr>{['Employee ID','Caliber ID','Employee name','Department','Designation','Location','Status',''].map((h,i)=><th key={i}>{h}</th>)}</tr></thead><tbody>{data.records.map(r=><tr key={r.id}><td>{r.caliberId}</td><td>{r.caliberCode}</td><td>{r.name}</td><td>{r.currentDepartmentName||r.departmentName}</td><td>{r.currentDesignationName||r.designationName}</td><td>{r.site}</td><td>{r.status}</td><td><button onClick={()=>{setSelected(r);setDraft(null);setTab('Identity');}}>View details</button></td></tr>)}</tbody></table></div><div className="employee-pagination"><button disabled={!page||Boolean(draft)} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page+1} of {Math.max(1,Math.ceil(data.total/50))}</span><button disabled={(page+1)*50>=data.total||Boolean(draft)} onClick={()=>setPage(p=>p+1)}>Next</button></div>
 {current&&<section className="employee-profile" ref={profile}><header><div><h2>{current.name||'New employee'}</h2><p>Employee ID: <strong>{current.caliberId||'Enter Employee ID'}</strong> · Caliber ID: <strong>{current.caliberCode||suggestedCaliberId(current.caliberId)||'—'}</strong> · {current.currentDesignationName||current.designationName||''} · {current.site||''}</p></div><div className="employee-actions">{!draft&&<><button onClick={()=>setDraft({...selected})}>Edit employee</button><PrintButton title={'Employee Master — '+current.name} columns={[{label:'Field',value:r=>r.label},{label:'Details',value:r=>r.value}]} rows={EMPLOYEE_FIELDS.map(([key,label])=>({label,value:current[key]||'—'}))} smartPrintItem/></>}<StepBackButton onBack={()=>{setSelected(null);setDraft(null)}} label="Back to list"/></div></header><nav>{[...Object.keys(labelGroups),'Other details'].map(t=><button className={tab===t?'active':''} key={t} onClick={()=>setTab(t)}>{t}</button>)}</nav><form onSubmit={save}><div className="employee-fields">{visible.map(([key,label])=><label key={key}><span>{label}</span>{draft?<input value={draft[key]||''} onChange={e=>setDraft(d=>({...d,[key]:e.target.value,...(key==='caliberId'&&(!d.caliberCode||d.caliberCode===suggestedCaliberId(d.caliberId))?{caliberCode:suggestedCaliberId(e.target.value)}:{})}))} required={['caliberId','name'].includes(key)}/>:<output>{current[key]||'—'}</output>}</label>)}</div>{draft&&<footer><button disabled={busy} type="submit">{busy?'Saving…':'Save employee'}</button><button type="button" onClick={()=>setDraft(null)}>Cancel</button></footer>}</form></section>}
 </section>
}

export function EmployeeCurrentLocation({session}){
 const [employeeId,setEmployeeId]=useState(''),[employee,setEmployee]=useState(null),[location,setLocation]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function request(path,options){
   const response=await fetch('/api/employee-master/location'+path,{
     ...options,headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'}
   });
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||'Employee location unavailable.');
   return data;
 }
 async function search(event){
   event.preventDefault();
   setBusy(true);setError('');setNotice('');setEmployee(null);
   try{
     const result=await request('?employeeId='+encodeURIComponent(employeeId.trim()));
     setEmployee(result);setLocation(result.currentLocation);
   }catch(error){setError(error.message);}
   finally{setBusy(false);}
 }
 async function save(event){
   event.preventDefault();
   setBusy(true);setError('');setNotice('');
   try{
     const result=await request('/'+employee.id,{method:'PUT',body:JSON.stringify({currentLocation:location,revision:employee.revision})});
     setEmployee(result);setLocation(result.currentLocation);setNotice('Current Location saved.');
   }catch(error){setError(error.message);}
   finally{setBusy(false);}
 }
 return <section className="employee-master">
   <h1>Employee Current Location</h1>
   <form className="employee-search" onSubmit={search}>
     <label>Employee ID<input required maxLength={100} value={employeeId} disabled={busy} onChange={event=>{setEmployeeId(event.target.value);setEmployee(null);setNotice('');}}/></label>
     <button disabled={busy}>Find employee</button>
   </form>
   {error&&<p className="employee-error" role="alert">{error}</p>}
   {notice&&<p role="status">{notice}</p>}
   {employee&&<form className="employee-search" onSubmit={save}>
     <strong>{employee.name} ({employee.employeeId})</strong>
     <label>Current Location<input value={location} maxLength={4000} disabled={busy} onChange={event=>setLocation(event.target.value)}/></label>
     <button disabled={busy||location.trim()===employee.currentLocation}>Save Current Location</button>
   </form>}
 </section>;
}
