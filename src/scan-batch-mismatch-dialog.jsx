import React,{useEffect,useRef} from 'react';
export default function ScanBatchMismatchDialog({gate,busy,error,onDiscard,onCancel}){
 const dialog=useRef(null),primary=useRef(null);
 useEffect(()=>{const node=dialog.current;const preventDismiss=event=>event.preventDefault();const keepVisible=()=>{if(node.isConnected&&!node.open)node.showModal()};node.addEventListener('cancel',preventDismiss);node.addEventListener('close',keepVisible);node.showModal();primary.current?.focus();return()=>{node.removeEventListener('cancel',preventDismiss);node.removeEventListener('close',keepVisible);node.close()}},[]);
 return <dialog ref={dialog} className="scan-mismatch-dialog" aria-labelledby="scan-mismatch-title" aria-describedby="scan-mismatch-description" onCancel={event=>event.preventDefault()}>
  <h2 id="scan-mismatch-title">Wrong cards found</h2>
  <p id="scan-mismatch-description">These cards do not match your selection. They are blocked from entries and Excel.</p>
  <p className="scan-mismatch-expected"><strong>Selected:</strong> {gate.context.bookDate} · {gate.context.location} · Shift {gate.context.cardShift}</p>
  <ul>{gate.mismatches.map(card=><li key={card.id}><strong>Card {card.ordinal} · {card.filename}</strong>{card.issues.map(issue=><span key={issue}>{issue}</span>)}</li>)}</ul>
  {error&&<p role="alert" className="scan-error">{error}</p>}
  <p className="scan-mismatch-note">Delete from batch removes only these cards from processing. Original scans stay in audit history.</p>
  <footer><button ref={primary} type="button" disabled={busy} onClick={onDiscard}>Delete {gate.mismatches.length} wrong card(s) & continue</button><button type="button" disabled={busy} onClick={onCancel}>Cancel batch</button></footer>
 </dialog>;
}
