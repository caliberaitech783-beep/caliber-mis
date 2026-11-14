import {isJayantSecondShift} from '../../shared/site-shift-hours.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {CARD_SHIFTS,normalizeCardShift,VLB_SHIFT_KMR_LIMIT} from '../../shared/trip-card-rules.mjs';
import {vlbRecordShift} from '../../shared/vlb-batch-format.mjs';
import {cardWorkingHmr} from '../../shared/log-book-shared-shift.mjs';

const meterUnits=value=>Math.max(0,Math.round(Number(value)*1000)||0);
const hmrUnits=data=>meterUnits(cardWorkingHmr(data));
const kmrUnits=data=>meterUnits(data.totalRunningKmr??data.replacementKmr??(data.closingKmr-data.openingKmr));

const reading=value=>value==null||String(value).trim()===''?null:meterUnits(value);
// Two cards for one asset and shift cannot both start and end on the same meter values.
function sameMeterReadings(left={},right={}){
 const same=field=>reading(left[field])===reading(right[field]);
 return reading(left.openingHmr)!==null&&reading(left.closingHmr)!==null&&hmrUnits(left)>0
  &&['openingHmr','closingHmr','openingKmr','closingKmr'].every(same);
}

function shiftHmrLimit(data,shift){
 if(isJayantSecondShift({...data,bookShiftCode:shift}))return 9;
 if(data.manualShiftOverride)return Number(data.shiftHours);
 return CARD_SHIFTS[normalizeCardShift(shift)]?.hours;
}

async function assertVlbDriverShiftHmr(client,data,recordId){
 const shift=vlbRecordShift(data);
 const limit=shiftHmrLimit(data,shift);
 const employeeId=String(data.employeeId??'').trim();
 const caliberId=String(data.caliberId??'').trim().toUpperCase();
 if(!limit||(!employeeId&&!caliberId))return;
 const {rows}=await client.query(`SELECT id,book_no,site,asset_id,data FROM mis_log_books
  WHERE book_type='vehicle' AND book_date=$1 AND deleted_at IS NULL
    AND ($2::bigint IS NULL OR id<>$2::bigint)
    AND (($3<>'' AND data->>'employeeId'=$3)
      OR ($4<>'' AND UPPER(TRIM(data->>'caliberId'))=$4))
  ORDER BY id`,[data.bookDate,recordId,employeeId,caliberId]);
 const site=canonicalSiteName(data.location);
 const peers=rows.filter(row=>canonicalSiteName(row.site)===site&&vlbRecordShift(row.data)===shift);
 if(!peers.some(row=>String(row.asset_id)!==String(data.assetId)))return;
 const saved=peers.reduce((sum,row)=>sum+hmrUnits(row.data),0);
 const total=saved+hmrUnits(data);
 if(total<=limit*1000)return;
 const conflicts=peers.map(row=>({id:String(row.id),bookNo:row.book_no}));
 throw Object.assign(new Error(`Combined working HMR for driver ${data.employeeName||data.caliberId||employeeId} across vehicles on ${data.bookDate}, shift ${shift}, would be ${total/1000} hours (${saved/1000} already saved on ${conflicts.map(row=>row.bookNo).join(', ')}). The shift limit is ${limit} hours. Check the driver and HMR on the cards.`),
  {status:409,details:{code:'driver_shift_hmr_limit',conflicts}});
}

// Writers must hold the log-book transaction locks through validation and save.
export async function assertCombinedShiftMeters(client,kind,data,recordId=null,batch=null){
 // VLB writes hold the same site/date/shift lock across all vehicles.
 if(kind==='vehicle')await assertVlbDriverShiftHmr(client,data,recordId);
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
  const limit=shiftHmrLimit(data,shift)??Math.min(
   data.shiftHours,...peers.map(row=>Number(row.data.shiftHours)).filter(hours=>hours===8||hours===12)
  );
  const saved=peers.reduce((sum,row)=>sum+hmrUnits(row.data),0);
  const total=saved+hmrUnits(data);
  if(total>limit*1000){
   const conflicts=peers.map(row=>({id:String(row.id),bookNo:row.book_no,batchName:row.batch_name||''}));
   const sources=conflicts.map(row=>row.bookNo+(row.batchName?' in '+row.batchName:'')).join(', ');
   // The upload duplicate checks miss a repeat scan whose printed card number was read differently.
   const repeats=peers.filter(row=>sameMeterReadings(data,row.data)).map(row=>row.book_no);
   const advice=repeats.length
    ?`${repeats.join(', ')} has the same opening and closing meter readings, so this looks like the same card scanned twice. Reject this card if it is a repeat.`
    :'Check the opening and closing HMR on the cards.';
   throw Object.assign(new Error(`Combined working HMR for ${data.door||'this asset'} on ${data.bookDate}, shift ${shift||data.shiftName||data.shiftId}, would be ${total/1000} hours (${saved/1000} already saved${sources?' in '+sources:''}). The limit is ${limit} hours. ${advice}`),
    {status:409,details:{code:'shift_hmr_limit',conflicts,...(repeats.length?{repeatOf:repeats}:{})}});
  }
  // Each operator card carries the same equipment-shift Pulse snapshot.
  const breakdown=kind==='equipment'&&batchId&&data.breakdownHoursSource==='pulse'?meterUnits(data.breakdownHours):0;
  if(breakdown&&total+breakdown>Number(data.shiftHours)*1000){
   throw Object.assign(new Error(`Combined working HMR (${total/1000} h) and Pulse breakdown (${breakdown/1000} h) exceed the ${data.shiftHours}-hour equipment shift.`),
    {status:409,details:{code:'shift_hmr_breakdown_limit'}});
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
