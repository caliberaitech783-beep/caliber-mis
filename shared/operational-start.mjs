export const OPERATIONAL_START='2026-11-01';
export const OPERATIONAL_START_MESSAGE='Operations start on 1 November 2026. Earlier dates and testing data are locked for all users.';
export function operationalDate(value){
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value&&value>=OPERATIONAL_START;
}
export function requireOperationalDate(value){
 if(!operationalDate(value))throw Object.assign(new Error(OPERATIONAL_START_MESSAGE),{status:400});
 return value;
}
// A scan card belongs to the operational period by the date the operator chose for
// its scan entry (Scan setup / VLB batch), never by the date the reader extracted
// from the handwriting. A misread header (11-01 for 01-11, a wrong year, a 31-10
// night card) must surface as a "Mismatch card" inside its entry; it must not
// silently drop the card out of the entry, the batch counts and the duplicate
// check, which made every rescan report the same cards as "new" and show 0/0.
// Legacy scanner drafts may use lossless UTF-8 JSON envelopes; their card date is
// used only for cards with no saved record and no scan-entry date, before the
// upload date for unread, undated pages.
export function operationalScanSql(alias){
 if(!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(alias))throw Error('Invalid SQL alias');
 const draft=`(CASE WHEN ${alias}.draft ? '__caliberUtf8JsonV1' THEN convert_from(decode(${alias}.draft->>'__caliberUtf8JsonV1','base64'),'UTF8')::jsonb ELSE ${alias}.draft END)`;
 return `COALESCE((SELECT ol.book_date::text FROM mis_log_books ol WHERE ol.id=${alias}.logbook_id),(SELECT NULLIF(ob.expected_context->>'bookDate','') FROM mis_scan_batches ob WHERE ob.id=${alias}.batch_id),NULLIF(${draft}->>'bookDate',''),to_char(${alias}.created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD')) >= '${OPERATIONAL_START}'`;
}
