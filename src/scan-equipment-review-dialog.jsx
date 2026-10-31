import React,{useEffect,useRef} from 'react';
export default function ScanEquipmentReviewDialog({card,busy,error,onReject,onDelete,onTransfer,onRecheck,onReview}){
 const dialog=useRef(null),review=card.raw_fields.fleetReview;
 useEffect(()=>{const node=dialog.current;node.showModal();return()=>node.close()},[]);
 return <dialog ref={dialog} className="scan-equipment-dialog" aria-labelledby="scan-equipment-title" onCancel={event=>{event.preventDefault();onReview()}}>
 <h2 id="scan-equipment-title">Equipment missing or not at this site</h2><p>Card {card.ordinal} · {card.filename}</p>
 {review.error&&<p role="alert">{review.error}</p>}<ul>{review.issues.map(issue=><li key={issue.key}><strong>{issue.door}</strong><span>Selected site: {issue.selectedSite}</span><span>Pulse location: {issue.pulseSite}</span><small>{issue.fields.filter(field=>field.startsWith('trips.')).length} trip row(s) flagged</small></li>)}</ul>
 {error&&<p role="alert">{error}</p>}
 <section><h3>1. Delete this card</h3><p>If the equipment is not in the master or this card should not be processed, delete this card and its original scan after confirmation.</p><button type="button" disabled={busy} onClick={onDelete}>Delete this card</button><p>To keep the original scan in the audit history instead, reject the whole card.</p><button type="button" disabled={busy} onClick={onReject}>Reject whole card</button></section>
 <section><h3>2. Existing transfer not completed</h3><p>Open Pulse → Vehicle Transfer, find the existing request for this equipment, and complete its pending source approval, destination verification or acceptance. Do not create a duplicate request.</p><a href="https://pulse.cmll.in/" target="_blank" rel="noreferrer" aria-disabled={busy} onClick={event=>{if(busy)event.preventDefault();else onTransfer()}}>Process existing transfer in Pulse</a><p>The card stays unapproved until Pulse confirms the selected site.</p></section>
 <footer><button type="button" disabled={busy} onClick={onRecheck}>Recheck Pulse assignment</button><button type="button" disabled={busy} onClick={onReview}>Review highlighted card</button></footer></dialog>;
}
