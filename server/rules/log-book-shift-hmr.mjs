import {canonicalSiteName} from '../../shared/site-location.mjs';
import {CARD_SHIFTS,normalizeCardShift} from '../../shared/trip-card-rules.mjs';
import {vlbRecordShift} from '../../shared/vlb-batch-format.mjs';

const hmrUnits=data=>Math.max(0,Math.round(Number(data.totalWorkingHmr??(data.closingHmr-data.openingHmr))*1000)||0);

// Writers must hold the log-book transaction locks through validation and save.
export async function assertCombinedShiftHmr(client,kind,data,recordId=null){
 const {rows}=await client.query(`SELECT site,data FROM mis_log_books
  WHERE book_type=$1 AND book_date=$2 AND asset_id=$3 AND deleted_at IS NULL
    AND ($4::bigint IS NULL OR id<>$4::bigint)`,[kind,data.bookDate,data.assetId,recordId]);
 const site=canonicalSiteName(data.location),shift=vlbRecordShift(data);
 const peers=rows.filter(row=>{
  if(canonicalSiteName(row.site)!==site)return false;
  const otherShift=vlbRecordShift(row.data);
  return shift&&otherShift?shift===otherShift:String(row.data.shiftId)===String(data.shiftId);
 });
 if(!peers.length)return;
 const limit=CARD_SHIFTS[normalizeCardShift(shift)]?.hours??Math.min(
  data.shiftHours,...peers.map(row=>Number(row.data.shiftHours)).filter(hours=>hours===8||hours===12)
 );
 const saved=peers.reduce((sum,row)=>sum+hmrUnits(row.data),0);
 const total=saved+hmrUnits(data);
 if(total>limit*1000){
  throw Object.assign(new Error(`Combined working HMR for ${data.door||'this asset'} on ${data.bookDate}, shift ${shift||data.shiftName||data.shiftId}, would be ${total/1000} hours (${saved/1000} already saved). The limit is ${limit} hours. Check the opening and closing HMR on the cards.`),
   {status:409,details:{code:'shift_hmr_limit'}});
 }
}
