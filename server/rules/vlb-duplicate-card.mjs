import {canonicalSiteName} from '../../shared/site-location.mjs';
import {displaySiteName} from '../../shared/region-scope.mjs';
import {vlbRecordShift} from '../../shared/vlb-batch-format.mjs';
import {shareCardOperator} from '../../shared/log-book-shared-shift.mjs';
import {auditVlbBatch} from './vlb-batch-policy.mjs';
import {formatTripCardSheet,parseTripCardSheet,savedCardSheets} from '../../shared/trip-card-sheet.mjs';

const text=value=>String(value??'').trim();
const cardNumber=value=>text(value).toUpperCase().replace(/[^A-Z0-9]/g,'');
const printedNumber=data=>cardNumber(data?.scanCardNumber||data?.aFormNo);
const samePrintedCard=(left={},right={})=>{const a=printedNumber(left),b=printedNumber(right);return !a||!b||a===b;};
export const DUPLICATE_REASON_MIN=10;
export const DUPLICATE_REASON_MAX=300;

// Relief drivers can each save a card for the same tipper and shift.
// Repeated cards for the same driver retain the manual override and scan guard.
export async function findOtherVlbCards(client,data,recordId=null){
 const shift=vlbRecordShift(data);if(!shift||!data?.bookDate||data?.assetId===undefined||data?.assetId===null||data?.assetId==='')return [];
 const {rows}=await client.query(`SELECT id,book_no,data FROM mis_log_books WHERE book_type='vehicle' AND deleted_at IS NULL AND book_date=$1 AND asset_id::text=$2::text AND ($3::bigint IS NULL OR id<>$3::bigint) ORDER BY id`,[data.bookDate,String(data.assetId),recordId===null||recordId===undefined?null:String(recordId)]);
 const site=canonicalSiteName(data.location);
 return rows.filter(row=>canonicalSiteName(row.data?.location)===site&&vlbRecordShift(row.data)===shift).map(row=>({id:String(row.id),bookNo:row.book_no,additional:Boolean(text(row.data?.duplicateReason)),data:row.data}));
}

// A driver with more than 24 trips fills a second sheet of the same trip card:
// same tipper, date, shift, driver and Trip card NO, with "2/2" in the NO. OF
// TRIP CARDS box. Such a scanned sheet belongs to the card already saved and is
// joined to it instead of being refused. Returns that saved card, or null when
// this scan is not a later sheet of exactly one saved card. A sheet number the
// saved card already holds is the same sheet scanned twice and is refused.
export async function findVlbSheetTarget(client,data){
 const sheet=parseTripCardSheet(data?.tripCardSheet),number=printedNumber(data);
 if(!data?.scanCardId||!sheet||sheet.sheetTotal<2||!number)return null;
 const matches=(await findOtherVlbCards(client,data)).filter(row=>!row.additional&&shareCardOperator(data,row.data)&&printedNumber(row.data)===number);
 if(matches.length!==1)return null;
 const target=matches[0],held=savedCardSheets(target.data),label=formatTripCardSheet(sheet);
 const refuse=message=>{throw Object.assign(new Error(message),{status:409,details:{code:'duplicate_card',existing:[{id:target.id,bookNo:target.bookNo}]}});};
 if(held.some(row=>row.sheetNo===sheet.sheetNo))refuse(`Sheet ${label} of Trip card NO ${number} (tipper ${text(data.door)||'(selected)'}) is already saved in ${target.bookNo}. If the same sheet was scanned twice, delete this card. If it is a different sheet, correct Trip card sheet to the number in its NO. OF TRIP CARDS box.`);
 if(held.some(row=>row.sheetTotal!==sheet.sheetTotal))refuse(`${target.bookNo} holds sheet ${held.map(formatTripCardSheet).join(', ')} of Trip card NO ${number}, but this card reads ${label}. Check the NO. OF TRIP CARDS box on both sheets and correct Trip card sheet.`);
 // A saved card that never had its sheet box read is taken as the first sheet only when this one is a later sheet.
 if(!held.length&&sheet.sheetNo===1)return null;
 return {...target,sheet};
}

export async function assertSingleVlbCardPerShift(client,data,{recordId=null,batch=null,actor=''}={}){
 if(!data)return [];
 // When editing, cards that were saved as additional ones do not count against the original.
 const existing=(await findOtherVlbCards(client,data,recordId)).filter(row=>shareCardOperator(data,row.data)&&(!data.scanCardId||samePrintedCard(data,row.data))&&(!recordId||!row.additional)).map(({id,bookNo,data:saved})=>({id,bookNo,number:printedNumber(saved)}));
 if(!existing.length){delete data.duplicateOf;if(!text(data.duplicateReason))delete data.duplicateReason;return [];}
 if(data.scanCardId){
  const number=printedNumber(data),sameNumber=number&&existing.find(row=>row.number===number),first=sameNumber||existing[0],shift=vlbRecordShift(data);
  throw Object.assign(new Error(sameNumber
   ?`Tipper ${text(data.door)||'(selected)'} already has saved card ${first.bookNo} with the same Trip card NO ${number} for ${displaySiteName(data.location)}, ${data.bookDate}, shift ${shift}. If this is the next sheet of that trip card (its NO. OF TRIP CARDS box reads 2/2), enter it in Trip card sheet and save again: its trips are then added to ${first.bookNo}. If the same sheet was scanned twice, delete this card.`
   :`Tipper ${text(data.door)||'(selected)'} already has saved card ${first.bookNo} for ${displaySiteName(data.location)}, ${data.bookDate}, shift ${shift}. A second scanned card for the same driver cannot be saved against this tipper. If the driver changed vehicles, select the other vehicle on this card.`),{status:409,details:{code:'duplicate_card',existing:existing.map(({id,bookNo})=>({id,bookNo}))}});
 }
 const reason=text(data.duplicateReason);
 if(reason.length<DUPLICATE_REASON_MIN){
  const first=existing[0],shift=vlbRecordShift(data);
  throw Object.assign(new Error(`Tipper ${text(data.door)||'(selected)'} already has card ${first.bookNo} for ${displaySiteName(data.location)}, ${data.bookDate}, shift ${shift}. Open that card to correct it, or save a second card with a reason of at least ${DUPLICATE_REASON_MIN} characters.`),{status:409,details:{code:'duplicate_card',existing:existing.map(({id,bookNo})=>({id,bookNo}))}});
 }
 data.duplicateReason=reason.slice(0,DUPLICATE_REASON_MAX);
 data.duplicateOf=existing.map(row=>row.bookNo);
 if(batch&&!recordId)await auditVlbBatch(client,batch,actor,'card_added_duplicate',{door:text(data.door),existing:data.duplicateOf,reason:data.duplicateReason});
 return existing.map(({id,bookNo})=>({id,bookNo}));
}
