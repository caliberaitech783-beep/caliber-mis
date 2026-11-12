import {operationalScanSql} from '../../shared/operational-start.mjs';
import {scanLaneOf} from './scan-lanes.mjs';

// Reader outage: the reading account failed, not the card.
//
// When Google refuses a request because the account has no credit (HTTP 402),
// the key is refused (401/403, or 400 "API key not valid") or the quota is used
// up (429), every card would fail the same way. Marking each card "Error" told
// the operator that 40 cards were bad, hid the real reason, and left them to
// press Retry on every card after the account was put right.
//
// Instead the card goes back to the queue, the lane stops reading, one card is
// tried every OUTAGE_PROBE_MS, and reading carries on by itself as soon as
// Google accepts a request again. The outage is written to the database so the
// scan screen (served by Pulse-II) can say why cards are waiting even when a
// separate scan engine does the reading.
export const OUTAGE_PROBE_MS=60000;
// A row nobody has refreshed for this long belongs to a reader that stopped.
export const OUTAGE_STALE_SECONDS=600;
export const READER_OUTAGE_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_scan_reader_outages(
  lane TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  http_status INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  since TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alerted_at TIMESTAMPTZ
 );
`;
// Card errors written before cards were held: the same account failures.
export const OUTAGE_ERROR_PATTERN='^Gemini extraction failed \\(HTTP (401|402|403|429)\\)';

// null = a failure of this card; otherwise why the reading account failed.
export function readerOutage(error){
 if(!error||error.provider!=='gemini')return null;
 const message=String(error.message||''),detail=String(error.upstream||'').replace(/\s+/g,' ').trim().slice(0,300);
 const status=Number(error.status)||Number(/Gemini extraction failed \(HTTP (\d{3})\)/.exec(message)?.[1])||0;
 const reason=status===402?'billing':status===429?'quota':[401,403].includes(status)?'key':status===400&&/api[ _-]?key/i.test(detail)?'key':'';
 return reason?{reason,status,detail}:null;
}

// The single shared queue has no lane name; it is stored as '*'.
export const outageLaneKey=name=>name===null||name===undefined?'*':String(name);

const fresh=alias=>`${alias}.checked_at>NOW()-make_interval(secs=>${OUTAGE_STALE_SECONDS})`;

// Record (or refresh) the outage. A stale row is a new outage: it starts again.
export async function noteReaderOutage(pool,laneName,outage,owner=''){
 return pool.query(`INSERT INTO mis_scan_reader_outages AS o(lane,reason,http_status,detail,owner) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(lane) DO UPDATE SET reason=EXCLUDED.reason,http_status=EXCLUDED.http_status,detail=EXCLUDED.detail,owner=EXCLUDED.owner,
  since=CASE WHEN ${fresh('o')} THEN o.since ELSE NOW() END,
  alerted_at=CASE WHEN ${fresh('o')} THEN o.alerted_at ELSE NULL END,
  checked_at=NOW()`,[outageLaneKey(laneName),outage.reason,outage.status||0,outage.detail||'',owner]);
}
export async function clearReaderOutage(pool,laneName){
 return pool.query('DELETE FROM mis_scan_reader_outages WHERE lane=$1',[outageLaneKey(laneName)]);
}
const publicOutage=row=>({lane:row.lane,reason:row.reason,httpStatus:row.http_status,since:row.since,checkedAt:row.checked_at});
export async function liveReaderOutages(pool){
 return (await pool.query(`SELECT o.lane,o.reason,o.http_status,o.detail,o.since,o.checked_at FROM mis_scan_reader_outages o WHERE ${fresh('o')} ORDER BY o.since`)).rows.map(row=>({...publicOutage(row),detail:row.detail}));
}
// The outage that holds this site's cards, if any: its own lane or the shared queue.
export async function readerOutageFor(pool,location){
 const row=(await pool.query(`SELECT o.lane,o.reason,o.http_status,o.since,o.checked_at FROM mis_scan_reader_outages o WHERE o.lane=ANY($1::text[]) AND ${fresh('o')} ORDER BY o.since LIMIT 1`,[[scanLaneOf(location),'*']])).rows[0];
 return row?publicOutage(row):null;
}
// Outages the administrators have not been told about yet (or not for three
// hours). A quota pause often clears within minutes, so it is reported only
// once it has lasted ten. Claiming marks the row, so two servers never both send.
export async function claimOutageAlerts(pool){
 return (await pool.query(`UPDATE mis_scan_reader_outages o SET alerted_at=NOW()
 WHERE ${fresh('o')} AND (o.alerted_at IS NULL OR o.alerted_at<NOW()-INTERVAL '3 hours')
 AND (o.reason<>'quota' OR o.since<NOW()-INTERVAL '10 minutes')
 RETURNING o.lane,o.reason,o.http_status,o.detail,o.since,o.checked_at`)).rows.map(row=>({...publicOutage(row),detail:row.detail}));
}
// Cards that were marked failed for an account reason go back to the queue.
// Called only after a card was read successfully, so it never loops while the
// account is still refused; recent cards only, never a deleted entry.
export async function requeueOutageFailures(pool){
 return pool.query(`UPDATE mis_scan_cards c SET status='queued',error='',revision=c.revision+1,
  raw_fields=COALESCE(c.raw_fields,'{}'::jsonb)||jsonb_build_object('scanQueueOrigin','reader-outage')
 FROM mis_scan_batches b
 WHERE b.id=c.batch_id AND c.status='error' AND c.checked_by IS NULL AND c.error ~ $1
 AND c.created_at>NOW()-INTERVAL '7 days' AND ${operationalScanSql('c')}
 AND NOT(COALESCE(b.expected_context,'{}'::jsonb) ?| ARRAY['deletedVlbBatch','deletedScanEntry'])
 RETURNING c.id`,[OUTAGE_ERROR_PATTERN]);
}
