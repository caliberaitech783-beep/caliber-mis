import React,{useCallback,useEffect,useState} from 'react';
import {copyBackup} from './scan-backup-files.mjs';
import {rememberedFolder,rememberFolder,folderWithPermission} from './scan-backup-folder.mjs';
import './scan-card-backup.css';
import TableSmartPrint from './table-smart-print.jsx';
const headers=session=>({Authorization:`Bearer ${session.token}`});
const date=value=>value?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'}).format(new Date(value)):'—';
const size=bytes=>(Number(bytes||0)/1024**3).toFixed(2)+' GiB';
async function request(session,url,body){
 const response=await fetch(url,{method:body?'POST':'GET',headers:{...headers(session),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json().catch(()=>({error:`Server answered ${response.status}. Try again.`}));if(!response.ok)throw Error(result.error||'Backup request failed.');return result;
}
export default function ScanCardBackup({session}){
 const [state,setState]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState(null),[result,setResult]=useState(null),[folder,setFolder]=useState(null);
 const load=useCallback(async()=>{try{setState(await request(session,'/api/scan-backups'));setError('')}catch(e){setError(e.message)}},[session.token]);
 useEffect(()=>{load()},[load]);
 useEffect(()=>{rememberedFolder().then(setFolder)},[]);
 useEffect(()=>{if(!busy)return;const warn=e=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[busy]);
 async function start(choose){
  setError('');setResult(null);
  if(typeof window.showDirectoryPicker!=='function'){setError('Open this page in desktop Chrome or Edge to choose an SSD folder and verify files.');return;}
  try{
   // The picker and the permission prompt run directly from the click; no server can choose a local path.
   let directory=null;
   if(!choose&&folder){directory=await folderWithPermission(folder);if(!directory){setError('Allow Pulse-II to use the SSD folder, or press "Choose a different folder".');return;}}
   if(!directory){directory=await window.showDirectoryPicker({mode:'readwrite',id:'pulse-ii-scan-backup',...(folder?{startIn:folder}:{})});await rememberFolder(directory);setFolder(directory);}
   setBusy(true);setProgress({count:0,bytes:0,failed:0});
   const {job}=await request(session,'/api/scan-backups',{destination:directory.name});
   const total=state?.jobs?.find(item=>item.id===job.id)?.cards;
   const copied=await copyBackup({job,directory,api:(url,body)=>request(session,url,body),image:async url=>{const response=await fetch(url,{headers:headers(session)});if(!response.ok)throw Error(`Card download failed (${response.status}).`);return response.arrayBuffer()},onProgress:p=>setProgress({...p,total})});
   setResult({...copied,directory:directory.name});await load();
  }catch(e){if(e.name!=='AbortError')setError(e.name==='NotFoundError'?'The SSD folder is not reachable. Connect the SSD or choose the folder again.':e.message);await load()}finally{setBusy(false)}
 }
 const available=state?.available,incomplete=state?.jobs?.find(job=>job.status!=='complete');
 return <section className="scan-backup-page"><header><div><h1>Scanned Card Backup</h1><p>Start a manual backup to your SSD and verify every image.</p></div><button disabled={busy} onClick={load}>Refresh</button></header>
  <div className="scan-backup-policy"><strong>Hot cloud storage + local SSD backup</strong><p>Backups run only when you start them here. All currently stored scan images are included, with no scheduled cycle or waiting period.</p><p>Backups copy images, saved values and review details. Cloud copies are retained.</p></div>
  {error&&<p role="alert" className="scan-backup-error">{error}</p>}
  {!state?<p>Loading backup status…</p>:!state.enabled?<p>Hot Blob storage is awaiting activation. No existing cards will be migrated.</p>:<div className="scan-backup-due"><h2>Manual SSD backup</h2>
   {available?<p>{incomplete?'Resume the backup of':'Ready to back up'} scans from <strong>{date(available.from)} to {date(new Date(new Date(available.to).getTime()-1))}</strong>{incomplete?<> ({Number(incomplete.verified).toLocaleString()} of {Number(incomplete.cards).toLocaleString()} cards already verified)</>:null}. Keep this page open. Cards already on the SSD are checked, not downloaded again.</p>:<p>No scan images are available to back up.</p>}
   {folder&&<p className="scan-backup-folder">SSD folder: <strong>{folder.name}</strong> (remembered on this computer)</p>}
   <div className="scan-backup-actions">
    <button disabled={busy||!available} onClick={()=>start(false)}>{busy?'Backing up…':folder?`${incomplete?'Resume':'Back up'} to ${folder.name}`:'Choose SSD folder and back up'}</button>
    {folder&&<button className="scan-backup-secondary" disabled={busy||!available} onClick={()=>start(true)}>Choose a different folder</button>}
   </div>
  </div>}
  {busy&&progress&&<p role="status">Verified {progress.count.toLocaleString()}{progress.total?' of '+Number(progress.total).toLocaleString():''} cards · {size(progress.bytes)}{progress.failed?` · ${progress.failed} not copied yet`:''}. Keep this page open.</p>}
  {result&&(result.complete
   ?<p role="status">Backup verified: {result.count.toLocaleString()} cards · {size(result.bytes)} · {result.directory}/{result.folder}</p>
   :<p role="alert" className="scan-backup-error">{result.count.toLocaleString()} cards are on the SSD in {result.directory}/{result.folder}; {result.failed.length} could not be copied ({result.failed[0]?.error}). Press Resume to try those again.</p>)}
  <h2>Backup history</h2>{state?.jobs?.length>0&&<TableSmartPrint row title="Scanned Card Backup · Backup history"/>}<div className="scan-backup-history"><table><thead><tr><th>Scan dates</th><th>Cards verified</th><th>Image size</th><th>Status</th><th>SSD folder</th></tr></thead><tbody>{state?.jobs?.map(job=><tr key={job.id}><td>{date(job.window_start)} – {date(new Date(new Date(job.window_end).getTime()-1))}</td><td>{job.verified} / {job.cards}</td><td>{size(job.bytes)}</td><td>{job.status==='complete'?'Verified · '+date(job.completed_at):'Incomplete · resume available'}</td><td>{job.status==='complete'?job.destination:job.destination?job.destination+'/Pulse-II-'+job.id:'Choose folder when backing up'}</td></tr>)}</tbody></table></div>
 </section>;
}
