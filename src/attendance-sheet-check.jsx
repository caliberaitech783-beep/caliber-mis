// Attendance Sheet Mismatch (owner, 23 Nov 2026): Reports > Manpower & OT, the tab beside Attendance Month-wise.
// The attendance Excel a site keeps by hand is uploaded, only the site is asked, and the corrections needed between
// that sheet and Pulse-II come back as an Excel: the same sheet with each mismatch coloured, the colour key at the top
// (red = EMP. ID mismatch, yellow = name mismatch, …), the list of corrections, and who is in Pulse-II but not in the sheet.
// The sheet is read and compared in the browser and nothing is saved in Pulse-II. The rules are in
// shared/attendance-sheet-check.mjs, the reading and the run in src/attendance-sheet-run.mjs, and the two small server
// reads in server/routes/attendance-sheet-check.mjs.
import React,{useEffect,useState} from 'react';
import {Download,Upload} from 'lucide-react';
import {dmy,CORRECTION_KINDS} from '../shared/attendance-sheet-check.mjs';
import {readAttendanceFile,runSheetCheck,sheetApi} from './attendance-sheet-run.mjs';
import {downloadBlob} from './download-history.mjs';
import './attendance-sheet-check.css';

const many=(n,one,more=one+'s')=>n+' '+(n===1?one:more);


export default function AttendanceSheetCheck({session}){
 const [sites,setSites]=useState({list:null,error:''}),[site,setSite]=useState('');
 const [file,setFile]=useState({busy:false,name:'',sheet:null,error:''});
 const [run,setRun]=useState({busy:false,error:'',done:null});
 useEffect(()=>{
  let live=true;
  sheetApi('/api/reports/manpower/attendance-sheet/sites',session).then(p=>{if(!live)return;setSites({list:p.sites||[],error:''});if(p.sites?.length===1)setSite(p.sites[0]);},e=>live&&setSites({list:[],error:e.message}));
  return()=>{live=false;};
 },[session.token]);
 const choose=async event=>{
  const picked=event.target.files?.[0];event.target.value='';if(!picked)return;
  setRun({busy:false,error:'',done:null});setFile({busy:true,name:picked.name,sheet:null,error:''});
  try{setFile({busy:false,name:picked.name,sheet:await readAttendanceFile(picked),error:''});}
  catch(error){setFile({busy:false,name:picked.name,sheet:null,error:error.message});}
 };
 const check=async()=>{
  setRun({busy:true,error:'',done:null});
  try{
   const done=await runSheetCheck({sheet:file.sheet,fileName:file.name,site,session});
   downloadBlob(done.blob,done.name,{title:done.title});
   setRun({busy:false,error:'',done});
  }catch(error){setRun({busy:false,error:error.message,done:null});}
 };
 const sheet=file.sheet,ready=Boolean(sheet&&site&&!run.busy);
 const done=run.done,result=done?.result;
 const kinds=result?Object.entries(CORRECTION_KINDS).filter(([kind])=>result.counts[kind]>0):[];
 return <div className="asc-page">
  <p className="asc-intro">Upload the attendance Excel the site keeps by hand: one line per employee with EMP. ID, NAME and DESIGNATION, and one column per date marked P or A. Choose the site and press Check. Pulse-II compares it with Employee Master and with its own attendance of the locked dates (saved trip cards, log books and zero-trip entries) and gives an Excel back: the same sheet with every mismatch coloured, what each colour means at the top, and the list of corrections required. Nothing is changed in Pulse-II.</p>
  <div className="asc-steps">
   <section className="asc-step"><h2>1 · Attendance Excel of the site</h2>
    <label className={'asc-upload'+(file.busy?' busy':'')}><Upload size={16}/>{file.busy?'Reading the file…':sheet?'Choose another file':'Choose the Excel file'}<input type="file" accept=".xlsx,.xlsm,.xlk" disabled={file.busy||run.busy} onChange={choose}/></label>
    {sheet&&<p className="asc-note" role="status"><strong>{file.name}</strong> · sheet “{sheet.sheetName}” · {many(sheet.people.length,'employee')} · {sheet.filledDates.length?'marks from '+dmy(sheet.filledDates[0])+' to '+dmy(sheet.filledDates.at(-1)):'no date is marked'}{sheet.missingDates.length?' · no column for '+sheet.missingDates.map(dmy).join(', '):''}</p>}
    {file.error&&<p className="asc-error" role="alert">{file.name}: {file.error}</p>}
   </section>
   <section className="asc-step"><h2>2 · Site of this sheet</h2>
    <select aria-label="Site of this attendance sheet" value={site} disabled={run.busy||!sites.list} onChange={e=>{setSite(e.target.value);setRun({busy:false,error:'',done:null});}}>
     <option value="">{sites.list?'Select the site':'Reading your sites…'}</option>{(sites.list||[]).map(name=><option key={name} value={name}>{name}</option>)}
    </select>
    {sites.error&&<p className="asc-error" role="alert">{sites.error}</p>}
    {sites.list&&!sites.list.length&&!sites.error&&<p className="asc-error" role="alert">No site is assigned to your login.</p>}
   </section>
   <section className="asc-step"><h2>3 · Check</h2>
    <button type="button" className="asc-run" disabled={!ready} onClick={check}><Download size={16}/>{run.busy?'Comparing with Pulse-II…':'Check and download Excel'}</button>
    {run.busy&&<p className="asc-note" role="status">Reading Pulse-II attendance of these dates. A full month takes up to a minute.</p>}
    {!sheet&&!file.busy&&<p className="asc-hint">Choose the Excel file first.</p>}{sheet&&!site&&<p className="asc-hint">Select the site.</p>}
   </section>
  </div>
  {run.error&&<p className="asc-error" role="alert">{run.error}</p>}
  {result&&<section className="asc-result" aria-label="Result of the check">
   <h2>{result.site} · {dmy(done.range.from)} to {dmy(done.range.to)} · {many(result.totals.corrections,'correction')} for {many(result.totals.peopleWithCorrections,'employee')}</h2>
   <p className="asc-note" role="status">The Excel <strong>{done.name}</strong> is in your Downloads folder and in Download History (the folder button at the top). <button type="button" className="asc-again" onClick={()=>downloadBlob(done.blob,done.name,{title:done.title})}>Download again</button></p>
   <table className="asc-counts"><tbody>
    <tr><th scope="row">Employees in the sheet</th><td>{result.totals.people}</td></tr>
    <tr><th scope="row">Compared day by day (drivers and operators, or a duty in Pulse-II)</th><td>{result.totals.judged}</td></tr>
    <tr><th scope="row">Dates compared (locked in Pulse-II)</th><td>{result.dates.judged.length}</td></tr>
    <tr><th scope="row">Dates not locked in Pulse-II yet</th><td>{result.dates.pending.length}</td></tr>
    {kinds.map(([kind,label])=><tr key={kind}><th scope="row">{label}</th><td>{result.counts[kind]}</td></tr>)}
    <tr><th scope="row">On Pulse-II Employee Master at this site, not in the sheet</th><td>{result.listedOnly.length}</td></tr>
   </tbody></table>
   {done.range.cut&&<p className="asc-hint">The sheet covers more than 31 days: only the first 31 are compared.</p>}
  </section>}
 </div>;
}
