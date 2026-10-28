import React,{useEffect,useState} from 'react';
import './mis-admin.css';
const headers=session=>({Authorization:'Bearer '+session.token});
const bytes=value=>Number(value||0).toLocaleString('en-IN')+' bytes';
export default function MisAdministration({page,session,onScanBackup,canScanBackup=true,ReportSection}){
 const [data,setData]=useState(null),[backups,setBackups]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const identity=session.token+':'+page;
 const read=async(url,signal)=>{const response=await fetch(url,{signal,cache:'no-store',headers:headers(session)});const body=await response.json();if(!response.ok)throw Error(body.error||'Could not load MIS administration.');return body};
 useEffect(()=>{const controller=new AbortController();setData(null);setBackups([]);setError('');(async()=>{try{const [status,history]=await Promise.all([read('/api/mis-admin/status',controller.signal),page==='Full Backup'?read('/api/backups',controller.signal):Promise.resolve({history:[]})]);if(!controller.signal.aborted){setData({...status,identity});setBackups(history.history)}}catch(e){if(!controller.signal.aborted)setError(e.message)}})();return()=>controller.abort()},[identity,refresh]);
 const create=async()=>{setBusy(true);setError('');try{const response=await fetch('/api/mis-admin/backup',{method:'POST',headers:headers(session)}),result=await response.json();if(!response.ok)throw Error(result.error||'Backup could not be created.');setRefresh(v=>v+1)}catch(e){setError(e.message)}finally{setBusy(false)}};
 const download=async row=>{
  setError('');let writable;
  try{
   if(window.showSaveFilePicker){const handle=await window.showSaveFilePicker({suggestedName:row.fileName});writable=await handle.createWritable();}
   const response=await fetch('/api/backups/'+row.id+'/download',{headers:headers(session),cache:'no-store'});
   if(!response.ok)throw Error('The backup could not be downloaded. Refresh and retry.');
   if(writable){await response.body.pipeTo(writable);writable=null;return;}
   const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=row.fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(e){if(writable)await writable.abort().catch(()=>{});if(e.name!=='AbortError')setError(e.message)}
 };
 const current=data?.identity===identity?data:null;
 return <section className="panel mis-admin-page"><header><h1>{page}</h1><button type="button" onClick={()=>setRefresh(v=>v+1)} disabled={busy}>Refresh</button></header>
  {error&&<p role="alert">{error}</p>}{!current&&!error&&<p role="status">Loading MIS database status…</p>}
  {current&&<><dl className="mis-admin-metrics">{[['Database',current.database],['Connection',current.connected?'Connected':'Unavailable'],['Saved VLB',current.vlb],['Saved ELB',current.elb],['Scanned cards',current.scans],['Protected scan storage',current.hotScanStorage?'Available':'Not configured']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{String(value??'—')}</dd></div>)}</dl>
   {page==='Full Backup'&&<><p>The database recovery file contains all MIS tables, including log books, tickets, audit records and scan references. Original scan images are held separately in protected Blob storage.</p><div className="mis-admin-actions"><button type="button" onClick={create} disabled={busy}>{busy?'Creating database recovery backup…':'Create database recovery backup'}</button><button type="button" onClick={onScanBackup} disabled={!canScanBackup} title={canScanBackup?undefined:"Scanned-card backup permission is required"}>Open scanned-card SSD backup</button></div>
    <ReportSection title="MIS database recovery backups" category="mis-backups" columns={[{key:'fileName',label:'Backup',value:r=>r.fileName},{key:'status',label:'Status',value:r=>r.status},{key:'startedAt',label:'Created',value:r=>r.startedAt},{key:'sizeBytes',label:'Size',value:r=>bytes(r.sizeBytes)},{key:'checksum',label:'SHA-256',value:r=>r.checksum},{key:'download',label:'Download',value:r=>r.downloadable?'Available':'Unavailable',render:r=>r.downloadable?<button type="button" onClick={()=>download(r)}>Download</button>:'—'}]} rows={backups}/>
   </>}
  </>}
 </section>;
}
