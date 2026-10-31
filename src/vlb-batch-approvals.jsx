import React,{useEffect,useRef,useState} from 'react';
import {displaySiteName} from '../region-scope.mjs';
import {batchDateTime} from './vlb-reopen-dialog.jsx';
import './log-book-form.css';
import './vlb-create-batch.css';

export function ApprovalRequest({request,session,onChanged}){
 const [remark,setRemark]=useState(''),[working,setWorking]=useState(false),[error,setError]=useState('');
 const decide=async decision=>{
  if(working)return;if(decision==='reject'&&!remark.trim()){setError('Enter a rejection reason before rejecting this request.');return;}
  setWorking(true);setError('');
  try{
   const response=await fetch('/api/vlb-batches/'+request.batch_id+'/reopen-decision',{method:'POST',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:JSON.stringify({requestId:request.id,decision,note:remark.trim()})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Could not save the PM decision.');await onChanged();
  }catch(e){setError(e.message)}finally{setWorking(false)}
 };
 return <article className="vlb-approval-request"><header><div><h2>{request.name}</h2><p>{displaySiteName(request.site)} · {request.report_date} · {request.shift}</p></div><span className="vlb-permission-status">{request.status==='pending'?'Pending PM approval':request.status==='used'?'Approval used':request.status.toUpperCase()}{request.closure_revision!==request.current_revision?' · Previous save':''}</span></header>
  <dl className="vlb-approval-meta"><div><dt>Requested by</dt><dd>{request.requested_by}</dd></div><div><dt>Requested on · IST</dt><dd>{batchDateTime(request.requested_at)}</dd></div><div><dt>Last saved · IST</dt><dd>{batchDateTime(request.closed_at)}</dd></div><div><dt>Access requested</dt><dd>One reopening · Selected batch</dd></div></dl>
  <div className="vlb-approval-reason"><span>Reason for reopening</span><p>{request.reason}</p></div>
  <p className="vlb-approval-help">Approval permits only this user to reopen this batch once. The next successful Manual or Scan save locks it again. Decisions and saved changes are recorded in the batch audit history.</p>
  {request.canDecide?<><label htmlFor={'vlb-review-'+request.id}>PM review remark <small>(required for rejection)</small></label><textarea id={'vlb-review-'+request.id} maxLength={2000} value={remark} disabled={working} onChange={e=>setRemark(e.target.value)} placeholder="Enter your review comment or rejection reason"/><div className="vlb-batch-actions"><button type="button" className="vlb-approval-reject" disabled={working} onClick={()=>decide('reject')}>Reject request</button><button type="button" className="vlb-approval-primary" disabled={working} onClick={()=>decide('approve')}>{working?'Saving decision…':'Approve reopening'}</button></div></>:<p>Reviewed by {request.decided_by||'Awaiting the assigned site PM'}{request.decision_note?' · '+request.decision_note:''}</p>}
  {error&&<p role="alert" className="logbook-message error">{error}</p>}
 </article>;
}

export default function VlbBatchApprovals({session,refresh=0,onChanged}){
 const [requests,setRequests]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');const generation=useRef(0);
 const load=async signal=>{const current=++generation.current;try{const response=await fetch('/api/vlb-batches/approvals',{signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token}});const data=await response.json();if(!response.ok)throw Error(data.error||'Could not load batch approval requests.');if(current===generation.current&&!signal?.aborted){setRequests(data.requests||[]);setError('')}}catch(e){if(current===generation.current&&!signal?.aborted)setError(e.message)}finally{if(current===generation.current&&!signal?.aborted)setLoading(false)}};
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);const timer=setInterval(()=>void load(controller.signal),10000);return()=>{controller.abort();clearInterval(timer);++generation.current}},[session.token,refresh]);
 const changed=async()=>{await load();await onChanged?.()};
 const pending=requests.filter(r=>r.canDecide).length;
 return <section className="logbook-page vlb-create-batch vlb-approvals-page"><header className="logbook-page-header"><div><h1>Batch reopening approvals</h1><p>Review requests for your assigned site.</p></div><div className="vlb-batch-actions"><span className="vlb-permission-status">{pending} pending request{pending===1?'':'s'}</span><button type="button" onClick={()=>load()}>Refresh</button></div></header>
  {error&&<p role="alert" className="logbook-message error">{error}</p>}{loading?<p role="status">Loading approval requests…</p>:<div aria-live="polite">{!requests.length&&<p>No batch reopening requests for your assigned site.</p>}{[...requests].sort((a,b)=>Number(b.canDecide)-Number(a.canDecide)).map(request=><ApprovalRequest key={request.id} request={request} session={session} onChanged={changed}/>)}</div>}
 </section>;
}
