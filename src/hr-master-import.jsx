// HR's all-sites Excel becomes the Employee Master (owner, 22 Nov 2026): choose the file, look at what would
// change, download the list, then apply. Nothing is written until Apply. The rules are in
// shared/hr-employee-master.mjs; the server reads the sheet again itself (server/routes/hr-master-import.mjs).
import React,{useEffect,useRef,useState} from 'react';
import {HR_MASTER_SHEET} from '../shared/hr-employee-master.mjs';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
import {downloadBlob} from './download-history.mjs';

const count=value=>Number(value||0).toLocaleString('en-IN');
const when=value=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const columns=labels=>labels.map(label=>({label}));
const cells=value=>value instanceof Date?value.toISOString().slice(0,10):value;

// The Excel of everything Apply would change, one sheet per kind of change.
export function hrMasterChangeSheets(preview){
 const {summary:s,lists:l}=preview;
 const people=(rows,extra=[])=>rows.map(row=>[row.employeeId,row.name,row.site,row.designation,row.status,...extra.map(key=>row[key])]);
 const head=['Employee ID','Name','Site in Pulse-II today','Designation','Status in Pulse-II today'];
 return [
  {name:'Summary',title:"HR's master against Employee Master: what Apply will change",columns:columns(['Site','On HR\'s list','New to Pulse-II','Site changed to this site','HR marks LEFT','Listed here today, not on HR\'s list']),
   rows:[...s.sites.map(row=>[row.site,row.listed,row.added,row.siteChanged,row.left,row.notListed]),['All sites',s.lines,s.added,s.siteChanged,s.left,s.notListedAtSites]],highlightedRows:new Set([s.sites.length])},
  {name:'Site changed',title:"Site taken from HR's master",columns:columns([...head,'Site after Apply']),rows:people(l.siteChanged,['to'])},
  {name:'Site kept',title:"HR's site differs, but the site held in Pulse-II is kept",columns:columns([...head,'Site in HR\'s master','Why kept']),rows:people(l.siteKept,['hrSite','reason'])},
  {name:'New people',title:"On HR's list, not in Pulse-II today",columns:columns(['Employee ID','Name','Site','Designation','Status in HR\'s master']),rows:l.added.map(row=>[row.employeeId,row.name,row.site,row.designation,row.status])},
  {name:'Name changed',title:"Name taken from HR's master",columns:columns([...head,'Name after Apply']),rows:people(l.nameChanged,['to'])},
  {name:'Working again',title:"Marked Resigned or Left in Pulse-II today, working on HR's list",columns:columns([...head,'Resigned on (Pulse-II)']),rows:people(l.workingAgain,['resignedOn'])},
  {name:'HR marks LEFT',title:"HR marks LEFT: kept in the list, never matched on a card",columns:columns(head),rows:people(l.left)},
  {name:"Not on HR's list",title:"Not on HR's list: kept in the list, never matched on a card",columns:columns(head),rows:people(l.notListed)},
 ];
}

// locked: Apply is switched off until the owner allows it on Telegram (src/employee-master-door.jsx). Looking at the changes stays open.
export default function HrMasterImport({session,onApplied,locked=false}){
 const [owner,setOwner]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [preview,setPreview]=useState(null),[problems,setProblems]=useState(null),[sure,setSure]=useState(false);
 const file=useRef(),sheet=useRef(null),leaveOut=useRef(false);
 const api=async(path,body)=>{
  const response=await fetch('/api/employee-master/hr-import'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error||"HR's master could not be read."),{data});
  return data;
 };
 useEffect(()=>{let live=true;api('').then(data=>{if(live)setOwner(data.owner||null);}).catch(()=>{});return()=>{live=false;};},[session.token]);
 // leaveOut: the lines that cannot be placed were shown and the administrator applies the rest; the people named on them stay as they are.
 const look=async(applySites)=>{
  setBusy('Reading the changes…');setError('');setProblems(null);setSure(false);
  try{setPreview(await api('/preview',{...sheet.current,applySites,leaveOutProblemLines:leaveOut.current}));}
  catch(e){setPreview(null);setError(e.message);if(e.data?.problems)setProblems(e.data);}
  finally{setBusy('');}
 };
 const choose=async event=>{
  const chosen=event.target.files?.[0];event.target.value='';if(!chosen)return;
  setBusy('Reading the Excel…');setError('');setNotice('');setPreview(null);setProblems(null);
  try{
   const {default:readXlsxFile,readSheetNames}=await import('read-excel-file');
   const names=await readSheetNames(chosen);
   if(!names.includes(HR_MASTER_SHEET))throw Error(`This Excel has no sheet named "${HR_MASTER_SHEET}". Choose HR's all-sites master.`);
   const rows=(await readXlsxFile(chosen,{sheet:HR_MASTER_SHEET})).map(row=>row.map(cells));
   sheet.current={rows,fileName:chosen.name};leaveOut.current=false;
  }catch(e){setBusy('');setError(e.message);return;}
  await look(false);
 };
 const apply=async()=>{
  setBusy('Applying HR\'s master…');setError('');
  try{
   const result=await api('/apply',{...sheet.current,applySites:preview.applySites,planKey:preview.planKey,leaveOutProblemLines:leaveOut.current});
   setOwner(result.owner);setPreview(null);setSure(false);sheet.current=null;
   setNotice(`HR's master applied: ${count(result.summary.updated)} updated, ${count(result.summary.added)} added, ${count(result.summary.notListed)} marked as not on HR's list.`);
   await onApplied?.();
  }catch(e){setError(e.message);setSure(false);}
  finally{setBusy('');}
 };
 const download=()=>downloadBlob(buildXlsxSheetsWorkbook("HR's master: changes to Employee Master",hrMasterChangeSheets(preview)),`HR-master-changes-${new Date().toISOString().slice(0,10)}.xlsx`,{title:"HR's master: changes to Employee Master"});
 const s=preview?.summary;
 return <section className="hr-master-import" aria-label="HR master import">
  <header><div><strong>HR's master Excel</strong>
   <p>{owner?`Employee Master is kept from HR's master since ${when(owner.since)}. Last file: ${owner.fileName||'not named'}, ${count(owner.lines)} lines, applied ${when(owner.lastImportAt)} by ${owner.by||'an administrator'}.`:"The copy from Oracle / ERP is switched off: Employee Master changes only in Pulse-II. HR's master is not applied yet. Choose HR's Excel, look at the changes and apply it to make it the Employee Master."}</p></div>
   <button type="button" onClick={()=>file.current.click()} disabled={Boolean(busy)}>Choose HR's master Excel</button></header>
  <input hidden type="file" ref={file} accept=".xlsx" onChange={choose}/>
  {busy&&<p role="status">{busy}</p>}
  {error&&<p className="employee-error" role="alert">{error}</p>}
  {notice&&<p role="status" className="hr-master-done">{notice}</p>}
  {problems&&<div className="hr-master-problems"><p>{count(problems.problemCount)} of {count(problems.lines)} lines cannot be placed{problems.problemCount>problems.problems.length?` (the first ${count(problems.problems.length)} are shown)`:''}.</p>
   <table><thead><tr><th>Line in the sheet</th><th>Employee ID</th><th>Name</th><th>Site</th><th>What to correct</th></tr></thead>
   <tbody>{problems.problems.map((row,index)=><tr key={row.line+'-'+index}><td>{row.line}</td><td>{row.employeeId}</td><td>{row.name}</td><td>{row.site}</td><td>{row.problem}</td></tr>)}</tbody></table>
   <div className="employee-actions"><button type="button" disabled={Boolean(busy)} onClick={()=>{leaveOut.current=true;void look(false);}}>Apply the rest without these lines</button><small>The people named on these lines stay exactly as they are in Pulse-II until HR corrects the file.</small></div></div>}
  {s&&<div className="hr-master-preview">
   <p><strong>{sheet.current?.fileName}</strong> · {count(s.lines)} people on HR's list. Nothing is changed yet.</p>
   <table><thead><tr><th>Site</th><th>On HR's list</th><th>New to Pulse-II</th><th>Site changed to this site</th><th>HR marks LEFT</th><th>Listed here today, not on HR's list</th></tr></thead>
   <tbody>{s.sites.map(row=><tr key={row.site}><td>{row.site}</td><td>{count(row.listed)}</td><td>{count(row.added)}</td><td>{count(row.siteChanged)}</td><td>{count(row.left)}</td><td>{count(row.notListed)}</td></tr>)}
   <tr className="hr-master-total"><td>All sites</td><td>{count(s.lines)}</td><td>{count(s.added)}</td><td>{count(s.siteChanged)}</td><td>{count(s.left)}</td><td>{count(s.notListedAtSites)}</td></tr></tbody></table>
   <ul>
    <li><strong>{count(s.updated)}</strong> employees take HR's details ({count(s.unchanged)} already the same), <strong>{count(s.added)}</strong> are added.</li>
    <li><strong>{count(s.siteChanged)}</strong> take HR's site{s.siteKept?<>; <strong>{count(s.siteKept)}</strong> keep the site held in Pulse-II although HR's differs</>:null}.</li>
    <li><strong>{count(s.workingAgain)}</strong> marked Resigned today are working on HR's list; <strong>{count(s.nameChanged)}</strong> names change.</li>
    <li><strong>{count(s.notListed)}</strong> are not on HR's list ({count(s.notListedAtSites)} at these sites, {count(s.notListed-s.notListedAtSites)} elsewhere; {count(s.notListedResigned)} already Resigned). They and the <strong>{count(s.left)}</strong> HR marks LEFT stay in the list but can never be matched on a card.</li>
    {s.sitesNotInFile.map(row=><li key={row.site}><strong>{row.site}</strong> has no line in HR's file: its {count(row.people)} people are left as they are.</li>)}
    {preview.leftOut?.lines>0&&<li><strong>{count(preview.leftOut.lines)}</strong> line(s) of the file cannot be placed and are left out ({preview.leftOut.problems.slice(0,6).map(row=>row.employeeId).filter((id,index,all)=>all.indexOf(id)===index).join(', ')}). The <strong>{count(s.leftAsIsPeople)}</strong> people named on them stay exactly as they are.</li>}
    <li>The {count(s.dummyKept)} dummy IDs stay usable. Nobody is deleted.</li>
   </ul>
   {!preview.first&&<label className="hr-master-sites"><input type="checkbox" checked={preview.applySites} disabled={Boolean(busy)} onChange={event=>look(event.target.checked)}/> Also take HR's site for the people whose site differs</label>}
   <div className="employee-actions">
    <button type="button" onClick={download} disabled={Boolean(busy)}>Download the list of changes (Excel)</button>
    {!sure?<button type="button" onClick={()=>setSure(true)} disabled={Boolean(busy)||locked} title={locked?'Switched off: employees are changed only in HR Pulse.':undefined}>Apply to Employee Master</button>
     :<><button type="button" className="hr-master-apply" onClick={apply} disabled={Boolean(busy)}>Yes, apply HR's master now</button><button type="button" onClick={()=>setSure(false)} disabled={Boolean(busy)}>Not now</button></>}
   </div>
  </div>}
 </section>;
}
