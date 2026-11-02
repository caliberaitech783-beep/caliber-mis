import {operationalScanSql} from './operational-start.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {decodeScanRow} from './scan-text-storage.mjs';
import {fingerprintScanImage,closestFingerprint,scanFingerprintSettings} from './scan-fingerprint.mjs';

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

export async function fingerprintForUpload(image){
 try{return await fingerprintScanImage(image);}catch(error){console.error('Scan fingerprint failed:',error?.message||String(error));return null;}
}

const liveCardSql=alias=>`${operationalScanSql(alias)} AND ${alias}.duplicate_of IS NULL AND ${alias}.status NOT IN('rejected') AND (${alias}.status<>'posted' OR EXISTS(SELECT 1 FROM mis_log_books lb WHERE lb.id=${alias}.logbook_id AND lb.deleted_at IS NULL))`;

// Scan entries that share this entry's card date, site and shift (the entry itself included).
export async function sameContextBatches(client,batch){
 const context=batch.expected_context;if(!context?.bookDate)return [batch];
 const rows=(await client.query("SELECT id,name,kind,expected_context FROM mis_scan_batches WHERE kind=$1 AND expected_context->>'bookDate'=$2 AND COALESCE(expected_context->>'cardShift','')=COALESCE($3,'') AND NOT(expected_context ? 'deletedVlbBatch')",[batch.kind,context.bookDate,context.cardShift||''])).rows;
 const site=canonicalSiteName(context.location);
 return rows.filter(row=>row.id===batch.id||canonicalSiteName(row.expected_context?.location)===site);
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
 const result=await client.query("UPDATE mis_scan_cards SET status='queued',duplicate_of=NULL,review_note='',error='',checked_by=NULL,checked_at=NULL,raw_fields=(raw_fields-'duplicate')||jsonb_build_object('duplicateRestored',jsonb_build_object('by',$2::text,'at',NOW(),'original',raw_fields->'duplicate'->'original'),'scanQueueOrigin','user'),revision=revision+1 WHERE id=$1 AND duplicate_of IS NOT NULL RETURNING revision",[card.id,actor]);
 if(!result.rows.length)throw Object.assign(new Error('The card changed. Reload the entry.'),{status:409});
 return result.rows[0].revision;
}

// Identity the reader is sure about: card number and door read without a review flag, on the entry's date.
export function contentIdentityCertain(card,kind,context){
 const draft=card.draft||{},review=draft.extractionReviewFields||[];
 const numberField=kind==='vehicle'?'aFormNo':'jobCardNo';
 if(!cardNumberKey(draft[numberField])||!String(draft.assetId||'').trim())return false;
 if(review.includes(numberField)||review.includes('assetId')||review.includes('doorText'))return false;
 if(context?.bookDate&&draft.bookDate!==context.bookDate)return false;
 return !['system-fallback','scan-unreadable'].includes(draft.bookDateSource);
}

// Same date, door and card number on a live card in any entry for this date,
// site and shift (earlier cards win), or in a saved log book.
export async function findContentDuplicate(client,kind,card,batch,{bookDate,assetId,number}){
 if(!bookDate||!assetId||!number)return null;
 const batches=await sameContextBatches(client,batch);
 const sibling=(await client.query(`SELECT c.id,c.batch_id,b.name AS batch_name,c.ordinal,l.book_no FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id LEFT JOIN mis_log_books l ON l.id=c.logbook_id AND l.deleted_at IS NULL WHERE c.batch_id=ANY($1::uuid[]) AND c.id<>$2 AND c.duplicate_of IS NULL AND c.status NOT IN('rejected','posted') AND c.draft->>'bookDate'=$3 AND c.draft->>'assetId'=$4 AND regexp_replace(upper(COALESCE(NULLIF(c.draft->>'aFormNo',''),c.draft->>'jobCardNo','')),'[^A-Z0-9]','','g')=$5 AND (c.created_at<$6 OR (c.created_at=$6 AND c.id<$2)) ORDER BY c.created_at,c.id LIMIT 1`,[batches.map(b=>b.id),card.id,bookDate,String(assetId),number,card.created_at])).rows[0];
 if(sibling)return {kind:'card',...originalSummary(sibling)};
 const saved=(await client.query("SELECT l.id,l.book_no,l.data->>'scanCardId' AS scan_card_id,l.data->>'scanBatchId' AS scan_batch_id FROM mis_log_books l WHERE l.book_type=$1 AND l.book_date=$2 AND l.asset_id=$3 AND l.deleted_at IS NULL AND regexp_replace(upper(COALESCE(l.data->>'scanCardNumber',NULLIF(l.data->>'aFormNo',''),l.data->>'jobCardNo','')),'[^A-Z0-9]','','g')=$4 AND COALESCE(l.data->>'scanCardId','')<>$5 LIMIT 1",[kind,bookDate,assetId,number,card.id])).rows[0];
 if(saved){const origin=saved.scan_card_id?(await client.query('SELECT c.id,c.batch_id,b.name AS batch_name,c.ordinal FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id WHERE c.id=$1',[saved.scan_card_id])).rows[0]:null;return {kind:'logbook',cardId:origin?.id||null,batchId:origin?.batch_id||null,entryName:origin?.batch_name||null,ordinal:origin?.ordinal||null,bookNo:saved.book_no};}
 return null;
}

export function contentDuplicateMessage(original,certain){
 const where=original.ordinal?'card '+original.ordinal+' in entry '+(original.entryName||original.batchId):'saved record '+(original.bookNo||'');
 return certain?'Same card number, door and date already appear on '+where+'. Reject this card or correct the values.':'Possible duplicate of '+where+'. Confirm the card number and door before saving.';
}

// After reading: a card whose identity is certain and already exists is
// rejected as a duplicate of the original. Uncertain cards stay for review
// with the possible duplicate named by checkScanCard.
export async function applyContentDuplicate(client,kind,card,batch){
 const context=batch.expected_context;if(!context||card.status!=='review'||card.duplicate_of)return null;
 if(!contentIdentityCertain(card,kind,context))return null;
 const draft=card.draft||{},number=cardNumberKey(kind==='vehicle'?draft.aFormNo:draft.jobCardNo);
 const original=await findContentDuplicate(client,kind,card,batch,{bookDate:draft.bookDate,assetId:draft.assetId,number});
 if(!original||!original.cardId)return null;
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
