import {isJayantSecondShift} from '../../shared/site-shift-hours.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {CARD_SHIFTS,normalizeCardShift,VLB_SHIFT_KMR_LIMIT} from '../../shared/trip-card-rules.mjs';
import {vlbRecordShift} from '../../shared/vlb-batch-format.mjs';
import {cardWorkingHmr} from '../../shared/log-book-shared-shift.mjs';

const meterUnits=value=>Math.max(0,Math.round(Number(value)*1000)||0);
const hmrUnits=data=>meterUnits(cardWorkingHmr(data));
const kmrUnits=data=>meterUnits(data.totalRunningKmr??data.replacementKmr??(data.closingKmr-data.openingKmr));

// Writers must hold the log-book transaction locks through validation and save.
export async function assertCombinedShiftMeters(client,kind,data,recordId=null,batch=null){
 const batchId=kind==='equipment'?batch?.id||data.batchId||null:null;
 const {rows}=batchId
  ?await client.query(`SELECT l.id,l.book_no,l.site,l.data,b.name AS batch_name FROM mis_elb_batch_entries e
    JOIN mis_log_books l ON l.id=e.logbook_id
    JOIN mis_vlb_batches b ON b.id=e.batch_id
    WHERE e.batch_id=$1 AND l.book_type=$2 AND l.book_date=$3 AND l.asset_id=$4 AND l.deleted_at IS NULL
      AND ($5::bigint IS NULL OR l.id<>$5::bigint)`,[batchId,kind,data.bookDate,data.assetId,recordId])
  :await client.query(`SELECT id,book_no,site,data,NULL::text AS batch_name FROM mis_log_books
    WHERE book_type=$1 AND book_date=$2 AND asset_id=$3 AND deleted_at IS NULL
      AND ($4::bigint IS NULL OR id<>$4::bigint)`,[kind,data.bookDate,data.assetId,recordId]);
 const site=canonicalSiteName(data.location),shift=vlbRecordShift(data);
 const peers=rows.filter(row=>{
  if(canonicalSiteName(row.site)!==site)return false;
  const otherShift=vlbRecordShift(row.data);
  return shift&&otherShift?shift===otherShift:String(row.data.shiftId)===String(data.shiftId);
 });
 if(!peers.length)return;
 if(kind!=='lmv'){
  const limit=isJayantSecondShift({...data,bookShiftCode:shift})?9:data.manualShiftOverride?Number(data.shiftHours):CARD_SHIFTS[normalizeCardShift(shift)]?.hours??Math.min(
   data.shiftHours,...peers.map(row=>Number(row.data.shiftHours)).filter(hours=>hours===8||hours===12)
  );
  const saved=peers.reduce((sum,row)=>sum+hmrUnits(row.data),0);
  const total=saved+hmrUnits(data);
  if(total>limit*1000){
   const conflicts=peers.map(row=>({id:String(row.id),bookNo:row.book_no,batchName:row.batch_name||''}));
   const sources=conflicts.map(row=>row.bookNo+(row.batchName?' in '+row.batchName:'')).join(', ');
   throw Object.assign(new Error(`Combined working HMR for ${data.door||'this asset'} on ${data.bookDate}, shift ${shift||data.shiftName||data.shiftId}, would be ${total/1000} hours (${saved/1000} already saved${sources?' in '+sources:''}). The limit is ${limit} hours. Check the opening and closing HMR on the cards.`),
    {status:409,details:{code:'shift_hmr_limit',conflicts}});
  }
 }
 if(kind!=='vehicle'&&kind!=='lmv')return;
 const savedKmr=peers.reduce((sum,row)=>sum+kmrUnits(row.data),0);
 const totalKmr=savedKmr+kmrUnits(data);
 if(totalKmr>VLB_SHIFT_KMR_LIMIT*1000){
  throw Object.assign(new Error(`Combined distance for ${data.door||'this vehicle'} on ${data.bookDate}, shift ${shift||data.shiftName||data.shiftId}, would be ${totalKmr/1000} km (${savedKmr/1000} km already saved). The limit is ${VLB_SHIFT_KMR_LIMIT} km.`),
   {status:409,details:{code:'shift_kmr_limit'}});
 }
}
