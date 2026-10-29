// Retry only the known per-field response-format failures after deploying the parser fix.
// The existing re-extraction merge keeps nonempty manual corrections.
export async function recoverMalformedScanCards(pool){
 return pool.query(`UPDATE mis_scan_cards
 SET raw_fields=raw_fields||jsonb_build_object('reextractPrevious',draft),
     status='queued',revision=revision+1,error=''
 WHERE status='error' AND checked_by IS NULL AND logbook_id IS NULL
   AND error LIKE 'Invalid Priority A field:%'
 RETURNING id`);
}
