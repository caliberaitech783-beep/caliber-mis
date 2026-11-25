// Attendance Sheet Mismatch (owner, 23 Nov 2026): Reports > Manpower & OT, the tab beside Attendance Month-wise.
// Drivers and operators only: their biometric punches are set beside trip card attendance (saved trip cards, log books and
// zero-trip entries) of the same dates. Staff and other users keep no log book, so no mismatch is shown for them; they are
// only counted. The punches are those Pulse-II already has: the site machines' punches from HR Pulse (machine direct) and
// the device files imported on Attendance Management. A device file can still be uploaded here for a machine that is
// not connected. The mismatches are shown on screen and come back as an Excel. Nothing is changed in Pulse-II.
// The rules are in shared/trip-biometric-check.mjs, the runs in src/trip-biometric-run.mjs, the server reads in
// server/routes/attendance-sheet-check.mjs.
import React,{useEffect,useMemo,useState} from 'react';
import {Download,Upload,X} from 'lucide-react';
import {dmy} from '../shared/attendance-sheet-check.mjs';
import {FINDINGS,MAX_DAYS} from '../shared/trip-biometric-check.mjs';
import {readBiometricFile,runHeldBiometricCheck,runTripBiometricCheck,sheetApi,todayIst,SOURCE_CHOICES} from './trip-biometric-run.mjs';
import {downloadBlob} from './download-history.mjs';
import './attendance-sheet-check.css';

const many=(n,one,more=one+'s')=>n.toLocaleString('en-IN')+' '+(n===1?one:more);
const SHOW=500;
const dayBefore=date=>new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
// The month so far, up to yesterday (today's duties are still open).
function defaultRange(){
 const today=todayIst(),to=today.slice(8)==='01'?today:dayBefore(today);
 return {from:to.slice(0,8)+'01',to};
}
const spanDays=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;

export default function AttendanceSheetCheck({session}){
 const [sites,setSites]=useState({list:null,error:''});
 const [pick,setPick]=useState(()=>({...defaultRange(),site:'',source:'both'}));
 const [file,setFile]=useState({open:false,busy:false,name:'',bio:null,error:''});
 const [run,setRun]=useState({busy:false,error:'',done:null});
 const [view,setView]=useState({tab:'findings',type:'',q:''});
 const [drill,setDrill]=useState(null);
 useEffect(()=>{
  let live=true;
  sheetApi('/api/reports/manpower/attendance-sheet/sites',session).then(p=>{if(!live)return;setSites({list:p.sites||[],error:''});if(p.sites?.length===1)setPick(v=>({...v,site:p.sites[0]}));},e=>live&&setSites({list:[],error:e.message}));
  return()=>{live=false;};
 },[session.token]);
 const set=change=>{setPick(v=>({...v,...change}));setRun({busy:false,error:'',done:null});};
 const choose=async event=>{
  const picked=event.target.files?.[0];event.target.value='';if(!picked)return;
  setRun({busy:false,error:'',done:null});setFile(f=>({...f,busy:true,name:picked.name,bio:null,error:''}));
  try{const bio=await readBiometricFile(picked);setFile(f=>({...f,busy:false,name:picked.name,bio,error:''}));}
  catch(error){setFile(f=>({...f,busy:false,name:picked.name,bio:null,error:error.message}));}
 };
 const span=pick.from&&pick.to?spanDays(pick.from,pick.to):0;
 const rangeError=!pick.from||!pick.to?'Select From and To.':pick.to<pick.from?'To is before From.':span>MAX_DAYS?`Select up to ${MAX_DAYS} days.`:'';
 const useFile=Boolean(file.open&&file.bio);
 const ready=Boolean(pick.site&&!run.busy&&(useFile||!rangeError));
 const check=async()=>{
  setRun({busy:true,error:'',done:null});
  try{
   const done=useFile?await runTripBiometricCheck({bio:file.bio,fileName:file.name,site:pick.site,session})
    :await runHeldBiometricCheck({site:pick.site,from:pick.from,to:pick.to,source:pick.source,session});
   setRun({busy:false,error:'',done});setView({tab:'findings',type:'',q:''});
  }catch(error){setRun({busy:false,error:error.message,done:null});}
 };
 const done=run.done,result=done?.result,bioRead=done?.biometric;
 const q=view.q.trim().toLowerCase(),hit=r=>!q||[r.employeeId,r.employeeName||r.name,r.designation,r.doors,r.equipment].some(v=>String(v||'').toLowerCase().includes(q));
 const findings=useMemo(()=>result?result.findings.filter(f=>(!view.type||f.type===view.type)&&hit(f)):[],[result,view.type,q]);
 const people=useMemo(()=>result?result.perPerson.filter(hit):[],[result,q]);
 const personByCode=useMemo(()=>new Map((result?.perPerson||[]).map(p=>[p.caliberCode,p])),[result]);
 const openDrill=(person,scope='all')=>setDrill({person,scope});
 const drillRows=useMemo(()=>{
  if(!drill)return[];
  const rows=drill.person.details||[];
  if(drill.scope==='bioDays')return rows.filter(r=>r.biometric);
  if(drill.scope==='tripDays')return rows.filter(r=>r.logBook);
  if(drill.scope==='both')return rows.filter(r=>r.both);
  if(FINDINGS.some(f=>f.key===drill.scope))return rows.filter(r=>r.findingType===drill.scope);
  return rows;
 },[drill]);
 const drillTitle=drill?(FINDINGS.find(f=>f.key===drill.scope)?.label||({bioDays:'Biometric days',tripDays:'Log book days',both:'Days on both',all:'All attendance details'}[drill.scope])):'';
 return <div className="asc-page">
  <p className="asc-intro">Drivers and operators only: their biometric punches set beside their log book (saved VLB, ELB and LMV trip cards and zero-trip entries). Staff, supervisors, helpers, mechanics and other users keep no log book, so no mismatch is shown for them. The punches are those the site machines send to HR Pulse (machine direct) and the device files imported on Attendance Management. Nothing is changed in Pulse-II.</p>
  <div className="asc-filters">
   <label>From<input type="date" value={pick.from} max={pick.to||undefined} disabled={run.busy||useFile} onChange={e=>set({from:e.target.value})}/></label>
   <label>To<input type="date" value={pick.to} min={pick.from||undefined} disabled={run.busy||useFile} onChange={e=>set({to:e.target.value})}/></label>
   <label>Site<select value={pick.site} disabled={run.busy||!sites.list} onChange={e=>set({site:e.target.value})}>
    <option value="">{sites.list?'Select the site':'Reading your sites…'}</option>{(sites.list||[]).map(name=><option key={name} value={name}>{name}</option>)}
   </select></label>
   <label>Biometric source<select value={pick.source} disabled={run.busy||useFile} onChange={e=>set({source:e.target.value})}>
    {SOURCE_CHOICES.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
   </select></label>
   <div className="asc-actions">
    <button type="button" className="asc-run" disabled={!ready} onClick={check}>{run.busy?'Checking…':'Check'}</button>
    {result&&<button type="button" className="asc-run light" onClick={()=>downloadBlob(done.blob,done.name,{title:done.title})}><Download size={16}/>Download Excel</button>}
   </div>
  </div>
  {sites.error&&<p className="asc-error" role="alert">{sites.error}</p>}
  {sites.list&&!sites.list.length&&!sites.error&&<p className="asc-error" role="alert">No site is assigned to your login.</p>}
  {!useFile&&rangeError&&pick.site&&<p className="asc-hint">{rangeError}</p>}
  {!pick.site&&sites.list?.length>1&&<p className="asc-hint">Select the site.</p>}
  <details className="asc-file" open={file.open} onToggle={e=>setFile(f=>({...f,open:e.currentTarget.open}))}>
   <summary>Machine not connected? Upload its device file instead</summary>
   <div className="asc-file-body">
    <label className={'asc-upload'+(file.busy?' busy':'')}><Upload size={16}/>{file.busy?'Reading the file…':file.bio?'Choose another file':'Choose the biometric file'}<input type="file" accept=".dat,.txt,.csv,.xlsx,.xlsm" disabled={file.busy||run.busy} onChange={choose}/></label>
    {file.bio&&<p className="asc-note" role="status"><strong>{file.name}</strong> · {many(file.bio.punches,'punch','punches')} · {many(new Set(file.bio.days.map(d=>d.caliberCode)).size,'employee no.','employee nos.')}{file.bio.bad?` · ${many(file.bio.bad,'line')} not readable`:''}. Check now uses this file for the chosen site; close this box to use the punches Pulse-II holds.</p>}
    {file.error&&<p className="asc-error" role="alert">{file.name}: {file.error}</p>}
   </div>
  </details>
  {run.busy&&<p className="asc-note" role="status">Reading punches and trip card attendance of these dates. A full month takes up to a minute.</p>}
  {run.error&&<p className="asc-error" role="alert">{run.error}</p>}
  {bioRead&&<p className="asc-hint">Biometric read: {bioRead.machine.asked?(bioRead.machine.connected?`${many(bioRead.machine.punches,'machine punch','machine punches')} from HR Pulse`:'machine punches not read'):'machine punches not asked'}{bioRead.imported.asked?` · ${many(bioRead.imported.lines,'imported day')}`:''}.</p>}
  {bioRead?.machine.error&&<p className="asc-error" role="alert">{bioRead.machine.error} The imported punches are compared.</p>}
  {result&&<section className="asc-result" aria-label="Result of the check">
   <div className="asc-head"><h2>{result.site} · {dmy(result.from)} to {dmy(result.to)} · {many(result.totals.findings,'mismatch','mismatches')} for {many(result.totals.peopleWithFindings,'driver/operator','drivers/operators')}</h2></div>
   <div className="asc-kpis">
    <div><b>{result.totals.people}</b><span>Drivers &amp; operators</span></div>
    <div><b>{result.totals.bioDays.toLocaleString('en-IN')}</b><span>Days on biometric</span></div>
    <div><b>{result.totals.tripDays.toLocaleString('en-IN')}</b><span>Days on log book</span></div>
    <div><b>{result.totals.both.toLocaleString('en-IN')}</b><span>Days on both</span></div>
    {FINDINGS.map(f=><button type="button" key={f.key} className={'asc-kpi-'+f.key+(view.type===f.key?' on':'')} onClick={()=>setView(v=>({...v,tab:'findings',type:v.type===f.key?'':f.key}))}><b>{result.counts[f.key].toLocaleString('en-IN')}</b><span>{f.label}</span></button>)}
   </div>
   <p className="asc-skip">Not compared: <b>{many(result.otherStaff,'staff member or other user','staff members and other users')}</b> on the biometric (supervisors, helpers, mechanics, office staff): they keep no log book, so no mismatch is shown for them.{result.notInMaster.length?` ${many(result.notInMaster.length,'biometric no.','biometric nos.')} not in Employee Master: ${result.notInMaster.slice(0,20).join(', ')}${result.notInMaster.length>20?' …':''}.`:''} “No trip card” is judged only on the {many(result.totals.lockedDates,'date')} locked at this site.{done.range?.cut?' The file covers more than 31 days: only the first 31 are compared.':''}</p>
   <div className="asc-tabs" role="tablist">
    <button type="button" role="tab" aria-selected={view.tab==='findings'} className={view.tab==='findings'?'on':''} onClick={()=>setView(v=>({...v,tab:'findings'}))}>Mismatches ({findings.length.toLocaleString('en-IN')})</button>
    <button type="button" role="tab" aria-selected={view.tab==='people'} className={view.tab==='people'?'on':''} onClick={()=>setView(v=>({...v,tab:'people'}))}>Per driver / operator ({people.length})</button>
    <input aria-label="Search employee" placeholder="Search ID, name, designation, equipment…" value={view.q} onChange={e=>setView(v=>({...v,q:e.target.value}))}/>
   </div>
   <div className="asc-table">{view.tab==='findings'?<table><thead><tr><th>Date</th><th>Employee ID</th><th>Name</th><th>Designation</th><th>Mismatch</th><th>Bio source</th><th>Punch site</th><th>Bio IN</th><th>Bio OUT</th><th>Log book shift</th><th>Log book site</th><th>Equipment</th><th>Detail</th></tr></thead>
    <tbody>{findings.slice(0,SHOW).map(f=><tr key={f.id}><td>{dmy(f.date)}</td><td>{personByCode.has(f.caliberCode)?<button type="button" className="asc-drill-link" onClick={()=>openDrill(personByCode.get(f.caliberCode),f.type)}>{f.employeeId}</button>:f.employeeId}</td><td>{personByCode.has(f.caliberCode)?<button type="button" className="asc-drill-link" onClick={()=>openDrill(personByCode.get(f.caliberCode),f.type)}>{f.employeeName}</button>:f.employeeName}</td><td>{f.designation}</td><td><span className={'asc-tag asc-kpi-'+f.type}>{f.label}</span></td><td>{f.sourceLabel?<span className={'asc-src asc-src-'+f.source}>{f.sourceLabel}</span>:'—'}</td><td>{f.punchSite||'—'}</td><td>{f.inTime||'—'}</td><td>{f.outTime||'—'}</td><td>{f.tripShift||'—'}</td><td>{f.tripSite||'—'}</td><td>{f.doors||f.equipment||''}</td><td className="asc-wrap">{f.detail}</td></tr>)}
     {!findings.length&&<tr><td colSpan={13}>No mismatch here.</td></tr>}</tbody></table>
   :<table><thead><tr><th>Employee ID</th><th>Name</th><th>Designation</th><th>Biometric days</th><th>Log book days</th><th>Both</th>{FINDINGS.map(f=><th key={f.key}>{f.label}</th>)}</tr></thead>
    <tbody>{people.slice(0,SHOW).map(p=><tr key={p.caliberCode}><td><button type="button" className="asc-drill-link" onClick={()=>openDrill(p)}>{p.employeeId}</button></td><td><button type="button" className="asc-drill-link" onClick={()=>openDrill(p)}>{p.name}</button></td><td>{p.designation}</td><td><button type="button" className="asc-drill-link asc-drill-number" onClick={()=>openDrill(p,'bioDays')}>{p.bioDays}</button></td><td><button type="button" className="asc-drill-link asc-drill-number" onClick={()=>openDrill(p,'tripDays')}>{p.tripDays}</button></td><td><button type="button" className="asc-drill-link asc-drill-number" onClick={()=>openDrill(p,'both')}>{p.both}</button></td>{FINDINGS.map(f=><td key={f.key}>{p[f.key]?<button type="button" className="asc-drill-link asc-drill-number" onClick={()=>openDrill(p,f.key)}>{p[f.key]}</button>:''}</td>)}</tr>)}</tbody></table>}</div>
   {(view.tab==='findings'?findings:people).length>SHOW&&<p className="asc-hint">First {SHOW} lines shown; the Excel holds all.</p>}
  </section>}
  {drill&&<div className="asc-drill-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setDrill(null)}}><section className="asc-drill" role="dialog" aria-modal="true" aria-labelledby="asc-drill-title">
   <header><div><h2 id="asc-drill-title">{drill.person.employeeId} · {drill.person.name}</h2><p>{drill.person.designation} · {drillTitle} · {many(drillRows.length,'day')}</p></div><button type="button" aria-label="Close details" onClick={()=>setDrill(null)}><X size={20}/></button></header>
   <div className="asc-drill-table"><table><thead><tr><th>Date</th><th>Status</th><th>Bio source</th><th>Punch site</th><th>Bio IN</th><th>Bio OUT</th><th>Log book shift</th><th>Log book site</th><th>Equipment</th><th>Card / book</th><th>Detail</th></tr></thead><tbody>
    {drillRows.map(r=><tr key={r.date}><td>{dmy(r.date)}</td><td>{r.findingLabel?<span className={'asc-tag asc-kpi-'+r.findingType}>{r.findingLabel}</span>:r.both?'Matched':r.biometric?'Biometric only':r.logBook?'Log book only':'—'}</td><td>{r.sourceLabel||'—'}</td><td>{r.punchSite||'—'}</td><td>{r.inTime||'—'}</td><td>{r.outTime||'—'}</td><td>{r.shift||'—'}</td><td>{r.tripSite||'—'}</td><td>{r.equipment||'—'}</td><td>{r.books||'—'}</td><td className="asc-wrap">{r.detail||'—'}</td></tr>)}
    {!drillRows.length&&<tr><td colSpan={11}>No detail is available for this value.</td></tr>}
   </tbody></table></div>
  </section></div>}
 </div>;
}
