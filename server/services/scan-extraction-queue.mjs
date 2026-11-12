import {operationalScanSql} from '../../shared/operational-start.mjs';
import {randomUUID} from 'node:crypto';
// Keep interactive uploads ahead of automatic repair work and share workers
// between batches instead of draining every old card before a new batch starts.
//
// Leases: a reader that claims a card holds it for READ_LEASE_SECONDS and
// renews the hold while it works. A card whose hold ran out (its reader
// stopped or crashed) goes back to the queue; a card another reader still holds
// is never taken away, so restarting one process no longer sends every card
// being read anywhere back for a second Gemini read.
export const READ_LEASE_SECONDS=120;
export const ENGINE_LIVE_SECONDS=60;
export const SCAN_QUEUE_SCHEMA=`
 ALTER TABLE mis_scan_batches ADD COLUMN IF NOT EXISTS extraction_requested_at TIMESTAMPTZ;
 ALTER TABLE mis_scan_batches ADD COLUMN IF NOT EXISTS extraction_last_started_at TIMESTAMPTZ;
`;
// Runs after mis_scan_cards exists.
export const SCAN_LEASE_SCHEMA=`
 ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS read_lease_owner TEXT;
 ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS read_lease_until TIMESTAMPTZ;
 CREATE TABLE IF NOT EXISTS mis_scan_engines(
  owner TEXT PRIMARY KEY,
  site_lane TEXT,
  excluded_lanes TEXT[] NOT NULL DEFAULT '{}',
  version TEXT NOT NULL DEFAULT '',
  key_source TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  beat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reading INTEGER NOT NULL DEFAULT 0,
  read_total INTEGER NOT NULL DEFAULT 0
 );
`;
// Identifies this process as the holder of the cards it reads.
export const processLeaseOwner=`${process.env.WEBSITE_INSTANCE_ID?.slice(0,12)||'local'}:${process.pid}:${randomUUID().slice(0,8)}`;
// Where a card's time went, kept with the card (raw_fields.scanTiming) so a slow
// day can be explained afterwards. Milliseconds:
//   queuedMs   from upload (or the last retry's row) until a reader took the card
//   firstReadMs  the first read: preparing the pictures and Gemini's answer
//   recheckMs  the door and field recheck, which is a second Gemini read
//   finishMs   matching against the masters, estimates and saving the result
// workers is how many cards the lane was reading when this one finished.
export function scanReadTiming(createdAt,{claimedAt,firstReadAt,recheckedAt},finishedAt,{workers=0,engine=false}={}){
 const created=createdAt instanceof Date?createdAt.getTime():Date.parse(createdAt),span=(from,to)=>Number.isFinite(from)&&Number.isFinite(to)?Math.max(0,Math.round(to-from)):null;
 return {queuedMs:span(created,claimedAt),firstReadMs:span(claimedAt,firstReadAt),recheckMs:span(firstReadAt,recheckedAt),finishMs:span(recheckedAt,finishedAt),totalMs:span(claimedAt,finishedAt),finishedAt:new Date(finishedAt).toISOString(),workers,engine};
}
export const scanQueueBackground=alias=>`(${alias}.raw_fields->>'scanQueueOrigin'='repair' OR (COALESCE(${alias}.raw_fields->>'scanQueueOrigin','')='' AND ${alias}.raw_fields->>'equipmentNumberRecoveryVersion'='1'))`;
export async function requestScanBatch(pool,batchId){
 return pool.query(`UPDATE mis_scan_batches b SET extraction_requested_at=NOW()
 WHERE b.id=$1 AND (b.extraction_requested_at IS NULL OR b.extraction_requested_at<NOW()-INTERVAL '15 seconds')
 AND EXISTS(SELECT 1 FROM mis_scan_cards c WHERE c.batch_id=b.id AND c.status='queued')`,[batchId]);
}
// batchIds limits the claim to one lane's batches; null claims from any batch.
export async function claimNextScanCard(pool,{batchIds=null,owner=processLeaseOwner}={}){
 return pool.query(`WITH active_counts AS (
  SELECT batch_id,count(*) AS n FROM mis_scan_cards WHERE status='reading' GROUP BY batch_id
 ), picked AS (
  SELECT c.id,c.batch_id FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id
  LEFT JOIN active_counts active ON active.batch_id=c.batch_id
  WHERE c.status='queued' AND ${operationalScanSql('c')}
  AND ($1::text[] IS NULL OR c.batch_id::text=ANY($1::text[]))
  ORDER BY CASE WHEN b.extraction_requested_at>NOW()-INTERVAL '30 seconds' THEN 0 ELSE 1 END,
   CASE WHEN ${scanQueueBackground('c')} THEN 1 ELSE 0 END,
   COALESCE(active.n,0),
   b.extraction_last_started_at ASC NULLS FIRST,b.created_at DESC,c.created_at,c.ordinal,c.id
  LIMIT 1 FOR UPDATE OF c SKIP LOCKED
 ), touched AS (
  UPDATE mis_scan_batches b SET extraction_last_started_at=clock_timestamp()
  FROM picked p WHERE b.id=p.batch_id RETURNING b.id
 )
 UPDATE mis_scan_cards c SET status='reading',read_lease_owner=$2,read_lease_until=clock_timestamp()+make_interval(secs=>${READ_LEASE_SECONDS}),
  raw_fields=COALESCE(c.raw_fields,'{}'::jsonb)||jsonb_build_object('scanReadToken',gen_random_uuid()::text)
 FROM picked p,touched b WHERE c.id=p.id AND c.batch_id=b.id AND c.status='queued'
 RETURNING c.*`,[batchIds?batchIds.map(String):null,owner]);
}
// Batches that have cards waiting, with their site, for lane assignment.
export async function queuedScanBatches(pool){
 return (await pool.query(`SELECT b.id AS batch_id,b.expected_context->>'location' AS location
 FROM mis_scan_batches b WHERE EXISTS(SELECT 1 FROM mis_scan_cards c WHERE c.batch_id=b.id AND c.status='queued' AND ${operationalScanSql('c')})`)).rows;
}
// Keep the hold on every card this process is still reading.
export async function renewReadLeases(pool,owner=processLeaseOwner){
 return pool.query(`UPDATE mis_scan_cards SET read_lease_until=clock_timestamp()+make_interval(secs=>${READ_LEASE_SECONDS}) WHERE status='reading' AND read_lease_owner=$1`,[owner]);
}
// Put back cards whose reader stopped renewing. Cards claimed before leases
// existed carry no lease and are treated as abandoned.
export async function requeueExpiredReads(pool){
 return pool.query(`UPDATE mis_scan_cards SET status='queued',read_lease_owner=NULL,read_lease_until=NULL
 WHERE status='reading' AND (read_lease_until IS NULL OR read_lease_until<clock_timestamp())`);
}
// On a clean stop, hand this process's unfinished cards straight back so the
// next reader starts them at once instead of waiting for the hold to run out.
export async function releaseReadLeases(pool,owner=processLeaseOwner){
 return pool.query(`UPDATE mis_scan_cards SET status='queued',read_lease_owner=NULL,read_lease_until=NULL WHERE status='reading' AND read_lease_owner=$1`,[owner]);
}
export async function beatScanEngine(pool,{owner=processLeaseOwner,siteLane=null,excludedLanes=[],version='',keySource='',reading=0,readTotal=0}={}){
 return pool.query(`INSERT INTO mis_scan_engines(owner,site_lane,excluded_lanes,version,key_source,reading,read_total) VALUES($1,$2,$3::text[],$4,$5,$6,$7)
 ON CONFLICT(owner) DO UPDATE SET beat_at=NOW(),site_lane=EXCLUDED.site_lane,excluded_lanes=EXCLUDED.excluded_lanes,version=EXCLUDED.version,key_source=EXCLUDED.key_source,reading=EXCLUDED.reading,read_total=EXCLUDED.read_total`,
 [owner,siteLane,excludedLanes,version,keySource,reading,readTotal]);
}
export async function removeScanEngine(pool,owner=processLeaseOwner){return pool.query('DELETE FROM mis_scan_engines WHERE owner=$1',[owner]);}
export async function pruneScanEngines(pool){return pool.query(`DELETE FROM mis_scan_engines WHERE beat_at<NOW()-INTERVAL '1 day'`);}
export async function liveScanEngines(pool){
 return (await pool.query(`SELECT owner,site_lane,excluded_lanes,version,key_source,started_at,beat_at,reading,read_total FROM mis_scan_engines WHERE beat_at>NOW()-make_interval(secs=>${ENGINE_LIVE_SECONDS}) ORDER BY site_lane NULLS LAST,owner`)).rows;
}
