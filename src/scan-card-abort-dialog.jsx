import React,{useEffect,useRef,useState} from 'react';
import {scanAbortApproval} from './scan-card-deletion-selection.mjs';
export default function ScanCardAbortDialog({targets,kind,batchName,onClose,onAbort}){
 const dialog=useRef(null),pending=useRef(false);
 const [approved,setApproved]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState('');
 const dismiss=()=>{if(!pending.current)onClose()};
 useEffect(()=>{const node=dialog.current;if(node&&!node.open)node.showModal();return()=>{if(node?.open)node.close()}},[]);
 const confirm=async()=>{if(!approved||pending.current)return;pending.current=true;setWorking(true);setError('');try{await onAbort({cards:targets.map(card=>({id:card.id})),approval:scanAbortApproval(targets)})}catch(error){setError(error.message)}finally{pending.current=false;setWorking(false)}};
 return <dialog ref={dialog} className="scan-card-deletion-dialog scan-card-abort-dialog" aria-labelledby="scan-card-abort-title" onCancel={event=>{event.preventDefault();dismiss()}}>
  <header><div><small>{kind==='vehicle'?'VLB · Trip cards':'ELB · Job cards'}</small><h2 id="scan-card-abort-title">Abort {targets.length} selected cards?</h2></div><button type="button" aria-label="Close selected card abort" disabled={working} onClick={dismiss}>× Close</button></header>
  <div className="scan-card-deletion-content"><p>Batch: {batchName||targets[0]?.batch_id} · Batch ID: {targets[0]?.batch_id}</p><div className="scan-group-deletion-preview"><table><thead><tr><th>Card</th><th>Card ID</th><th>Status</th><th>File</th></tr></thead><tbody>{targets.map(card=><tr key={card.id}><td>{card.ordinal}</td><td>{card.id}</td><td>{card.status==='queued'?'Queued':'Processing'}</td><td>{card.filename}</td></tr>)}</tbody></table></div>
   <p>Stops only the queued or processing cards listed above. Uploaded scans and existing values are retained. Other cards continue processing.</p>
   <label className="scan-card-deletion-approval"><input type="checkbox" checked={approved} disabled={working} onChange={event=>setApproved(event.target.checked)}/><span>I approve aborting only the selected cards listed above.</span></label>
   {error&&<p className="scan-error" role="alert">{error}</p>}
  </div><footer><button type="button" disabled={working} onClick={dismiss}>Cancel</button><button type="button" className="scan-abort" disabled={!approved||working} onClick={confirm}>{working?'Aborting…':'Abort selected cards'}</button></footer>
 </dialog>;
}
