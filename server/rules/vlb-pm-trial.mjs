export const VLB_PM_TRIAL_ID='vlb-pm-trial-20261112';
// A durable row prevents restarts and redeploys from extending the pause.
export async function activateVlbPmTrial(pool){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('mis_vlb_saved_batches'))");
  await client.query(
   "INSERT INTO mis_vlb_pm_trials(id,started_at,ends_at) VALUES($1,statement_timestamp(),statement_timestamp()+INTERVAL '720 hours') ON CONFLICT DO NOTHING",
   [VLB_PM_TRIAL_ID]
  );
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
export async function vlbPmTrial(client){
 const row=(await client.query('SELECT ends_at,started_at<=clock_timestamp() AND clock_timestamp()<ends_at AS active FROM mis_vlb_pm_trials WHERE id=$1',[VLB_PM_TRIAL_ID])).rows[0];
 return {active:row?.active===true,endsAt:row?.ends_at||null};
}
