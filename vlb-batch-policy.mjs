import {canonicalSiteName} from './site-location.mjs';
import {vlbRecordShift} from './vlb-batch-format.mjs';

export const VLB_BATCH_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_vlb_batches(
 id UUID PRIMARY KEY,name TEXT UNIQUE NOT NULL,site TEXT NOT NULL,book_date DATE NOT NULL,shift TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence>0),created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 closed_at TIMESTAMPTZ,request_key UUID UNIQUE NOT NULL,UNIQUE(site,book_date,shift,sequence));
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS amendment_by TEXT;
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS closure_revision INTEGER NOT NULL DEFAULT 0;
 -- Preserve the legacy per-user open-slot index. Admin batches use creator_login
 -- for attribution and a NULL legacy slot so different authorized sites can stay open.
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS creator_login TEXT;
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
 ALTER TABLE mis_vlb_batches ALTER COLUMN created_by DROP NOT NULL;
 CREATE UNIQUE INDEX IF NOT EXISTS mis_vlb_one_open_batch_per_user ON mis_vlb_batches(created_by) WHERE closed_at IS NULL;
 CREATE TABLE IF NOT EXISTS mis_vlb_batch_entries(
 batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id),logbook_id BIGINT PRIMARY KEY REFERENCES mis_log_books(id),snapshot JSONB NOT NULL);
 CREATE INDEX IF NOT EXISTS mis_vlb_batch_entries_batch ON mis_vlb_batch_entries(batch_id);
 CREATE TABLE IF NOT EXISTS mis_vlb_batch_scopes(
 site TEXT NOT NULL,book_date DATE NOT NULL,shift TEXT NOT NULL,batch_id UUID UNIQUE NOT NULL REFERENCES mis_vlb_batches(id),PRIMARY KEY(site,book_date,shift));
 INSERT INTO mis_vlb_batch_scopes(site,book_date,shift,batch_id)
 SELECT site,book_date,shift,(array_agg(id))[1] FROM mis_vlb_batches GROUP BY site,book_date,shift HAVING count(*)=1 ON CONFLICT DO NOTHING;
 CREATE OR REPLACE FUNCTION mis_vlb_prevent_duplicate_scope() RETURNS trigger LANGUAGE plpgsql AS $guard$
 BEGIN
  LOCK TABLE mis_vlb_batch_scopes IN EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM mis_vlb_batches b WHERE b.site=NEW.site AND b.book_date=NEW.book_date AND b.shift=NEW.shift AND b.id<>NEW.id) THEN
   RAISE EXCEPTION 'A batch already exists for this site, date and shift' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
 END $guard$;
 DO $install$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='mis_vlb_unique_scope_guard' AND tgrelid='mis_vlb_batches'::regclass) THEN
   CREATE TRIGGER mis_vlb_unique_scope_guard BEFORE INSERT OR UPDATE OF site,book_date,shift ON mis_vlb_batches FOR EACH ROW EXECUTE FUNCTION mis_vlb_prevent_duplicate_scope();
  END IF;
 END $install$;
 CREATE TABLE IF NOT EXISTS mis_vlb_reopen_requests(
 id UUID PRIMARY KEY,batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id),closure_revision INTEGER NOT NULL,
 requested_by TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','used')),
 requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),decided_by TEXT,decision_note TEXT,decided_at TIMESTAMPTZ,used_at TIMESTAMPTZ);
 ALTER TABLE mis_vlb_reopen_requests ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS trial_reopened_until TIMESTAMPTZ;
 CREATE TABLE IF NOT EXISTS mis_vlb_pm_trials(id TEXT PRIMARY KEY,started_at TIMESTAMPTZ NOT NULL,ends_at TIMESTAMPTZ NOT NULL,CHECK(ends_at=started_at+INTERVAL '240 hours'));
 CREATE UNIQUE INDEX IF NOT EXISTS mis_vlb_pending_reopen ON mis_vlb_reopen_requests(batch_id,requested_by,closure_revision) WHERE status='pending';
 CREATE TABLE IF NOT EXISTS mis_vlb_batch_audit(
 id BIGSERIAL PRIMARY KEY,batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id),actor TEXT NOT NULL,action TEXT NOT NULL,
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),detail JSONB NOT NULL DEFAULT '{}');
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS continuous_entry BOOLEAN NOT NULL DEFAULT FALSE;
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS saved_lock_policy BOOLEAN NOT NULL DEFAULT FALSE;
 WITH migrated AS (
  UPDATE mis_vlb_batches SET saved_lock_policy=TRUE,closed_at=COALESCE(closed_at,NOW()),amendment_by=NULL,
   closure_revision=closure_revision+CASE WHEN closed_at IS NULL THEN 1 ELSE 0 END
  WHERE saved_lock_policy=FALSE RETURNING id,created_by
 ) INSERT INTO mis_vlb_batch_audit(batch_id,actor,action,detail)
 SELECT id,created_by,'saved_lock_policy_enabled','{"reason":"Saved batches require PM approval and lock again after saving."}'::jsonb FROM migrated;`;
export const batchLogin=value=>String(value||'').trim().toLowerCase();
export const batchFail=(message,status=409)=>{throw Object.assign(new Error(message),{status})};
export const lockVlbBatchWrites=client=>client.query("SELECT pg_advisory_xact_lock(hashtext('mis_vlb_saved_batches'))");
export const auditVlbBatch=(client,batch,actor,action,detail={})=>client.query('INSERT INTO mis_vlb_batch_audit(batch_id,actor,action,detail) VALUES($1,$2,$3,$4::jsonb)',[batch.id,batchLogin(actor),action,JSON.stringify(detail)]);
export async function matchingVlbBatch(client,data){
 const {rows}=await client.query('SELECT *,book_date::text AS report_date FROM mis_vlb_batches WHERE book_date=$1 AND shift=$2 AND archived_at IS NULL ORDER BY created_at,id',[data.bookDate,vlbRecordShift(data)]);
 const matching=rows.filter(b=>canonicalSiteName(b.site)===canonicalSiteName(data.location));
 if(matching.length>1)batchFail('Multiple historical batches exist for this site/date/shift. They require separate review; no batches or cards were changed.');
 return matching[0]||null;
}
export async function assertVlbBatchWrite(client,data,actor,recordId){
 await lockVlbBatchWrites(client);
 let linked;
 if(recordId)linked=(await client.query('SELECT b.*,b.book_date::text AS report_date FROM mis_vlb_batch_entries e JOIN mis_vlb_batches b ON b.id=e.batch_id WHERE e.logbook_id=$1',[recordId])).rows[0];
 if(linked&&(canonicalSiteName(linked.site)!==canonicalSiteName(data.location)||linked.report_date!==data.bookDate||linked.shift!==vlbRecordShift(data)))batchFail('A batched card must retain its original site, date and shift.');
 const matching=await matchingVlbBatch(client,data);
 const batch=linked||matching;if(!batch)return null;
 if(batch.trial_reopened_until&&(await client.query('SELECT $1::timestamptz<=clock_timestamp() AS expired',[batch.trial_reopened_until])).rows[0].expired)batchFail('The VLB reopening trial has expired. Save and lock this batch, then request site PM approval before changing cards.',403);
 if(batch.closed_at)batchFail('This site/date/shift batch is closed. Request site PM approval and reopen the existing batch before saving or changing cards.');
 if(batch.amendment_by&&batchLogin(batch.amendment_by)!==batchLogin(actor))batchFail('This batch was reopened for another MIS user. Only the MIS user approved by the site PM can add or change cards.',403);
 return batch;
}
export async function lockSavedVlbBatches(client,actor,recordIds){
 if(!recordIds.length)return [];
 await lockVlbBatchWrites(client);
 const batches=(await client.query(`SELECT DISTINCT b.* FROM mis_vlb_batches b JOIN mis_vlb_batch_entries e ON e.batch_id=b.id
  WHERE e.logbook_id=ANY($1::bigint[]) AND b.closed_at IS NULL AND b.amendment_by IS NOT NULL AND b.continuous_entry=FALSE`,[recordIds])).rows;
 for(const batch of batches){
  if(batchLogin(batch.amendment_by)!==batchLogin(actor))batchFail('Only the approved MIS user can save this reopened batch.',403);
  await client.query('UPDATE mis_vlb_batches SET closed_at=NOW(),amendment_by=NULL,closure_revision=closure_revision+1 WHERE id=$1',[batch.id]);
  await auditVlbBatch(client,batch,actor,'saved_and_locked',{closureRevision:batch.closure_revision+1,logbookIds:recordIds});
 }
 return batches.map(batch=>batch.id);
}
export async function syncVlbBatchRecord(client,record,actor,{relock=true}={}){
 if(record.book_type!=='vehicle')return;
 const batch=await assertVlbBatchWrite(client,record.data,actor,record.id);if(!batch)return;
 const before=(await client.query('SELECT snapshot FROM mis_vlb_batch_entries WHERE logbook_id=$1',[record.id])).rows[0]?.snapshot;
 await client.query('INSERT INTO mis_vlb_batch_entries(batch_id,logbook_id,snapshot) VALUES($1,$2,$3::jsonb) ON CONFLICT(logbook_id) DO UPDATE SET snapshot=EXCLUDED.snapshot',[batch.id,record.id,JSON.stringify(record)]);
 await auditVlbBatch(client,batch,actor,before?'card_updated':'card_added',{logbookId:record.id,before:before||null,after:record});
 if(relock)await lockSavedVlbBatches(client,actor,[record.id]);
}
