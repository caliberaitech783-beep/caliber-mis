const PREFIXES=['V','E','T','S','L','H','D','G','PL','VPC','TPC','SPC','LPC'];
// Re-read untouched trip extractions once after the M/NO schema fix.
// Header corrections are retained by the existing re-extraction merge.
export async function recoverMissingEquipmentNumbers(pool){
 return pool.query(`UPDATE mis_scan_cards c
 SET raw_fields=c.raw_fields||jsonb_build_object('reextractPrevious',c.draft,'equipmentNumberRecoveryVersion',1),
     status='queued',revision=c.revision+1,error=''
 FROM mis_scan_batches b
 WHERE b.id=c.batch_id AND b.kind='vehicle'
   AND c.status IN('review','error') AND c.checked_by IS NULL AND c.logbook_id IS NULL
   AND c.raw_fields ? 'gemini'
   AND COALESCE(c.raw_fields->>'equipmentNumberRecoveryVersion','')<>'1'
   AND c.draft->'trips'=c.raw_fields->'extractionDraft'->'trips'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.draft->'trips')='array' THEN c.draft->'trips' ELSE '[]'::jsonb END) trip
     WHERE upper(btrim(trip->>'equipmentName'))=ANY($1::text[]))
 RETURNING c.id`,[PREFIXES]);
}
