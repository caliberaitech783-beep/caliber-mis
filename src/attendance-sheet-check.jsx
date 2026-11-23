// Attendance Sheet Mismatch (owner, 23 Nov 2026): Reports > Manpower & OT, the tab beside Attendance Month-wise.
// Drivers and operators only: the biometric log of a site (the device's attlog .dat, or its Excel/CSV export) is set
// beside trip card attendance (saved trip cards, log books and zero-trip entries) of the same dates. The mismatches are
// shown on screen and come back as an Excel. The file is read and compared in the browser and nothing is saved in Pulse-II.
// The rules are in shared/trip-biometric-check.mjs, the reading and the run in src/trip-biometric-run.mjs; the two small
// server reads (sites, Employee Master) in server/routes/attendance-sheet-check.mjs.
import React,{useEffect,useMemo,useState} from 'react';
import {Download,Upload} from 'lucide-react';
import {dmy} from '../shared/attendance-sheet-check.mjs';
import {FINDINGS} from '../shared/trip-biometric-check.mjs';
import {readBiometricFile,runTripBiometricCheck,sheetApi} from './trip-biometric-run.mjs';
import {downloadBlob} from './download-history.mjs';
import './attendance-sheet-check.css';

const many=(n,one,more=one+'s')=>n.toLocaleString('en-IN')+' '+(n===1?one:more);
const SHOW=500;

export default function AttendanceSheetCheck({session}){
 const [sites,setSites]=useState({list:null,error:''}),[site,setSite]=useState('');
 const [file,setFile]=useState({busy:false,name:'',bio:null,error:''});
 const [run,setRun]=useState({busy:false,error:'',done:null});
 const [view,setView]=useState({tab:'findings',type:'',q:''});
 useEffect(()=>{
  let live=true;
  sheetApi('/api/reports/manpower/attendance-sheet/sites',session).then(p=>{if(!live)return;setSites({list:p.sites||[],error:''});if(p.sites?.length===1)setSite(p.sites[0]);},e=>live&&setSites({list:[],error:e.message}));
  return()=>{live=false;};
 },[session.token]);
 const choose=async event=>{
  const picked=event.target.files?.[0];event.target.value='';if(!picked)return;
  setRun({busy:false,error:'',done:null});setFile({busy:true,name:picked.name,bio:null,error:''});
  try{setFile({busy:false,name:picked.name,bio:await readBiometricFile(picked),error:''});}
  catch(error){setFile({busy:false,name:picked.name,bio:null,error:error.message});}
 };
 const check=async()=>{
  setRun({busy:true,error:'',done:null});
  try{setRun({busy:false,error:'',done:await runTripBiometricCheck({bio:file.bio,fileName:file.name,site,session})});setView({tab:'findings',type:'',q:''});}
  catch(error){setRun({busy:false,error:error.message,done:null});}
 };
 const bio=file.bio,ready=Boolean(bio&&site&&!run.busy);
 const done=run.done,result=done?.result;
 const dates=bio?[...new Set(bio.days.map(d=>d.date))].sort():[];
 const q=view.q.trim().toLowerCase(),hit=r=>!q||[r.employeeId,r.employeeName||r.name,r.designation].some(v=>String(v||'').toLowerCase().includes(q));
 const findings=useMemo(()=>result?result.findings.filter(f=>(!view.type||f.type===view.type)&&hit(f)):[],[result,view.type,q]);
 const people=useMemo(()=>result?result.perPerson.filter(hit):[],[result,q]);
 return <div className="asc-page">
  <p className="asc-intro">Drivers and operators only. Upload the biometric log of the site (the device's attlog .dat file, or its Excel/CSV export), choose the site and press Check. Pulse-II links each biometric number to Employee Master (17817 is CMLL17817), keeps the drivers and operators, and sets each day beside the trip cards, log books and zero-trip entries of that date. The mismatches are shown below and come back as an Excel. Nothing is changed in Pulse-II.</p>
  <div className="asc-steps">
   <section className="asc-step"><h2>1 · Biometric log of the site</h2>
    <label className={'asc-upload'+(file.busy?' busy':'')}><Upload size={16}/>{file.busy?'Reading the file…':bio?'Choose another file':'Choose the biometric file'}<input type="file" accept=".dat,.txt,.csv,.xlsx,.xlsm" disabled={file.busy||run.busy} onChange={choose}/></label>
    {bio&&<p className="asc-note" role="status"><strong>{file.name}</strong> · {many(bio.punches,'punch','punches')}{bio.kind==='attlog'?` (${bio.ins.toLocaleString('en-IN')} IN · ${bio.outs.toLocaleString('en-IN')} OUT)`:''} · {many(new Set(bio.days.map(d=>d.caliberCode)).size,'employee no.','employee nos.')} · {dates.length?dmy(dates[0])+' to '+dmy(dates.at(-1)):''}{bio.bad?` · ${many(bio.bad,'line')} not readable`:''}</p>}
    {file.error&&<p className="asc-error" role="alert">{file.name}: {file.error}</p>}
   </section>
   <section className="asc-step"><h2>2 · Site of this device</h2>
    <select aria-label="Site of this biometric device" value={site} disabled={run.busy||!sites.list} onChange={e=>{setSite(e.target.value);setRun({busy:false,error:'',done:null});}}>
     <option value="">{sites.list?'Select the site':'Reading your sites…'}</option>{(sites.list||[]).map(name=><option key={name} value={name}>{name}</option>)}
    </select>
    {sites.error&&<p className="asc-error" role="alert">{sites.error}</p>}
    {sites.list&&!sites.list.length&&!sites.error&&<p className="asc-error" role="alert">No site is assigned to your login.</p>}
   </section>
   <section className="asc-step"><h2>3 · Check</h2>
    <button type="button" className="asc-run" disabled={!ready} onClick={check}>{run.busy?'Comparing with trip cards…':'Check trip cards vs biometric'}</button>
    {run.busy&&<p className="asc-note" role="status">Reading trip card attendance of these dates. A full month takes up to a minute.</p>}
    {!bio&&!file.busy&&<p className="asc-hint">Choose the biometric file first.</p>}{bio&&!site&&<p className="asc-hint">Select the site.</p>}
   </section>
  </div>
  {run.error&&<p className="asc-error" role="alert">{run.error}</p>}
  {result&&<section className="asc-result" aria-label="Result of the check">
   <div className="asc-head"><h2>{result.site} · {dmy(result.from)} to {dmy(result.to)} · {many(result.totals.findings,'mismatch','mismatches')} for {many(result.totals.peopleWithFindings,'driver/operator','drivers/operators')}</h2>
    <button type="button" className="asc-run" onClick={()=>downloadBlob(done.blob,done.name,{title:done.title})}><Download size={16}/>Download Excel</button></div>
   <div className="asc-kpis">
    <div><b>{result.totals.people}</b><span>Drivers &amp; operators</span></div>
    <div><b>{result.totals.bioDays.toLocaleString('en-IN')}</b><span>Days on biometric</span></div>
    <div><b>{result.totals.tripDays.toLocaleString('en-IN')}</b><span>Days on trip cards</span></div>
    <div><b>{result.totals.both.toLocaleString('en-IN')}</b><span>Days on both</span></div>
    {FINDINGS.map(f=><button type="button" key={f.key} className={'asc-kpi-'+f.key+(view.type===f.key?' on':'')} onClick={()=>setView(v=>({...v,tab:'findings',type:v.type===f.key?'':f.key}))}><b>{result.counts[f.key].toLocaleString('en-IN')}</b><span>{f.label}</span></button>)}
   </div>
   <p className="asc-hint">Not compared: {many(result.otherStaff,'other staff member')} on the biometric (helpers, supervisors, mechanics, staff){result.notInMaster.length?` · ${many(result.notInMaster.length,'biometric no.','biometric nos.')} not in Employee Master (${result.notInMaster.join(', ')})`:''}. “No trip card” is judged only on the {many(result.totals.lockedDates,'date')} locked at this site.{done.range.cut?' The file covers more than 31 days: only the first 31 are compared.':''}</p>
   <div className="asc-tabs" role="tablist">
    <button type="button" role="tab" aria-selected={view.tab==='findings'} className={view.tab==='findings'?'on':''} onClick={()=>setView(v=>({...v,tab:'findings'}))}>Mismatches ({findings.length.toLocaleString('en-IN')})</button>
    <button type="button" role="tab" aria-selected={view.tab==='people'} className={view.tab==='people'?'on':''} onClick={()=>setView(v=>({...v,tab:'people'}))}>Per employee ({people.length})</button>
    <input aria-label="Search employee" placeholder="Search ID, name, designation…" value={view.q} onChange={e=>setView(v=>({...v,q:e.target.value}))}/>
   </div>
   <div className="asc-table">{view.tab==='findings'?<table><thead><tr><th>Date</th><th>Employee ID</th><th>Name</th><th>Designation</th><th>Mismatch</th><th>Bio IN</th><th>Bio OUT</th><th>Trip card shift</th><th>Trip card site</th><th>Equipment</th><th>Detail</th></tr></thead>
    <tbody>{findings.slice(0,SHOW).map(f=><tr key={f.id}><td>{dmy(f.date)}</td><td>{f.employeeId}</td><td>{f.employeeName}</td><td>{f.designation}</td><td><span className={'asc-tag asc-kpi-'+f.type}>{f.label}</span></td><td>{f.inTime||'—'}</td><td>{f.outTime||'—'}</td><td>{f.tripShift||'—'}</td><td>{f.tripSite||'—'}</td><td>{f.doors||f.equipment||''}</td><td className="asc-wrap">{f.detail}</td></tr>)}
     {!findings.length&&<tr><td colSpan={11}>No mismatch here.</td></tr>}</tbody></table>
   :<table><thead><tr><th>Employee ID</th><th>Name</th><th>Designation</th><th>Biometric days</th><th>Trip card days</th><th>Both</th>{FINDINGS.map(f=><th key={f.key}>{f.label}</th>)}</tr></thead>
    <tbody>{people.slice(0,SHOW).map(p=><tr key={p.caliberCode}><td>{p.employeeId}</td><td>{p.name}</td><td>{p.designation}</td><td>{p.bioDays}</td><td>{p.tripDays}</td><td>{p.both}</td>{FINDINGS.map(f=><td key={f.key}>{p[f.key]||''}</td>)}</tr>)}</tbody></table>}</div>
   {(view.tab==='findings'?findings:people).length>SHOW&&<p className="asc-hint">First {SHOW} lines shown; the Excel holds all.</p>}
  </section>}
 </div>;
}
