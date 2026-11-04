import React,{useState} from 'react';

export default function VlbBatchDeleteDialog({session,batch,onClose,onDeleted}){
 const [reason,setReason]=useState(''),[preview,setPreview]=useState(null),[approval,setApproval]=useState('');
 const [otp,setOtp]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const api=async(action,body)=>{const response=await fetch('/api/vlb-batches/'+batch.id+'/'+action,{method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(result.error||'Batch deletion could not continue.');return result;};
 const run=async task=>{setBusy(true);setError('');try{await task()}catch(e){setError(e.message)}finally{setBusy(false)}};
 const prepare=()=>run(async()=>{setPreview(await api('deletion-preview',{reason:reason.trim()}));setApproval('');setOtp('');setSent(false)});
 const send=()=>run(async()=>{const result=await api('deletion-otp',{requestId:preview.requestId,approval});if(!result.sent)throw Error('WhatsApp OTP was not sent. Nothing was deleted.');setSent(true)});
 const remove=()=>run(async()=>{const result=await api('delete-empty',{requestId:preview.requestId,approval,otp});if(!result.deleted)throw Error('The batch was not deleted.');onDeleted(result)});
 return <div className="logbook-dialog-backdrop"><section className="logbook-dialog" role="dialog" aria-modal="true" aria-labelledby="empty-batch-delete-title"><div className="mis-popup-close-bar"><button type="button" className="mis-popup-close" onClick={onClose} disabled={busy} aria-label="Close window">× Close</button></div>
  <h2 id="empty-batch-delete-title">Delete empty batch</h2>
  <p style={{overflowWrap:'anywhere'}}><strong>{preview?.name||batch.name}</strong><br/>Record ID: {batch.id}</p>
  {!preview?<><p>Only batches with no saved, scanned or uploaded cards can be deleted. The server checks the batch again before deletion.</p><label>Reason for deletion<textarea aria-label="Reason for empty batch deletion" rows={3} maxLength={2000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label><button type="button" disabled={busy||reason.trim().length<5} onClick={prepare}>Preview deletion</button></>:<>
   <p><strong>Reason:</strong> {preview.reason}</p>
   <p><strong>Impact:</strong> {preview.impact}</p>
   <p><strong>Recovery:</strong> {preview.recovery}</p>
   <p>WhatsApp OTP is required for this deletion and will be sent to <strong>{preview.recipient}</strong>. Approval expires after {preview.expiresInMinutes} minutes.</p>
   <label>Type this exact confirmation:<code style={{display:'block',overflowWrap:'anywhere',whiteSpace:'normal'}}>{preview.approval}</code><input aria-label="Confirm exact empty batch deletion" autoComplete="off" value={approval} disabled={busy||sent} onChange={e=>setApproval(e.target.value)}/></label>
   {!sent?<button type="button" disabled={busy||approval!==preview.approval} onClick={send}>Send WhatsApp OTP</button>:<><p role="status">WhatsApp accepted the OTP message. Enter the code received at {preview.recipient} to verify this deletion.</p><label>WhatsApp OTP<input aria-label="WhatsApp OTP for batch deletion" type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} disabled={busy} onChange={e=>setOtp(e.target.value.replace(/\D/g,''))}/></label><button type="button" disabled={busy||approval!==preview.approval||!/^\d{6}$/.test(otp)} onClick={remove}>Verify OTP &amp; delete batch</button></>}
  </>}
  {error&&<p role="alert">{error}</p>}
  <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
 </section></div>;
}
