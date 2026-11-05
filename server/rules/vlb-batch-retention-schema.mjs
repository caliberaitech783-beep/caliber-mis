// Only explicitly approved whole-batch deletions enter this recovery store.
export const VLB_BATCH_RETENTION_SCHEMA=`
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS deleted_by TEXT;
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS restore_until TIMESTAMPTZ;
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS deleted_counts JSONB;
 CREATE TABLE IF NOT EXISTS mis_vlb_batch_recovery_items(
 batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id),kind TEXT NOT NULL,item_key TEXT NOT NULL,payload JSONB NOT NULL,
 PRIMARY KEY(batch_id,kind,item_key));
 CREATE TABLE IF NOT EXISTS mis_vlb_batch_deletions(
 id UUID PRIMARY KEY,actor TEXT NOT NULL,reason TEXT NOT NULL,operation TEXT NOT NULL,
 batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id),replacement_id UUID,
 manifest JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '10 minutes',
 otp_hash TEXT,otp_requested_at TIMESTAMPTZ,delivered_at TIMESTAMPTZ,attempts INTEGER NOT NULL DEFAULT 0,completed_at TIMESTAMPTZ);
 CREATE TABLE IF NOT EXISTS mis_vlb_deleted_scan_uploads(
 scan_batch_id UUID PRIMARY KEY,batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id));
 CREATE OR REPLACE FUNCTION mis_vlb_guard_deleted_scan_upload() RETURNS trigger LANGUAGE plpgsql AS $scan_guard$
 DECLARE upload_id UUID;
 BEGIN
  IF TG_TABLE_NAME='mis_scan_cards' THEN upload_id=NEW.batch_id; ELSE upload_id=NEW.id; END IF;
  IF EXISTS(SELECT 1 FROM mis_vlb_deleted_scan_uploads WHERE scan_batch_id=upload_id) THEN
   RAISE EXCEPTION 'This scan upload belongs to a deleted VLB batch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END $scan_guard$;
 DO $install_scan_guard$ BEGIN
  IF to_regclass('mis_scan_cards') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='mis_vlb_deleted_scan_guard') THEN
   CREATE TRIGGER mis_vlb_deleted_scan_guard BEFORE INSERT OR UPDATE ON mis_scan_cards FOR EACH ROW EXECUTE FUNCTION mis_vlb_guard_deleted_scan_upload();
  END IF;
  IF to_regclass('mis_scan_batches') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='mis_vlb_deleted_upload_guard') THEN
   CREATE TRIGGER mis_vlb_deleted_upload_guard BEFORE UPDATE ON mis_scan_batches FOR EACH ROW EXECUTE FUNCTION mis_vlb_guard_deleted_scan_upload();
  END IF;
 END $install_scan_guard$;
 CREATE TABLE IF NOT EXISTS mis_vlb_batch_blob_cleanup(
 batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id),blob_key TEXT NOT NULL,image_hash TEXT NOT NULL,
 completed_at TIMESTAMPTZ,error TEXT NOT NULL DEFAULT '',PRIMARY KEY(batch_id,blob_key));
`;
