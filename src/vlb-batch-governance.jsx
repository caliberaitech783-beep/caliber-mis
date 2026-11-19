import React from 'react';
import TableSmartPrint from './table-smart-print.jsx';

// Owner, 18 Nov 2026: reopening needs no site PM approval, so there are no requests to show.
export default function VlbBatchGovernance({batch,actor,onManual,onScan,onRequestReopen}){
 return <section className="logbook-section vlb-batch-governance">
  {batch?.trialExpired&&<p role="alert">This reopened batch has expired. Save and lock it, then reopen it to continue.</p>}
  {batch&&<><h2>Batch permissions</h2>{!batch.closed_at&&<div className="vlb-batch-actions">{onManual&&<button type="button" onClick={()=>onManual(batch)}>Manual entry</button>}{onScan&&<button type="button" onClick={()=>onScan(batch)}>Scan / Upload files</button>}</div>}{batch.amendment_by&&!batch.closed_at&&<><p>Reopened. Only {batch.amendment_by} may add or change cards. {batch.continuous_entry?"Continue until Save & lock batch is selected.":"The next successful save locks this batch again."}</p>{batch.amendment_by===actor?.login&&<><p>Save additional cards for this batch's site, date and shift. To correct an existing card, select View VLB in this batch report under the Edit tab.</p><div className="vlb-batch-actions">{onManual&&<button type="button" onClick={onManual}>Open VLB Manual</button>}{onScan&&<button type="button" onClick={onScan}>Open VLB Scan</button>}</div></>}</>}
   {batch.closed_at&&<p>This batch is locked. Reopen it to add cards or change saved cards.</p>}
   {batch.canRequestReopen&&<button type="button" onClick={onRequestReopen}>Reopen batch</button>}
  </>}
  {batch?.audit?.length>0&&<details><summary>Batch audit history</summary><TableSmartPrint row title={'Batch audit history · '+batch.name}/><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr></thead><tbody>{batch.audit.map(event=><tr key={event.id}><td>{new Date(event.occurred_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</td><td>{event.actor}</td><td>{event.action.replaceAll('_',' ')}</td><td>{event.detail.reason||event.detail.note||event.detail.after?.book_no||event.detail.approvedBy||'—'}{event.detail.before&&<details><summary>Before / after values</summary>{Object.keys(event.detail.after?.data||{}).filter(key=>JSON.stringify(event.detail.before.data?.[key])!==JSON.stringify(event.detail.after.data[key])).map(key=><p key={key}>{key.replace(/([A-Z])/g,' $1')}: {JSON.stringify(event.detail.before.data?.[key])??'—'} → {JSON.stringify(event.detail.after.data[key])}</p>)}</details>}</td></tr>)}</tbody></table></div></details>}
 </section>;
}
