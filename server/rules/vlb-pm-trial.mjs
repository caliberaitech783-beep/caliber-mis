import {auditVlbBatch,batchFail} from './vlb-batch-policy.mjs';
export const VLB_PM_TRIAL_ID='vlb-pm-trial-20261031';
// Explicit production opt-in; a durable row prevents redeploys extending the trial.
export async function activateVlbPmTrial(pool){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('mis_vlb_saved_batches'))");
  const inserted=await client.query("INSERT INTO mis_vlb_pm_trials(id,started_at,ends_at) VALUES($1,statement_timestamp(),statement_timestamp()+INTERVAL '240 hours') ON CONFLICT DO NOTHING RETURNING *",[VLB_PM_TRIAL_ID]);
  if(inserted.rows.length){
   const requests=(await client.query("SELECT r.*,b.name FROM mis_vlb_reopen_requests r JOIN mis_vlb_batches b ON b.id=r.batch_id WHERE regexp_replace(b.name,'[[:space:]]','','g')='CMLL/JAYANTOC/30TH-OCT-26/S3/B01' AND r.status='pending' AND r.withdrawn_at IS NULL FOR UPDATE OF r")).rows;
   if(requests.length!==1)batchFail('Trial activation requires exactly one pending request for the approved Jayant batch. No trial or request was changed.');
   const request=requests[0];
   await client.query("UPDATE mis_vlb_reopen_requests SET status='rejected',withdrawn_at=NOW(),decided_by='owner-authorized-trial',decision_note='Withdrawn at owner request for the 10-day VLB trial',decided_at=NOW() WHERE id=$1",[request.id]);
   await auditVlbBatch(client,{id:request.batch_id},'owner-authorized-trial','reopen_request_withdrawn',{requestId:request.id,requestedBy:request.requested_by,reason:request.reason,trialId:VLB_PM_TRIAL_ID});
  }
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
export async function vlbPmTrial(client){
 const row=(await client.query('SELECT ends_at,started_at<=clock_timestamp() AND clock_timestamp()<ends_at AS active FROM mis_vlb_pm_trials WHERE id=$1',[VLB_PM_TRIAL_ID])).rows[0];
 return {active:row?.active===true,endsAt:row?.ends_at||null};
}
