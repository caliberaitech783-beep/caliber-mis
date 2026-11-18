import {operationalScanSql} from '../../shared/operational-start.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {cardMachineKey,separatorCorrectedKey} from '../../shared/scan-machine-rules.mjs';
import {decodeScanRow} from '../rules/scan-text-storage.mjs';
import {fingerprintScanImage,closestFingerprint,scanFingerprintSettings} from './scan-fingerprint.mjs';
import {isMultiSheet} from '../../shared/trip-card-sheet.mjs';
import {fingerprintInWorker} from './scan-fingerprint-pool.mjs';
import {vlbRecordShift} from '../../shared/vlb-batch-format.mjs';
import {shareCardOperator} from '../../shared/log-book-shared-shift.mjs';

// Rule (owner, 15 November 2026): a driver or operator who works one shift and then continues
// into another shift of the same day (Shift 1, then Shift 2 or any other shift) is on overtime,
// not a duplicate. A saved card with the same card number, door and date is therefore not a
// duplicate when it belongs to another shift, carries the same driver or operator, and its meter
// readings differ (the shift was continued on the same trip card). The OT & Multiple Duties report
// counts the two duties as OT. Identical meter readings are still the same card saved twice.
const meterValue=value=>value==null||String(value).trim()===''?null:Math.round(Number(value)*1000);
function sameMeterReadings(left={},right={}){
 const fields=['openingHmr','closingHmr','openingKmr','closingKmr'].filter(field=>meterValue(left[field])!==null&&meterValue(right[field])!==null);
 return !fields.length||fields.every(field=>meterValue(left[field])===meterValue(right[field]));
}
const hasOperator=data=>Boolean(String(data?.employeeId??'').trim()||String(data?.caliberId??'').trim()||String(data?.operatorSplit?.secondOperatorId??'').trim());
export function isShiftContinuation(saved,current){
 if(!saved||!current)return false;
 const savedShift=vlbRecordShift(saved),currentShift=vlbRecordShift(current);
 if(!savedShift||!currentShift||savedShift===currentShift)return false;
 if(!hasOperator(saved)||!hasOperator(current)||!shareCardOperator(saved,current,{sameDummy:true}))return false;
 return !sameMeterReadings(saved,current);
}
const otherShift=(saved,current)=>{const a=vlbRecordShift(saved||{}),b=vlbRecordShift(current||{});return Boolean(a&&b&&a!==b);};
// What checkScanCard shows instead of the duplicate error.
export function continuationNote(original){
 return 'Shift continuation: the same driver/operator also worked shift '+String(original.shift).replace(/^S(?=\d)/,'')+' on this card ('+original.bookNo+'). Saved as a separate duty and counted as OT for this driver in the OT & Multiple Duties report.';
}
// The fields isShiftContinuation reads from a saved log book.
const CONTINUATION_FIELDS=['bookShiftCode','cardShift','shiftName','employeeId','caliberId','operatorSplit','openingHmr','closingHmr','openingKmr','closingKmr'];

// Duplicate scan cards. A card is a duplicate when the same paper, for the same
// card date, site and shift, already exists in any scan entry or saved log book
// that is not rejected. Duplicates are decided at upload (exact bytes, then the
// visual fingerprint), never read, never counted, and kept as rejected rows with
// duplicate_of pointing at the original so the operator can see both scans side
// by side and restore the card if the system was wrong. A card the fingerprint
// cannot decide on is read and then checked by content (date, door, card number)
// across every entry for that date, site and shift.
export const SCAN_DUPLICATE_SCHEMA=`
 ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS fingerprint JSONB;
 ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS duplicate_of UUID;
 CREATE INDEX IF NOT EXISTS mis_scan_cards_duplicate_of ON mis_scan_cards(duplicate_of) WHERE duplicate_of IS NOT NULL;
 CREATE INDEX IF NOT EXISTS mis_scan_cards_fingerprint_batch ON mis_scan_cards(batch_id) WHERE fingerprint IS NOT NULL;`;
// Automatic rejection of a read card as a content duplicate (same date, door
// and card number in another entry) is off until it has been watched on real
// batches: an operator must never see cards vanish from an entry. While off,
// checkScanCard still names the possible duplicate on the card for review.
export const contentRejectEnabled=(env=process.env)=>env.SCAN_DUPLICATE_CONTENT_REJECT==='true';
export const scanDuplicateFlags=(env=process.env)=>({fingerprint:scanFingerprintSettings(env).enabled,contentReject:contentRejectEnabled(env)});
export const EXACT_DUPLICATE_NOTE='Exact duplicate upload skipped automatically';
export const REMOVED_FROM_BATCH_NOTE='Removed from batch: wrong date, site or shift';

export function duplicateNote(original){return 'Duplicate of card '+original.ordinal+' in entry '+(original.entryName||original.batchId);}
export const cardNumberKey=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export const scanDoorValue=card=>String(card?.draft?.doorTextWritten||card?.raw_fields?.door||card?.draft?.doorText||card?.draft?.door||'').trim();
export const scanDoorKey=(card,kind)=>cardMachineKey(scanDoorValue(card),kind);

// Uploads work the fingerprint out on a worker thread (scan-fingerprint-pool.mjs)
// so a stack of uploads does not freeze the server's pages.
export async function fingerprintForUpload(image,{fingerprint=fingerprintInWorker}={}){
 try{return await fingerprint(image);}catch(error){console.error('Scan fingerprint failed:',error?.message||String(error));return null;}
}

const liveCardSql=alias=>`${operationalScanSql(alias)} AND ${alias}.duplicate_of IS NULL AND ${alias}.status NOT IN('rejected') AND (${alias}.status<>'posted' OR EXISTS(SELECT 1 FROM mis_log_books lb WHERE lb.id=${alias}.logbook_id AND lb.deleted_at IS NULL))`;

// Scan entries that share this entry's card date, site and shift (the entry itself included).
export async function sameContextBatches(client,batch){
 const context=batch.expected_context;if(!context?.bookDate)return [batch];
 const rows=(await client.query("SELECT id,name,kind,expected_context FROM mis_scan_batches WHERE kind=$1 AND expected_context->>'bookDate'=$2 AND COALESCE(expected_context->>'cardShift','')=COALESCE($3,'') AND NOT(expected_context ?| ARRAY['deletedVlbBatch','deletedScanEntry'])",[batch.kind,context.bookDate,context.cardShift||''])).rows;
 const site=canonicalSiteName(context.location);
 return rows.filter(row=>row.id===batch.id||(row.expected_context?.logBookKind||'')===(context.logBookKind||'')&&canonicalSiteName(row.expected_context?.location)===site);
}

export function originalSummary(row){return {cardId:row.id,batchId:row.batch_id,entryName:row.batch_name||null,ordinal:row.ordinal,bookNo:row.book_no||null};}

// Exact byte match anywhere in the operational period (unchanged rule, now with the entry name).
export async function findExactDuplicate(client,imageHash,excludeId=null){
 return (await client.query(`SELECT c.id,c.batch_id,b.name AS batch_name,c.ordinal,l.book_no FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id LEFT JOIN mis_log_books l ON l.id=c.logbook_id AND l.book_date>=$$2026-11-01$$ WHERE ${liveCardSql('c')} AND c.image_hash=$1 AND ($2::uuid IS NULL OR c.id<>$2) ORDER BY c.created_at,c.id LIMIT 1`,[imageHash,excludeId])).rows[0]||null;
}

// Closest fingerprint among live cards for the same date, site and shift.
export async function findVisualDuplicate(client,batch,fingerprint,settings=scanFingerprintSettings(),excludeId=null){
 if(!settings.enabled||!fingerprint)return null;
 const batches=await sameContextBatches(client,batch);
 const rows=(await client.query(`SELECT c.id,c.batch_id,b.name AS batch_name,c.ordinal,c.fingerprint,l.book_no FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id LEFT JOIN mis_log_books l ON l.id=c.logbook_id AND l.book_date>=$$2026-11-01$$ WHERE ${liveCardSql('c')} AND c.batch_id=ANY($1::uuid[]) AND c.fingerprint IS NOT NULL AND ($2::uuid IS NULL OR c.id<>$2)`,[batches.map(b=>b.id),excludeId])).rows;
 const best=closestFingerprint(fingerprint,rows,settings);
 if(!best||best.match==='different')return null;
 return {match:best.match,distance:best.distance,original:originalSummary(best.candidate)};
}

// A duplicate keeps its slot in the entry as a rejected row so the operator can
// compare both scans and restore it; it is never queued for reading.
export async function insertDuplicateCard(client,{id,batch,ordinal,filename,image,imageHash,pageCount,expectedPages,fingerprint,blob,original,reason,distance}){
 await client.query('INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,page_count,expected_pages,raw_fields,image_blob_key,image_bytes,blob_uploaded_at,fingerprint,status,review_note,duplicate_of,checked_by,checked_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,NOW())',[id,batch.id,ordinal,String(filename||'Scan').slice(0,240),blob?null:image,imageHash,pageCount,expectedPages,JSON.stringify({duplicate:{reason,distance:distance||null,original,decidedAt:new Date().toISOString()}}),blob?.key||null,blob?.bytes||null,blob?.uploadedAt||null,fingerprint?JSON.stringify(fingerprint):null,'rejected',duplicateNote(original),original.cardId,'system']);
}

// Duplicate rows of one entry with their originals, for the Duplicates tile.
export async function listDuplicateCards(client,batchId){
 const rows=(await client.query(`SELECT c.id,c.batch_id,c.ordinal,c.filename,c.status,c.revision,c.review_note,c.raw_fields,c.created_at,c.duplicate_of,o.ordinal AS original_ordinal,o.batch_id AS original_batch_id,o.status AS original_status,ob.name AS original_entry,l.book_no AS original_book_no FROM mis_scan_cards c LEFT JOIN mis_scan_cards o ON o.id=c.duplicate_of LEFT JOIN mis_scan_batches ob ON ob.id=o.batch_id LEFT JOIN mis_log_books l ON l.id=o.logbook_id AND l.deleted_at IS NULL WHERE c.batch_id=$1 AND c.duplicate_of IS NOT NULL ORDER BY c.ordinal`,[batchId])).rows;
 return rows.map(row=>{decodeScanRow(row);return {id:row.id,batch_id:row.batch_id,ordinal:row.ordinal,filename:row.filename,status:row.status,revision:row.revision,review_note:row.review_note,created_at:row.created_at,reason:row.raw_fields?.duplicate?.reason||'exact',distance:row.raw_fields?.duplicate?.distance||null,restored:row.raw_fields?.duplicateRestored||null,original:{cardId:row.duplicate_of,batchId:row.original_batch_id,entryName:row.original_entry,ordinal:row.original_ordinal,bookNo:row.original_book_no,status:row.original_status,missing:!row.original_batch_id}};});
}

// The operator overrules the system: the card is read like any other upload.
export async function restoreDuplicateCard(client,card,actor){
 if(!card.duplicate_of)throw Object.assign(new Error('This card was not skipped as a duplicate.'),{status:409});
 const result=await client.query("UPDATE mis_scan_cards SET status='queued',duplicate_of=NULL,review_note='',error='',checked_by=NULL,checked_at=NULL,raw_fields=(raw_fields-'duplicate')||jsonb_build_object('duplicateRestored',jsonb_build_object('by',$2::text,'at',NOW(),'original',raw_fields->'duplicate'->'original'),'scanQueueOrigin','user','scanQueuedAt',clock_timestamp()),revision=revision+1 WHERE id=$1 AND duplicate_of IS NOT NULL RETURNING revision",[card.id,actor]);
 if(!result.rows.length)throw Object.assign(new Error('The card changed. Reload the entry.'),{status:409});
 return result.rows[0].revision;
}

// Identity the reader is sure about: card number and door read without a review flag, on the entry's date.
export function contentIdentityCertain(card,kind,context){
 const draft=card.draft||{},review=draft.extractionReviewFields||[];
 const numberField=kind==='vehicle'?'aFormNo':'jobCardNo';
 if(!cardNumberKey(draft[numberField])||!scanDoorKey(card,kind))return false;
 if(review.includes(numberField)||review.includes('assetId')||review.includes('doorText'))return false;
 if(context?.bookDate&&draft.bookDate!==context.bookDate)return false;
 return !['system-fallback','scan-unreadable'].includes(draft.bookDateSource);
}

// A saved log book keeps the real door, so a card whose slash was read as 1
// (written V1840, saved V-840) is still the same card.
const savedDoorKeys=(door,kind,doorKey)=>new Set([doorKey,separatorCorrectedKey(door,kind)].filter(Boolean));
// Same date, door and card number on a live card in any entry for this date,
// site and shift (earlier cards win), or in a saved log book.
// `current` is the card's resolved values (shift, driver, meters); a saved card of another shift is then
// a shift continuation when isShiftContinuation says so. `sameShiftOnly` leaves every saved card of
// another shift to the review (the automatic rejection after reading uses it).
export async function findContentDuplicate(client,kind,card,batch,{bookDate,door,number,current=null,sameShiftOnly=false}){
 const doorKey=cardMachineKey(door||scanDoorValue(card),kind);
 if(!bookDate||!doorKey||!number)return null;
 const batches=await sameContextBatches(client,batch);
 const siblings=(await client.query(`SELECT c.id,c.batch_id,b.name AS batch_name,c.ordinal,c.raw_fields,c.draft,l.book_no FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id LEFT JOIN mis_log_books l ON l.id=c.logbook_id AND l.deleted_at IS NULL WHERE c.batch_id=ANY($1::uuid[]) AND c.id<>$2 AND c.duplicate_of IS NULL AND c.status NOT IN('rejected','posted') AND c.draft->>'bookDate'=$3 AND regexp_replace(upper(COALESCE(NULLIF(c.draft->>'aFormNo',''),c.draft->>'jobCardNo','')),'[^A-Z0-9]','','g')=$4 AND (c.created_at<$5 OR (c.created_at=$5 AND c.id<$2)) ORDER BY c.created_at,c.id`,[batches.map(b=>b.id),card.id,bookDate,number,card.created_at])).rows;
 const sibling=siblings.map(row=>decodeScanRow(row)).find(row=>scanDoorKey(row,kind)===doorKey);
 if(sibling)return {kind:'card',...originalSummary(sibling)};
 const savedRows=(await client.query(`SELECT l.id,l.book_no,l.data,l.data->>'scanCardId' AS scan_card_id,l.data->>'scanBatchId' AS scan_batch_id FROM mis_log_books l WHERE l.book_type=$1 AND l.book_date=$2 AND l.deleted_at IS NULL AND ${await savedNumberSql(client)}=$3 AND COALESCE(l.data->>'scanCardId','')<>$4`,[batch.expected_context?.logBookKind==='lmv'?'lmv':kind,bookDate,number,card.id])).rows;
 const savedKeys=savedDoorKeys(door||scanDoorValue(card),kind,doorKey);
 const matching=savedRows.filter(row=>savedKeys.has(cardMachineKey(row.data?.door||row.data?.doorText,kind)));
 const shiftOf=current||{...card.draft,cardShift:batch.expected_context?.cardShift||card.draft?.cardShift};
 const saved=matching.find(row=>!(sameShiftOnly&&otherShift(row.data,shiftOf))&&!isShiftContinuation(row.data,current));
 const continued=!saved&&current&&matching.find(row=>isShiftContinuation(row.data,current));
 if(continued)return {kind:'continuation',bookNo:continued.book_no,shift:vlbRecordShift(continued.data)};
 if(saved){const origin=saved.scan_card_id?(await client.query('SELECT c.id,c.batch_id,b.name AS batch_name,c.ordinal FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id WHERE c.id=$1',[saved.scan_card_id])).rows[0]:null;return {kind:'logbook',cardId:origin?.id||null,batchId:origin?.batch_id||null,entryName:origin?.batch_name||null,ordinal:origin?.ordinal||null,bookNo:saved.book_no};}
 return null;
}

// An earlier live card with the same image bytes (the check behind "Duplicate card.").
export async function findEarlierImageDuplicate(client,card){
 return (await client.query(`SELECT c.id FROM mis_scan_cards c LEFT JOIN mis_log_books l ON l.id=c.logbook_id AND l.book_date>=$$2026-11-01$$ WHERE ${operationalScanSql('c')} AND c.image_hash=$1 AND c.id<>$2 AND c.status NOT IN('rejected') AND (c.status<>'posted' OR (l.id IS NOT NULL AND l.deleted_at IS NULL)) AND (c.created_at<$3 OR (c.created_at=$3 AND c.id<$2)) LIMIT 1`,[card.image_hash,card.id,card.created_at])).rows[0]||null;
}

// The duplicate questions of checkScanCard for every card of one entry, answered from three
// queries instead of three or four per card. `image` and `content` give the same answers as
// findEarlierImageDuplicate and findContentDuplicate; a card or identity that was not loaded
// (a date or card number outside this entry's cards) is answered by those directly.
const NUMBER_KEY_SQL=source=>`regexp_replace(upper(COALESCE(${source},'')),'[^A-Z0-9]','','g')`;
const UUID_SQL="'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'";
// The normalised card number of a saved log book, as the duplicate check compares it.
const SAVED_NUMBER_SQL=(prefix='')=>NUMBER_KEY_SQL(`${prefix}data->>'scanCardNumber',NULLIF(${prefix}data->>'aFormNo',''),${prefix}data->>'jobCardNo'`);
// mis_log_books has FORCE ROW LEVEL SECURITY in production (MIS_RLS_ENABLED). Postgres then searches
// an index with a condition only when every function in it is leakproof: = on text and on date are,
// but upper, regexp_replace, jsonb ->> and date + integer are not. So no index on the expression
// above could narrow the saved-record question by card number (#316, #344 and #349 on 15 Nov 2026),
// and #349's book_date+0 also stopped the narrowing by date: every card read every log book
// (duplicate-saved about 3 s, up to 6 s, from 00:40 IST on 16 Nov 2026).
// The number is therefore kept in its own column, card_number_key, filled by a trigger on every
// insert and update, and the question compares the plain column (card_number_key = ...), which the
// index (book_type, book_date, card_number_key) serves with the row policy in place.
export const CARD_NUMBER_KEY_COLUMN='card_number_key';
export const SAVED_CARD_NUMBER_INDEX='mis_log_books_card_number_key';
// The expression indexes of the earlier attempts. They never narrowed by number and only slow saves.
export const RETIRED_CARD_NUMBER_INDEXES=['mis_log_books_saved_card_number','mis_log_books_card_number_first','mis_log_books_card_number_day'];
const CARD_NUMBER_KEY_TRIGGER='mis_log_books_card_number_key_fill';
const CARD_NUMBER_KEY_FUNCTION=`CREATE OR REPLACE FUNCTION ${CARD_NUMBER_KEY_TRIGGER}() RETURNS trigger LANGUAGE plpgsql AS $card_key$
BEGIN NEW.${CARD_NUMBER_KEY_COLUMN}:=${SAVED_NUMBER_SQL('NEW.')}; RETURN NEW; END $card_key$`;
// CONCURRENTLY keeps log book saves running while the index is built; a build that stopped half
// way leaves an invalid index, which is dropped and built again.
// Both Pulse-II slots and every instance start this, so only the one that holds
// SAVED_CARD_NUMBER_LOCK may change the table, fill it, drop or build, and an index another server
// is still building is never dropped. /api/health shows the outcome.
const SAVED_CARD_NUMBER_LOCK=709224190;
const savedIndexState={state:'not-started'};
export const savedCardNumberIndexState=()=>({...savedIndexState});
const INDEX_STATE_SQL='SELECT i.indisvalid AS valid FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.relname=$1';
const SAVED_INDEX_PROBE=`SELECT l.id FROM mis_log_books l WHERE l.book_type=$1 AND l.book_date=ANY($2::date[]) AND l.deleted_at IS NULL AND l.${CARD_NUMBER_KEY_COLUMN}=ANY($3::text[])`;
// The index is built only after every log book was filled (the trigger fills every later save), so
// a valid index means the column is complete and the questions may compare it. Each server, app or
// scan engine, looks this up for itself: once it is ready, or at most once a minute until then.
const keyIndex={ready:false,checkedAt:0};
const KEY_RECHECK_MS=60000;
async function savedKeyReady(client){
 if(keyIndex.ready)return true;
 const at=Date.now();
 if(at-keyIndex.checkedAt<KEY_RECHECK_MS)return false;
 keyIndex.checkedAt=at;
 try{keyIndex.ready=(await client.query(INDEX_STATE_SQL,[SAVED_CARD_NUMBER_INDEX])).rows?.[0]?.valid===true;}catch{keyIndex.ready=false;}
 return keyIndex.ready;
}
const savedNumberSql=async client=>await savedKeyReady(client)?`l.${CARD_NUMBER_KEY_COLUMN}`:SAVED_NUMBER_SQL('l.');
const changedRows=result=>Number(result?.rowCount??result?.affectedRows??0);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function ensureSavedCardNumberIndex(pool,{log=console,now=()=>Date.now(),fillRows=1000,fillPauseMs=100}={}){
 const client=typeof pool.connect==='function'?await pool.connect():pool;
 let locked=false;
 const mark=(state,extra={})=>Object.assign(savedIndexState,{state,...extra,checkedAt:new Date(now()).toISOString()});
 try{
  const state=async()=>(await client.query(INDEX_STATE_SQL,[SAVED_CARD_NUMBER_INDEX])).rows[0];
  const retired=async()=>(await client.query('SELECT relname FROM pg_class WHERE relname=ANY($1::text[])',[RETIRED_CARD_NUMBER_INDEXES])).rows.map(row=>row.relname);
  let existing=await state(),oldIndexes=await retired();
  if(!existing?.valid||oldIndexes.length){
   locked=(await client.query('SELECT pg_try_advisory_lock($1) AS locked',[SAVED_CARD_NUMBER_LOCK])).rows[0].locked;
   if(locked){existing=await state();oldIndexes=await retired();}
   else if(!existing?.valid){mark('building-elsewhere');return 'busy';}
  }
  let built=false;
  if(!existing?.valid){
   let buildingElsewhere=false;
   try{buildingElsewhere=Boolean((await client.query('SELECT 1 FROM pg_stat_progress_create_index p JOIN pg_class c ON c.oid=p.index_relid WHERE c.relname=$1',[SAVED_CARD_NUMBER_INDEX])).rows.length);}catch{buildingElsewhere=false;}
   if(buildingElsewhere){mark('building-elsewhere');return 'busy';}
   const started=now();
   mark('preparing',{startedAt:new Date(started).toISOString()});
   // The column and the trigger each take a short lock on the whole table. They wait at most 5 s for
   // it, so log book saves never queue behind a long read; the server tries again 10 minutes later.
   const hasColumn=(await client.query("SELECT 1 FROM pg_attribute WHERE attrelid='mis_log_books'::regclass AND attname=$1 AND NOT attisdropped",[CARD_NUMBER_KEY_COLUMN])).rows.length>0;
   const hasTrigger=(await client.query("SELECT 1 FROM pg_trigger WHERE tgrelid='mis_log_books'::regclass AND tgname=$1",[CARD_NUMBER_KEY_TRIGGER])).rows.length>0;
   await client.query(CARD_NUMBER_KEY_FUNCTION);
   if(!hasColumn||!hasTrigger){
    try{
     await client.query('BEGIN');
     await client.query("SET LOCAL lock_timeout='5s'");
     if(!hasColumn)await client.query(`ALTER TABLE mis_log_books ADD COLUMN IF NOT EXISTS ${CARD_NUMBER_KEY_COLUMN} TEXT`);
     if(!hasTrigger)await client.query(`CREATE TRIGGER ${CARD_NUMBER_KEY_TRIGGER} BEFORE INSERT OR UPDATE ON mis_log_books FOR EACH ROW EXECUTE FUNCTION ${CARD_NUMBER_KEY_TRIGGER}()`);
     await client.query('COMMIT');
    }catch(error){
     await client.query('ROLLBACK').catch(()=>{});
     if(error?.code==='55P03'){mark('waiting-for-table-lock');return 'busy';}
     throw error;
    }
   }
   // Fill the log books saved before the trigger, a thousand ids at a time with a pause between, so
   // saves and reads keep going. A row already holding its number is not written again, so a fill
   // that stopped half way (a restart) simply runs again. Every id above lastId was saved after the
   // trigger existed (creating it waits for the saves in progress) and was filled by it.
   const lastId=Number((await client.query('SELECT COALESCE(max(id),0)::bigint AS last FROM mis_log_books')).rows[0].last);
   let filled=0;
   mark('filling',{filled,filledUpTo:0,lastId});
   for(let from=0;from<lastId;from+=fillRows){
    filled+=changedRows(await client.query(`UPDATE mis_log_books SET ${CARD_NUMBER_KEY_COLUMN}=${SAVED_NUMBER_SQL()} WHERE id>$1 AND id<=$2 AND ${CARD_NUMBER_KEY_COLUMN} IS DISTINCT FROM ${SAVED_NUMBER_SQL()}`,[from,from+fillRows]));
    Object.assign(savedIndexState,{filled,filledUpTo:Math.min(from+fillRows,lastId)});
    if(fillPauseMs)await pause(fillPauseMs);
   }
   mark('building',{filled,filledUpTo:lastId,lastId});
   if(existing)await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${SAVED_CARD_NUMBER_INDEX}`);
   await client.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${SAVED_CARD_NUMBER_INDEX} ON mis_log_books (book_type,book_date,${CARD_NUMBER_KEY_COLUMN}) WHERE deleted_at IS NULL`);
   await client.query('ANALYZE mis_log_books');
   savedIndexState.buildMs=now()-started;
   log.log?.(`Saved card number index built in ${savedIndexState.buildMs} ms (${filled} log books filled).`);
   built=true;
  }
  if(locked&&oldIndexes.length){
   for(const name of oldIndexes)await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`);
   savedIndexState.retiredDropped=oldIndexes;
  }
  keyIndex.ready=true;
  // Whether the planner searches the index by type, date and card number together (no rows are
  // read). The table's row policy applies to this question as to every other one.
  const plan=(await client.query('EXPLAIN '+SAVED_INDEX_PROBE,['vehicle',[new Date(now()).toISOString().slice(0,10)],['0']])).rows.map(row=>Object.values(row)[0]).join('\n');
  delete savedIndexState.error;
  mark('valid',{usedByPlanner:/Index Cond:.*card_number_key/.test(plan)});
  return built;
 }catch(error){
  mark('failed',{error:String(error?.message||error).slice(0,200)});
  throw error;
 }finally{
  if(locked)await client.query('SELECT pg_advisory_unlock($1)',[SAVED_CARD_NUMBER_LOCK]).catch(()=>{});
  if(client!==pool)client.release?.();
 }
}
export async function preloadDuplicateChecks(client,batch,cards,{lap=()=>{}}={}){
 const kind=batch.kind,ids=new Set(cards.map(card=>card.id));
 const numbers=[...new Set(cards.map(card=>cardNumberKey(kind==='vehicle'?card.draft?.aFormNo:card.draft?.jobCardNo)).filter(Boolean))];
 const dates=[...new Set([batch.expected_context?.bookDate,...cards.map(card=>card.draft?.bookDate)].filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')))];
 const imageDuplicates=new Set(ids.size?(await client.query(`SELECT current.id FROM mis_scan_cards current WHERE current.id=ANY($1::uuid[]) AND EXISTS(SELECT 1 FROM mis_scan_cards c LEFT JOIN mis_log_books l ON l.id=c.logbook_id AND l.book_date>=$$2026-11-01$$ WHERE ${operationalScanSql('c')} AND c.image_hash=current.image_hash AND c.id<>current.id AND c.status NOT IN('rejected') AND (c.status<>'posted' OR (l.id IS NOT NULL AND l.deleted_at IS NULL)) AND (c.created_at<current.created_at OR (c.created_at=current.created_at AND c.id<current.id)))`,[[...ids]])).rows.map(row=>row.id):[]);lap('duplicate-image');
 let siblings=[],savedRows=[];
 if(numbers.length){
  const batches=await sameContextBatches(client,batch);lap('duplicate-batches');
  // Only the identity of each candidate is read (date, card number, door), not its whole draft.
  const number=NUMBER_KEY_SQL("NULLIF(c.draft->>'aFormNo',''),c.draft->>'jobCardNo'");
  siblings=(await client.query(`SELECT c.id,c.batch_id,b.name AS batch_name,c.ordinal,c.created_at,c.draft->>'bookDate' AS book_date,${number} AS number,CASE WHEN c.raw_fields ? '__caliberUtf8JsonV1' THEN c.raw_fields ELSE jsonb_build_object('door',c.raw_fields->'door') END AS raw_fields,CASE WHEN c.draft ? '__caliberUtf8JsonV1' THEN c.draft ELSE jsonb_build_object('doorTextWritten',c.draft->'doorTextWritten','doorText',c.draft->'doorText','door',c.draft->'door') END AS draft,l.book_no FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id LEFT JOIN mis_log_books l ON l.id=c.logbook_id AND l.deleted_at IS NULL WHERE c.batch_id=ANY($1::uuid[]) AND c.duplicate_of IS NULL AND c.status NOT IN('rejected','posted') AND ${number}=ANY($2::text[]) ORDER BY c.created_at,c.id`,[batches.map(b=>b.id),numbers])).rows.map(row=>decodeScanRow(row));lap('duplicate-cards');
  if(dates.length){
   const savedNumber=await savedNumberSql(client);
   savedRows=(await client.query(`SELECT l.id,l.book_no,to_char(l.book_date,'YYYY-MM-DD') AS book_date,${savedNumber} AS number,jsonb_build_object('door',l.data->'door','doorText',l.data->'doorText',${CONTINUATION_FIELDS.map(field=>`'${field}',l.data->'${field}'`).join(',')}) AS data,l.data->>'scanCardId' AS scan_card_id,oc.id AS origin_id,oc.batch_id AS origin_batch_id,ob.name AS origin_batch_name,oc.ordinal AS origin_ordinal FROM mis_log_books l LEFT JOIN mis_scan_cards oc ON oc.id=CASE WHEN l.data->>'scanCardId' ~ ${UUID_SQL} THEN (l.data->>'scanCardId')::uuid END LEFT JOIN mis_scan_batches ob ON ob.id=oc.batch_id WHERE l.book_type=$1 AND l.book_date=ANY($2::date[]) AND l.deleted_at IS NULL AND ${savedNumber}=ANY($3::text[]) ORDER BY l.id`,[batch.expected_context?.logBookKind==='lmv'?'lmv':kind,dates,numbers])).rows;lap('duplicate-saved');
  }
 }
 const time=value=>new Date(value).getTime();
 return {
  async image(card){return ids.has(card.id)?imageDuplicates.has(card.id):Boolean(await findEarlierImageDuplicate(client,card));},
  async content(card,{bookDate,door,number,current=null}){
   const doorKey=cardMachineKey(door||scanDoorValue(card),kind);
   if(!bookDate||!doorKey||!number)return null;
   if(!numbers.includes(number)||!dates.includes(bookDate))return findContentDuplicate(client,kind,card,batch,{bookDate,door,number,current});
   const created=time(card.created_at);
   const sibling=siblings.find(row=>row.id!==card.id&&row.number===number&&row.book_date===bookDate&&(time(row.created_at)<created||(time(row.created_at)===created&&row.id<card.id))&&scanDoorKey(row,kind)===doorKey);
   if(sibling)return {kind:'card',...originalSummary(sibling)};
   const matching=savedRows.filter(row=>row.number===number&&row.book_date===bookDate&&(row.scan_card_id||'')!==card.id&&savedDoorKeys(door||scanDoorValue(card),kind,doorKey).has(cardMachineKey(row.data?.door||row.data?.doorText,kind)));
   const saved=matching.find(row=>!isShiftContinuation(row.data,current));
   const continued=!saved&&current&&matching.find(row=>isShiftContinuation(row.data,current));
   if(continued)return {kind:'continuation',bookNo:continued.book_no,shift:vlbRecordShift(continued.data)};
   if(saved)return {kind:'logbook',cardId:saved.origin_id||null,batchId:saved.origin_batch_id||null,entryName:saved.origin_batch_name||null,ordinal:saved.origin_ordinal||null,bookNo:saved.book_no};
   return null;
  }
 };
}

export function contentDuplicateMessage(original,certain){
 if(!certain)return '';
 const where=original.ordinal?'card '+original.ordinal+' in entry '+(original.entryName||original.batchId):'saved record '+(original.bookNo||'');
 return 'Same card number, door and date already appear on '+where+'. Reject this card or correct the values.';
}

// After reading: a card whose identity is certain and already exists is
// rejected as a duplicate of the original. Uncertain cards stay for review
// with the possible duplicate named by checkScanCard.
export async function applyContentDuplicate(client,kind,card,batch){
 const context=batch.expected_context;if(!context||card.status!=='review'||card.duplicate_of)return null;
 // One sheet of a card written on two or more sheets shares its number, door and date with the other
 // sheets; checkScanCard and the save tell a later sheet from the same sheet scanned twice.
 if(kind==='vehicle'&&isMultiSheet(card.draft?.tripCardSheet))return null;
 if(!contentIdentityCertain(card,kind,context))return null;
 const draft=card.draft||{},number=cardNumberKey(kind==='vehicle'?draft.aFormNo:draft.jobCardNo);
 const original=await findContentDuplicate(client,kind,card,batch,{bookDate:draft.bookDate,door:scanDoorValue(card),number,sameShiftOnly:true});
 if(!original||!original.cardId||original.kind==='continuation')return null;
 await client.query("UPDATE mis_scan_cards SET status='rejected',duplicate_of=$2,review_note=$3,checked_by='system',checked_at=NOW(),raw_fields=raw_fields||jsonb_build_object('duplicate',$4::jsonb),revision=revision+1 WHERE id=$1 AND status='review' AND duplicate_of IS NULL",[card.id,original.cardId,duplicateNote(original),JSON.stringify({reason:'content',original,decidedAt:new Date().toISOString()})]);
 return original;
}

// Cards stored before fingerprints existed are fingerprinted once so earlier
// entries can be matched against. Runs in small batches in the background.
export async function backfillScanFingerprints(pool,{imageStorage=null,limit=50,log=console}={}){
 let done=0;
 for(;;){
  const rows=(await pool.query("SELECT id,batch_id,image,image_blob_key,image_bytes FROM mis_scan_cards WHERE fingerprint IS NULL AND created_at>=$$2026-11-01$$ AND (image IS NOT NULL OR image_blob_key IS NOT NULL) ORDER BY created_at DESC LIMIT $1",[limit])).rows;
  if(!rows.length)break;
  let progressed=false;
  for(const row of rows){
   try{
    const card=imageStorage&&!row.image?await imageStorage.hydrate(row):row;
    const fingerprint=card.image?await fingerprintScanImage(card.image):null;
    await pool.query("UPDATE mis_scan_cards SET fingerprint=$2::jsonb WHERE id=$1 AND fingerprint IS NULL",[row.id,JSON.stringify(fingerprint||{version:0,unavailable:true})]);
    if(fingerprint)done++;progressed=true;
   }catch(error){
    log.error?.('Scan fingerprint backfill failed for card '+row.id+':',error?.message||String(error));
    await pool.query("UPDATE mis_scan_cards SET fingerprint=$2::jsonb WHERE id=$1 AND fingerprint IS NULL",[row.id,JSON.stringify({version:0,error:String(error?.message||error).slice(0,200)})]).catch(()=>{});
    progressed=true;
   }
  }
  if(!progressed)break;
 }
 if(done)log.log?.('Scan fingerprints computed for '+done+' card(s).');
 return done;
}
