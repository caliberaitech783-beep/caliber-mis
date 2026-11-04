import React from 'react';
export default function ScanBatchMismatchDialog({gate,busy,error,onDiscard,onCancel}){
 return <section className="scan-mismatch-dialog scan-mismatch-panel" aria-labelledby="scan-mismatch-title">
  <h2 id="scan-mismatch-title">Mismatch cards</h2>
  <p id="scan-mismatch-description">These cards do not match Scan setup. Delete them from this batch to continue with matching cards.</p>
  <p className="scan-mismatch-expected"><strong>Selected:</strong> {gate.context.bookDate} · {gate.context.location} · Shift {gate.context.cardShift}</p>
  {gate.waiting&&<p role="status">Checking remaining cards. You can delete mismatches once all pages have been checked.</p>}
  <ul>{gate.mismatches.map(card=><li key={card.id}><strong>Card {card.ordinal} · {card.filename}</strong>{card.issues.map(issue=><span key={issue}>{issue}</span>)}</li>)}</ul>
  {error&&<p role="alert" className="scan-error">{error}</p>}
  <p className="scan-mismatch-note">Delete from batch removes only these cards from processing. Original scans stay in audit history.</p>
  <footer><button type="button" disabled={busy} onClick={onDiscard}>Delete {gate.mismatches.length} mismatch card(s) & continue</button><button type="button" disabled={busy} onClick={onCancel}>Cancel batch</button></footer>
 </section>;
}
