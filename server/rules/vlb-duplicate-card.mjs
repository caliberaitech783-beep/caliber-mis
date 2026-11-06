import {canonicalSiteName} from '../../shared/site-location.mjs';
import {displaySiteName} from '../../shared/region-scope.mjs';
import {vlbRecordShift} from '../../shared/vlb-batch-format.mjs';
import {auditVlbBatch} from './vlb-batch-policy.mjs';

const text=value=>String(value??'').trim();
export const DUPLICATE_REASON_MIN=10;
export const DUPLICATE_REASON_MAX=300;

// One VLB card per tipper per site, date and shift. A second manual card needs a
// reason, which is kept on the card and written to the batch audit. Scanned cards
// can never override the rule: blank or misread printed numbers must not create a
// second saved record when the same PDF is uploaded by another user.
export async function findOtherVlbCards(client,data,recordId=null){
 const shift=vlbRecordShift(data);if(!shift||!data?.bookDate||data?.assetId===undefined||data?.assetId===null||data?.assetId==='')return [];
 const {rows}=await client.query(`SELECT id,book_no,data FROM mis_log_books WHERE book_type='vehicle' AND deleted_at IS NULL AND book_date=$1 AND asset_id::text=$2::text AND ($3::bigint IS NULL OR id<>$3::bigint) ORDER BY id`,[data.bookDate,String(data.assetId),recordId===null||recordId===undefined?null:String(recordId)]);
 const site=canonicalSiteName(data.location);
 return rows.filter(row=>canonicalSiteName(row.data?.location)===site&&vlbRecordShift(row.data)===shift).map(row=>({id:String(row.id),bookNo:row.book_no,additional:Boolean(text(row.data?.duplicateReason))}));
}

export async function assertSingleVlbCardPerShift(client,data,{recordId=null,batch=null,actor=''}={}){
 if(!data)return [];
 // When editing, cards that were saved as additional ones do not count against the original.
 const existing=(await findOtherVlbCards(client,data,recordId)).filter(row=>!recordId||!row.additional).map(({id,bookNo})=>({id,bookNo}));
 if(!existing.length){delete data.duplicateOf;if(!text(data.duplicateReason))delete data.duplicateReason;return [];}
 if(data.scanCardId){
  const first=existing[0],shift=vlbRecordShift(data);
  throw Object.assign(new Error(`Tipper ${text(data.door)||'(selected)'} already has saved card ${first.bookNo} for ${displaySiteName(data.location)}, ${data.bookDate}, shift ${shift}. A second scanned card cannot be saved.`),{status:409,details:{code:'duplicate_card',existing}});
 }
 const reason=text(data.duplicateReason);
 if(reason.length<DUPLICATE_REASON_MIN){
  const first=existing[0],shift=vlbRecordShift(data);
  throw Object.assign(new Error(`Tipper ${text(data.door)||'(selected)'} already has card ${first.bookNo} for ${displaySiteName(data.location)}, ${data.bookDate}, shift ${shift}. Open that card to correct it, or save a second card with a reason of at least ${DUPLICATE_REASON_MIN} characters.`),{status:409,details:{code:'duplicate_card',existing}});
 }
 data.duplicateReason=reason.slice(0,DUPLICATE_REASON_MAX);
 data.duplicateOf=existing.map(row=>row.bookNo);
 if(batch&&!recordId)await auditVlbBatch(client,batch,actor,'card_added_duplicate',{door:text(data.door),existing:data.duplicateOf,reason:data.duplicateReason});
 return existing;
}
