// Keep interactive uploads ahead of automatic repair work and share workers
// between batches instead of draining every old card before a new batch starts.
export const SCAN_QUEUE_SCHEMA=`
 ALTER TABLE mis_scan_batches ADD COLUMN IF NOT EXISTS extraction_requested_at TIMESTAMPTZ;
 ALTER TABLE mis_scan_batches ADD COLUMN IF NOT EXISTS extraction_last_started_at TIMESTAMPTZ;
`;
export const scanQueueBackground=alias=>`(${alias}.raw_fields->>'scanQueueOrigin'='repair' OR (COALESCE(${alias}.raw_fields->>'scanQueueOrigin','')='' AND ${alias}.raw_fields->>'equipmentNumberRecoveryVersion'='1'))`;
export async function requestScanBatch(pool,batchId){
 return pool.query(`UPDATE mis_scan_batches b SET extraction_requested_at=NOW()
 WHERE b.id=$1 AND (b.extraction_requested_at IS NULL OR b.extraction_requested_at<NOW()-INTERVAL '15 seconds')
 AND EXISTS(SELECT 1 FROM mis_scan_cards c WHERE c.batch_id=b.id AND c.status='queued')`,[batchId]);
}
export async function claimNextScanCard(pool){
 return pool.query(`WITH picked AS (
  SELECT c.id,c.batch_id FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id
  WHERE c.status='queued'
  ORDER BY CASE WHEN b.extraction_requested_at>NOW()-INTERVAL '30 seconds' THEN 0 ELSE 1 END,
   CASE WHEN ${scanQueueBackground('c')} THEN 1 ELSE 0 END,
   (SELECT count(*) FROM mis_scan_cards active WHERE active.batch_id=c.batch_id AND active.status='reading'),
   b.extraction_last_started_at ASC NULLS FIRST,b.created_at DESC,c.created_at,c.ordinal,c.id
  LIMIT 1 FOR UPDATE OF c SKIP LOCKED
 ), touched AS (
  UPDATE mis_scan_batches b SET extraction_last_started_at=clock_timestamp()
  FROM picked p WHERE b.id=p.batch_id RETURNING b.id
 )
 UPDATE mis_scan_cards c SET status='reading'
 FROM picked p,touched b WHERE c.id=p.id AND c.batch_id=b.id AND c.status='queued'
 RETURNING c.*`);
}
