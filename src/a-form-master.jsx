// A Form Master (owner, 23 Nov 2026): the three linked columns A Form no. · CMLL id · Site.
// HR's Excel is chosen, the changes are shown with nothing written, then applied; one line can also be typed or
// removed here. The rules are in shared/a-form-master.mjs and the server reads the sheet again itself
// (server/routes/a-form-master.mjs). A scanned card and a biometric file both read these lines.
import React,{useEffect,useRef,useState} from 'react';
import {REGION_DATA} from '../shared/region-scope.mjs';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
import {downloadBlob} from './download-history.mjs';
import './employee-master.css';

const count=value=>Number(value||0).toLocaleString('en-IN');
const cells=value=>value instanceof Date?value.toISOString().slice(0,10):value;
const SITES=REGION_DATA.flatMap(({sites})=>sites);
const STATE_HELP={
 'Linked':'Used on scanned cards and biometric files.',
 'No A Form no.':'HR has not given an A Form no. for this person.',
 'A Form no. is on two people':'The same A Form no. is written against two people of this site, so it cannot name either of them. Correct one line.',
 'Not in Employee Master':'This CMLL id is not on the Employee Master list, so the line is not used.',
};
const stateHelp=state=>STATE_HELP[state]||'The line is used only at the site Employee Master holds for this person.';

// The Excel of the lines on screen: the three columns first, then who Employee Master says it is.
export function aFormMasterSheets(lines){
 const columns=['A Form no.','CMLL id','Site','Name (Employee Master)','Designation (Employee Master)','Link'].map(label=>({label}));
 return [{name:'A Form Master',title:'A Form Master: A Form no., CMLL id and site',columns,rows:lines.map(line=>[line.aFormNo,line.employeeId,line.site,line.name,line.designation,line.state])}];
}

export default function AFormMaster({session}){
 const [data,setData]=useState({lines:[],total:0,page:0,pageSize:100,sites:[],counts:null}),[q,setQ]=useState(''),[site,setSite]=useState(''),[only,setOnly]=useState(''),[page,setPage]=useState(0);
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[preview,setPreview]=useState(null),[sure,setSure]=useState(false),[reload,setReload]=useState(0);
 const [line,setLine]=useState({aFormNo:'',employeeId:'',site:''});
 const file=useRef(),sheet=useRef(null);
 const api=async(path,{method='GET',body}={})=>{
  const response=await fetch('/api/employee-master/a-form'+path,{method,headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(payload.error||'A Form Master is unavailable.'),{payload});
  return payload;
 };
 const query=extra=>'?'+new URLSearchParams({q,site,only,page:String(page),...extra});
 useEffect(()=>{let live=true;const timer=setTimeout(()=>api(query()).then(result=>{if(live)setData(result);}).catch(e=>{if(live)setError(e.message);}),250);return()=>{live=false;clearTimeout(timer);};},[q,site,only,page,reload,session.token]);
 const choose=async event=>{
  const chosen=event.target.files?.[0];event.target.value='';if(!chosen)return;
  setBusy('Reading the Excel…');setError('');setNotice('');setPreview(null);setSure(false);
  try{
   const {default:readXlsxFile}=await import('read-excel-file');
   const rows=(await readXlsxFile(chosen)).map(row=>row.map(cells));
   sheet.current={rows,fileName:chosen.name};
   setPreview(await api('/preview',{method:'POST',body:sheet.current}));
  }catch(e){setError(e.message);}
  finally{setBusy('');}
 };
 const apply=async()=>{
  setBusy('Applying the A Form Excel…');setError('');
  try{
   const result=await api('/apply',{method:'POST',body:{...sheet.current,planKey:preview.planKey}});
   setNotice(`A Form Master updated: ${count(result.summary.added)} lines added, ${count(result.summary.changed)} changed, ${count(result.summary.removed)} removed, ${count(result.summary.unchanged)} already the same.`);
   setPreview(null);setSure(false);sheet.current=null;setPage(0);setReload(n=>n+1);
  }catch(e){setError(e.message);setSure(false);}
  finally{setBusy('');}
 };
 const saveLine=async event=>{
  event.preventDefault();setBusy('Saving the line…');setError('');setNotice('');
  try{const result=await api('/line',{method:'POST',body:line});setNotice(result.changed?'A Form no. changed for that CMLL id at that site.':'Line added to A Form Master.');setLine({aFormNo:'',employeeId:'',site:line.site});setReload(n=>n+1);}
  catch(e){setError(e.message);}
  finally{setBusy('');}
 };
 const remove=async row=>{
  if(!window.confirm(`Remove A Form no. ${row.aFormNo||'(blank)'} of ${row.employeeId} at ${row.site} from A Form Master?`))return;
  setBusy('Removing the line…');setError('');setNotice('');
  try{await api('/line/'+row.id,{method:'DELETE'});setNotice('Line removed from A Form Master.');setReload(n=>n+1);}
  catch(e){setError(e.message);}
  finally{setBusy('');}
 };
 const download=async()=>{
  setBusy('Preparing the Excel…');setError('');
  try{const all=await api(query({export:'1',page:'0'}));downloadBlob(buildXlsxSheetsWorkbook('A Form Master',aFormMasterSheets(all.lines)),`A-Form-Master-${new Date().toISOString().slice(0,10)}.xlsx`,{title:'A Form Master'});}
  catch(e){setError(e.message);}
  finally{setBusy('');}
 };
 const s=preview?.summary,c=data.counts,pages=Math.max(1,Math.ceil(data.total/(data.pageSize||100)));
 return <section className="employee-master a-form-master">
  <header className="employee-master-hero"><div><small>MASTERS / EMPLOYEES</small><h1>A Form Master</h1><p>A Form no. · CMLL id · Site, linked for scanned cards and biometric files</p></div>
   <div className="employee-actions"><button type="button" onClick={()=>file.current.click()} disabled={Boolean(busy)}>Choose the A Form Excel</button><button type="button" onClick={download} disabled={Boolean(busy)||!data.total}>Download Excel</button></div></header>
  <input hidden type="file" ref={file} accept=".xlsx" onChange={choose}/>
  <section className="hr-master-import" aria-label="How A Form Master is used">
   <p>The same A Form no. is used again at other sites, so a number names a person only together with its site. Each line links the three.</p>
   <ul>
    <li><strong>Scanned trip card:</strong> the Caliber ID, the FORM A box and the batch's site must be one line here. If the Caliber ID read belongs to nobody at the site and the FORM A box names one driver or operator whose number is one digit away, he is taken. If the two boxes name two different people of the site, the card stops for a person.</li>
    <li><strong>Biometric file:</strong> when the device gives the A Form no., it is changed to the CMLL id of that site.</li>
    <li>The site a person works at is the one Employee Master holds. A line for another site is kept but not used.</li>
   </ul>
   {c&&<p><strong>{count(c.lines)}</strong> lines · <strong>{count(c.linked)}</strong> linked · <strong>{count(c.noForm)}</strong> without an A Form no. · <strong>{count(c.toCheck)}</strong> to check</p>}
  </section>
  {busy&&<p role="status">{busy}</p>}
  {error&&<p className="employee-error" role="alert">{error}</p>}
  {notice&&<p role="status" className="hr-master-done">{notice}</p>}
  {s&&<section className="hr-master-import hr-master-preview" aria-label="A Form Excel preview">
   <p><strong>{sheet.current?.fileName}</strong> · {count(s.lines)} lines, {count(s.withForm)} with an A Form no. Nothing is changed yet.</p>
   <table><thead><tr><th>Site</th><th>Lines in the file</th><th>With A Form no.</th><th>New</th><th>A Form no. changed</th><th>Removed (not in the file)</th><th>Already the same</th></tr></thead>
   <tbody>{s.sites.map(row=><tr key={row.site}><td>{row.site}</td><td>{count(row.lines)}</td><td>{count(row.withForm)}</td><td>{count(row.added)}</td><td>{count(row.changed)}</td><td>{count(row.removed)}</td><td>{count(row.unchanged)}</td></tr>)}
   <tr className="hr-master-total"><td>All sites in the file</td><td>{count(s.lines)}</td><td>{count(s.withForm)}</td><td>{count(s.added)}</td><td>{count(s.changed)}</td><td>{count(s.removed)}</td><td>{count(s.unchanged)}</td></tr></tbody></table>
   <ul>
    <li>The file replaces the lines of the sites it names. A site with no line in the file keeps what it has.</li>
    {preview.problemCount>0&&<li><strong>{count(preview.problemCount)}</strong> line(s) cannot be placed and are left out: {preview.problems.slice(0,8).map(row=>`line ${row.line} ${row.employeeId} (${row.problem})`).join('; ')}{preview.problemCount>8?' …':''}</li>}
    {s.sharedNumbers>0&&<li><strong>{count(s.sharedNumbers)}</strong> A Form no. are written against two people of one site and cannot name either until corrected: {preview.lists.shared.slice(0,8).map(row=>`${row.site} ${row.aFormNo} (${row.employeeIds.join(', ')})`).join('; ')}{s.sharedNumbers>8?' …':''}</li>}
    {s.employeesChecked&&s.otherSite>0&&<li><strong>{count(s.otherSite)}</strong> people are at another site in Employee Master today. Their lines start working when Employee Master holds the same site (apply HR's master Excel on the Employee Master page).</li>}
    {s.employeesChecked&&s.notInEmployeeMaster>0&&<li><strong>{count(s.notInEmployeeMaster)}</strong> CMLL ids are not on the Employee Master list today; their lines are kept but not used.</li>}
   </ul>
   <div className="employee-actions">
    {!sure?<button type="button" onClick={()=>setSure(true)} disabled={Boolean(busy)}>Apply to A Form Master</button>
     :<><button type="button" className="hr-master-apply" onClick={apply} disabled={Boolean(busy)}>Yes, apply the A Form Excel now</button><button type="button" onClick={()=>setSure(false)} disabled={Boolean(busy)}>Not now</button></>}
   </div>
  </section>}
  <form className="employee-search a-form-line" onSubmit={saveLine} aria-label="Add or correct one line">
   <label>A Form no.<input value={line.aFormNo} maxLength={60} onChange={e=>setLine(v=>({...v,aFormNo:e.target.value}))} placeholder="for example 467" required/></label>
   <label>CMLL id<input value={line.employeeId} maxLength={20} onChange={e=>setLine(v=>({...v,employeeId:e.target.value}))} placeholder="for example CMLL12345" required/></label>
   <label>Site<select value={line.site} onChange={e=>setLine(v=>({...v,site:e.target.value}))} required><option value="">Choose the site</option>{SITES.map(name=><option key={name}>{name}</option>)}</select></label>
   <button type="submit" disabled={Boolean(busy)}>Add or correct this line</button>
  </form>
  <div className="employee-search">
   <label>Search<input placeholder="A Form no., CMLL id or name" value={q} onChange={e=>{setQ(e.target.value);setPage(0);}}/></label>
   <label>Site<select value={site} onChange={e=>{setSite(e.target.value);setPage(0);}}><option value="">All sites</option>{data.sites.map(name=><option key={name}>{name}</option>)}</select></label>
   <label>Show<select value={only} onChange={e=>{setOnly(e.target.value);setPage(0);}}><option value="">All lines</option><option value="check">Lines to check</option><option value="blank">Without an A Form no.</option></select></label>
   <strong>{count(data.total)} lines</strong>
  </div>
  <div className="employee-register"><table><thead><tr><th>A Form no.</th><th>CMLL id</th><th>Site</th><th>Name (Employee Master)</th><th>Designation</th><th>Link</th><th></th></tr></thead>
   <tbody>{data.lines.map(row=><tr key={row.id}><td>{row.aFormNo||'—'}</td><td>{row.employeeId}</td><td>{row.site}</td><td>{row.name||'—'}</td><td>{row.designation||'—'}</td><td title={stateHelp(row.state)}>{row.state}</td><td><button type="button" disabled={Boolean(busy)} onClick={()=>remove(row)}>Remove</button></td></tr>)}
   {!data.lines.length&&<tr><td colSpan={7}>{c&&!c.lines?'A Form Master is empty. Choose the A Form Excel to fill it.':'No line matches this search.'}</td></tr>}</tbody></table></div>
  <div className="employee-pagination"><button type="button" disabled={page<=0} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page+1} of {count(pages)}</span><button type="button" disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)}>Next</button></div>
 </section>;
}
