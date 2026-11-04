import React,{useCallback,useEffect,useState} from 'react';
import {copyBackup} from './scan-backup-files.mjs';
import './scan-card-backup.css';
const headers=session=>({Authorization:`Bearer ${session.token}`});
const date=value=>value?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'}).format(new Date(value)):'—';
const size=bytes=>(Number(bytes||0)/1024**3).toFixed(2)+' GiB';
async function request(session,url,body){
 const response=await fetch(url,{method:body?'POST':'GET',headers:{...headers(session),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Backup request failed.');return result;
}
export default function ScanCardBackup({session}){
 const [state,setState]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState(null),[result,setResult]=useState(null);
 const load=useCallback(async()=>{try{setState(await request(session,'/api/scan-backups'));setError('')}catch(e){setError(e.message)}},[session.token]);
 useEffect(()=>{load()},[load]);
 useEffect(()=>{if(!busy)return;const warn=e=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[busy]);
 async function start(){
  setError('');setResult(null);
  if(typeof window.showDirectoryPicker!=='function'){setError('Open this page in desktop Chrome or Edge to choose an SSD folder and verify files.');return;}
  try{
   // The picker runs directly from the click; no server can choose a local path.
   const directory=await window.showDirectoryPicker({mode:'readwrite',id:'pulse-ii-scan-backup'});setBusy(true);setProgress({count:0,bytes:0});
   const {job}=await request(session,'/api/scan-backups',{});
   const copied=await copyBackup({job,directory,api:(url,body)=>request(session,url,body),image:async url=>{const response=await fetch(url,{headers:headers(session)});if(!response.ok)throw Error('A card could not be downloaded. The backup remains incomplete.');return response.arrayBuffer()},onProgress:setProgress});
   setResult(copied);await load();
  }catch(e){if(e.name!=='AbortError')setError(e.message)}finally{setBusy(false)}
 }
 const available=state?.available;
 return <section className="scan-backup-page"><header><div><h1>Scanned Card Backup</h1><p>Start a manual backup to your SSD and verify every image.</p></div><button disabled={busy} onClick={load}>Refresh</button></header>
  <div className="scan-backup-policy"><strong>Hot cloud storage + local SSD backup</strong><p>Backups run only when you start them here. All currently stored scan images are included, with no scheduled cycle or waiting period.</p><p>Backups copy images, saved values and review details. Cloud copies are retained.</p></div>
  {error&&<p role="alert" className="scan-backup-error">{error}</p>}
  {!state?<p>Loading backup status…</p>:!state.enabled?<p>Hot Blob storage is awaiting activation. No existing cards will be migrated.</p>:<div className="scan-backup-due"><h2>Manual SSD backup</h2>
   {available?<p>Ready to back up scans from <strong>{date(available.from)} to {date(new Date(new Date(available.to).getTime()-1))}</strong>. Choose your SSD folder and keep this page open. Incomplete backups can be resumed.</p>:<p>No scan images are available to back up.</p>}
   <button disabled={busy||!available} onClick={start}>{busy?'Backing up…':'Choose SSD folder and back up'}</button>
  </div>}
  {busy&&progress&&<p role="status">Verified {progress.count.toLocaleString()} cards · {size(progress.bytes)}. Keep this page open.</p>}
  {result&&<p role="status">Backup verified: {result.count.toLocaleString()} cards · {size(result.bytes)} · {result.folder}</p>}
  <h2>Backup history</h2><div className="scan-backup-history"><table><thead><tr><th>Scan dates</th><th>Cards verified</th><th>Image size</th><th>Status</th><th>SSD folder</th></tr></thead><tbody>{state?.jobs?.map(job=><tr key={job.id}><td>{date(job.window_start)} – {date(new Date(new Date(job.window_end).getTime()-1))}</td><td>{job.verified} / {job.cards}</td><td>{size(job.bytes)}</td><td>{job.status==='complete'?'Verified · '+date(job.completed_at):'Incomplete · retry available'}</td><td>{job.destination||'Choose folder when backing up'}</td></tr>)}</tbody></table></div>
 </section>;
}
