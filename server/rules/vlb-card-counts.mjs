// Count saved VLB records, not scan images or retained deletion snapshots.
// Keep this predicate shared by the list, detail and lightweight count endpoint.
export const ACTIVE_VLB_ENTRY_FROM='mis_vlb_batch_entries e JOIN mis_log_books l ON l.id=e.logbook_id';
export const ACTIVE_VLB_ENTRY_FILTER="l.deleted_at IS NULL AND l.book_type='vehicle' AND l.book_date>=$$2026-11-01$$";
export async function readVlbCardCounts(client,batchId){
 const {rows}=await client.query(`SELECT count(*)::int AS entry_count,
 count(*) FILTER(WHERE COALESCE(e.snapshot->'data'->>'scanCardId','')='')::int AS manual_count,
 count(*) FILTER(WHERE COALESCE(e.snapshot->'data'->>'scanCardId','')<>'')::int AS scan_count
 FROM ${ACTIVE_VLB_ENTRY_FROM} WHERE e.batch_id=$1 AND ${ACTIVE_VLB_ENTRY_FILTER}`,[batchId]);
 return {batchId,entry_count:rows[0].entry_count,manual_count:rows[0].manual_count,scan_count:rows[0].scan_count};
}
