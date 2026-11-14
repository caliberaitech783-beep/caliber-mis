// Scanned cards that belong to a batch's site/date/shift but are not saved yet.
//
// A batch counts only saved log-book records. Cards still being read, waiting in review or
// failed sit in their scan entry and are invisible to the batch. On 14 Nov 2026 Dudhichua East
// 4 Nov C shift was locked and closed with 42 such cards (about 430 trips) never saved, and a
// locked batch refuses late cards. So every stage step now refuses while any card is waiting:
// Lock VLB (trip cards), Lock LMV (trip + LMV cards) and Close (every kind, ELB job cards too).
// A wrong or repeated card is deleted from its scan entry; while VLB is open that needs no OTP.
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {bookShiftCode} from '../../shared/trip-card-rules.mjs';

export const WAITING_SCAN_STATUSES=['queued','reading','review','approved','error'];
// Kept equal to EXACT_DUPLICATE_NOTE and REMOVED_FROM_BATCH_NOTE in services/scan-duplicates.mjs.
const SKIPPED_NOTES=['Exact duplicate upload skipped automatically','Removed from batch: wrong date, site or shift'];
const BOOK_LABEL={vlb:'trip card',lmv:'LMV card',elb:'ELB job card'};

export function scanEntryBook(kind,context){
 if(kind==='equipment')return 'elb';
 return context?.logBookKind==='lmv'?'lmv':'vlb';
}

// One row per scan entry with waiting cards, oldest entry first.
export async function readWaitingScans(client,{site,date,shift}){
 // The scan tables are created by the scanning routes. A server or test without scanning has none,
 // and then nothing can be waiting. (Checked first: a failed query would abort the transaction.)
 if(!(await client.query("SELECT to_regclass('mis_scan_cards') IS NOT NULL AND to_regclass('mis_scan_batches') IS NOT NULL AS ready")).rows[0]?.ready)return [];
 const {rows}=await client.query(`SELECT b.id,b.name,b.kind,b.expected_context AS context,
   count(c.id)::int AS waiting,
   count(c.id) FILTER(WHERE c.status IN('queued','reading'))::int AS reading,
   count(c.id) FILTER(WHERE c.status='error')::int AS failed
  FROM mis_scan_batches b JOIN mis_scan_cards c ON c.batch_id=b.id
  WHERE b.expected_context->>'bookDate'=$1
   AND COALESCE(b.expected_context->>'cancelled','false')<>'true'
   AND NOT(b.expected_context ?| ARRAY['deletedVlbBatch','deletedScanEntry'])
   AND c.status=ANY($2::text[]) AND c.duplicate_of IS NULL
   AND c.review_note<>ALL($3::text[]) AND c.review_note NOT LIKE 'Card deleted manually by user%'
   AND NOT(COALESCE(c.raw_fields,'{}'::jsonb) ? 'manualDeletion')
  GROUP BY b.id ORDER BY min(b.created_at),b.id`,[date,WAITING_SCAN_STATUSES,SKIPPED_NOTES]);
 const wanted=canonicalSiteName(site);
 return rows.filter(row=>canonicalSiteName(row.context?.location)===wanted&&bookShiftCode(row.context?.cardShift)===shift)
  .map(row=>({id:row.id,name:row.name,book:scanEntryBook(row.kind,row.context),waiting:row.waiting,reading:row.reading,failed:row.failed}));
}

const pages=entries=>entries.map(entry=>{
 const parts=[];if(entry.reading)parts.push(entry.reading+' still reading');if(entry.failed)parts.push(entry.failed+' failed');
 return entry.waiting+' in '+entry.name+(parts.length?' ('+parts.join(', ')+')':'');
}).join('; ');

// The blocker sentence for one stage step, or '' when nothing waits.
export function waitingScanBlocker(entries=[],books,action){
 const listed=entries.filter(entry=>books.includes(entry.book));
 if(!listed.length)return '';
 const total=listed.reduce((sum,entry)=>sum+entry.waiting,0);
 const kinds=[...new Set(listed.map(entry=>BOOK_LABEL[entry.book]))].join(' / ');
 return `${total} scanned ${kinds}${total===1?'':'s'} not saved yet: ${pages(listed)}. Save or delete each card in its scan entry before ${action}.`;
}
export const vlbLockScanBlocker=entries=>waitingScanBlocker(entries,['vlb'],'locking VLB');
export const lmvLockScanBlocker=entries=>waitingScanBlocker(entries,['vlb','lmv'],'locking LMV');
export const closeScanBlocker=entries=>waitingScanBlocker(entries,['vlb','lmv','elb'],'closing the batch');
