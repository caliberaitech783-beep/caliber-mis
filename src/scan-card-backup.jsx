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
export function ScanBackupReminder({session,onOpen}){
 const [due,setDue]=useState(0);
 useEffect(()=>{let active=true;const check=()=>request(session,'/api/scan-backups').then(data=>{if(active)setDue(data.due?.length||0)}).catch(()=>{});check();const timer=setInterval(check,3600000);window.addEventListener('focus',check);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',check)}},[session.token]);
 return due?<aside className="scan-backup-reminder" role="status"><span>SSD backup due · {due} block{due===1?'':'s'} of 30 days</span><button onClick={onOpen}>Open Backup</button></aside>:null;
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
 const due=state?.due?.[0];
 return <section className="scan-backup-page"><header><div><h1>Scanned Card Backup</h1><p>Copy a 30-day block to your SSD and verify every image.</p></div><button disabled={busy} onClick={load}>Refresh</button></header>
  <div className="scan-backup-policy"><strong>Hot cloud storage + local SSD backup</strong><p>New scans remain in Hot storage. The first backup is due 60 days after the first new scan; subsequent blocks become due every 30 days. Existing cards and saved logbooks stay unchanged.</p><p>Backups copy images, saved values and review details. Cloud copies are retained.</p></div>
  {error&&<p role="alert" className="scan-backup-error">{error}</p>}
  {!state?<p>Loading backup status…</p>:!state.enabled?<p>Hot Blob storage is awaiting activation. No existing cards will be migrated.</p>:<div className="scan-backup-due"><h2>{due?'SSD backup due':'No backup due'}</h2>
   {due?<><p>Oldest eligible block: <strong>{date(due.from)} to {date(new Date(new Date(due.to).getTime()-1))}</strong></p><p>{state.due.length} block{state.due.length===1?'':'s'} waiting. Choose your SSD folder, keep the drive connected and this page open. Interrupted backups can be retried; matching files are verified and reused.</p></>:<p>{state.firstScanAt?'First scan: '+date(state.firstScanAt)+'. Check back for the next 30-day block.':'The cycle starts with the first new scan stored in Hot Blob Storage.'}</p>}
   <button disabled={busy||!due} onClick={start}>{busy?'Backing up…':'Choose SSD folder and back up'}</button>
  </div>}
  {busy&&progress&&<p role="status">Verified {progress.count.toLocaleString()} cards · {size(progress.bytes)}. Keep this page open.</p>}
  {result&&<p role="status">Backup verified: {result.count.toLocaleString()} cards · {size(result.bytes)} · {result.folder}</p>}
  <h2>Backup history</h2><div className="scan-backup-history"><table><thead><tr><th>Scan dates</th><th>Cards verified</th><th>Image size</th><th>Status</th><th>SSD folder</th></tr></thead><tbody>{state?.jobs?.map(job=><tr key={job.id}><td>{date(job.window_start)} – {date(new Date(new Date(job.window_end).getTime()-1))}</td><td>{job.verified} / {job.cards}</td><td>{size(job.bytes)}</td><td>{job.status==='complete'?'Verified · '+date(job.completed_at):'Incomplete · retry available'}</td><td>{job.destination||'Choose folder when backing up'}</td></tr>)}</tbody></table></div>
 </section>;
}
