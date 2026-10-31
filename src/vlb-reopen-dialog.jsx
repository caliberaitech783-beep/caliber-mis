import React,{useEffect,useRef,useState} from 'react';
import {displaySiteName} from '../region-scope.mjs';
import {formatDisplayDateTime} from '../date-time-format.mjs';

export const batchDateTime=value=>formatDisplayDateTime(value);

export default function VlbReopenDialog({session,batch,actor,onChanged,onDismiss}){
 const dialog=useRef(null),[reason,setReason]=useState(''),[working,setWorking]=useState(false),[error,setError]=useState(''),[submitted,setSubmitted]=useState(null);
 useEffect(()=>{const element=dialog.current,previous=document.activeElement;element.showModal();return()=>{element.close();previous?.focus?.()}},[]);
 const latest=(batch.requests||[]).find(r=>r.requested_by===actor?.login&&r.closure_revision===batch.closure_revision);
 const request=latest?.id===submitted?.id?latest:submitted||latest;
 const trial=batch.pmApprovalTrial?.active;
 const approved=batch.canReopen&&!batch.approvalExpired,pending=request?.status==='pending'&&!approved;
 const action=async(reopen=false)=>{
  if(working)return;setWorking(true);setError('');
  try{
   const response=await fetch('/api/vlb-batches/'+batch.id+(reopen?'/reopen':'/reopen-request'),{method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:JSON.stringify(reopen?{}:{reason})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Batch approval request failed.');
   if(!reopen)setSubmitted(data);await onChanged(reopen?data:null);if(reopen)onDismiss();
  }catch(e){setError(e.message)}finally{setWorking(false)}
 };
 return <dialog className="vlb-reopen-dialog" ref={dialog} aria-modal="true" aria-labelledby="vlb-reopen-title" onCancel={event=>{event.preventDefault();if(!working)onDismiss()}}>
  <span className="vlb-permission-status">Saved batch · Locked</span>
  <h2 id="vlb-reopen-title">{trial?'Reopen during VLB trial':approved?'PM approval granted':'PM approval required'}</h2>
  <p>{trial?'PM approval is paused until '+batchDateTime(batch.pmApprovalTrial.endsAt)+' IST. You can reopen this batch directly.':'This batch has already been saved. Permission from the assigned Project Manager is required to reopen it.'}</p>
  <dl className="vlb-approval-meta"><div><dt>Batch number</dt><dd>{batch.name}</dd></div><div><dt>Site</dt><dd>{displaySiteName(batch.site)}</dd></div><div><dt>Saved on · IST</dt><dd>{batchDateTime(batch.closed_at)}</dd></div><div><dt>Approval from</dt><dd>{trial?'Owner-authorized 10-day trial':'Assigned site Project Manager'}</dd></div></dl>
  {error&&<p className="logbook-message error" role="alert">{error}</p>}
  {pending?<p role="status" className="vlb-approval-feedback">Awaiting PM approval. The batch remains locked.</p>:approved?<p role="status" className="vlb-approval-feedback">{trial?'PM approval is not required during this trial.':'Approved by '+(request?.decided_by||'the site PM')+'.'} You can reopen this batch once.</p>:<>
   {request?.status==='rejected'&&<p className="vlb-approval-feedback">Request rejected: {request.decision_note||'Contact your site PM.'}</p>}
   {batch.approvalExpired&&<p className="vlb-approval-feedback">The previous approval is no longer valid. Request approval from the current site PM.</p>}
   <label htmlFor="vlb-reopen-reason">Reason for reopening *</label><textarea id="vlb-reopen-reason" autoFocus required maxLength={2000} disabled={working} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Explain the additional cards or corrections needed"/>
  </>}
  <p className="vlb-approval-help">Permission applies only to you and this batch. The next successful Manual or Scan save locks the batch again.</p>
  <div className="vlb-batch-actions"><button type="button" disabled={working} onClick={onDismiss}>{pending?'Close':'Cancel'}</button>{approved?<button type="button" className="vlb-approval-primary" disabled={working} onClick={()=>action(true)}>{working?'Opening…':trial?'Reopen batch':'Reopen approved batch'}</button>:!pending&&batch.canRequestReopen&&<button type="button" className="vlb-approval-primary" disabled={working||reason.trim().length<5} onClick={()=>action()}>{working?'Submitting…':'Request PM approval'}</button>}</div>
 </dialog>;
}
