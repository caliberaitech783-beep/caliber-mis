import React,{useEffect,useRef,useState} from 'react';
import {displaySiteName} from '../shared/region-scope.mjs';
import {formatDisplayDateTime} from '../shared/date-time-format.mjs';
import AttendanceUnlock from './attendance-unlock.jsx';

export const batchDateTime=value=>formatDisplayDateTime(value);

// Owner, 18 Nov 2026: an MIS user reopens a saved batch directly; no site PM approval.
export default function VlbReopenDialog({session,batch,onChanged,onDismiss}){
 const dialog=useRef(null),[working,setWorking]=useState(false),[error,setError]=useState(''),[dayLocked,setDayLocked]=useState(false);
 useEffect(()=>{const element=dialog.current,previous=document.activeElement;element.showModal();return()=>{element.close();previous?.focus?.()}},[]);
 const reopen=async()=>{
  if(working)return;setWorking(true);setError('');
  try{
   const response=await fetch('/api/vlb-batches/'+batch.id+'/reopen',{method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:'{}'});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Reopening the batch failed.');
   await onChanged(data);onDismiss();
  }catch(e){setError(e.message)}finally{setWorking(false)}
 };
 return <dialog className="vlb-reopen-dialog" ref={dialog} aria-modal="true" aria-labelledby="vlb-reopen-title" onCancel={event=>{event.preventDefault();if(!working)onDismiss()}}><div className="mis-popup-close-bar"><button type="button" className="mis-popup-close" onClick={onDismiss} disabled={working} aria-label="Close window">× Close</button></div>
  <span className="vlb-permission-status">Saved batch · Locked</span>
  <h2 id="vlb-reopen-title">Reopen saved batch</h2>
  <p>This batch has already been saved. Reopen it to add cards or correct saved cards.</p>
  <dl className="vlb-approval-meta"><div><dt>Batch number</dt><dd>{batch.name}</dd></div><div><dt>Site</dt><dd>{displaySiteName(batch.site)}</dd></div><div><dt>Saved on · IST</dt><dd>{batchDateTime(batch.closed_at)}</dd></div></dl>
  {/* A day locked by attendance approval reopens only with an OTP from RHR (owner, 27 Nov 2026). */}
  <AttendanceUnlock session={session} site={batch.site} date={batch.report_date} onLockChange={setDayLocked}/>
  {error&&<p className="logbook-message error" role="alert">{error}</p>}
  <p className="vlb-approval-help">Only you can change this batch while it is reopened. The next successful Manual or Scan save locks the batch again.</p>
  <div className="vlb-batch-actions"><button type="button" disabled={working} onClick={onDismiss}>Cancel</button>{batch.canReopen&&!dayLocked&&<button type="button" className="vlb-approval-primary" autoFocus disabled={working} onClick={reopen}>{working?'Opening…':'Reopen batch'}</button>}</div>
 </dialog>;
}
