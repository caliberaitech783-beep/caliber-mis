import {isJayantSecondShift} from '../../shared/site-shift-hours.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {CARD_SHIFTS,normalizeCardShift,VLB_SHIFT_KMR_LIMIT} from '../../shared/trip-card-rules.mjs';
import {vlbRecordShift} from '../../shared/vlb-batch-format.mjs';
import {cardWorkingHmr} from '../../shared/log-book-shared-shift.mjs';
import {cardHasDummyEmployee} from '../../shared/dummy-employee-ids.mjs';

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

// One driver, one shift, one payment (owner, 23 Nov 2026): "in a shift he has worked in 2 different trucks … in both
// his number should be there … the payment only will be calculated for one … if a driver works for more than 8 hours,
// then also he will get single shift payment only." A driver's cards of one shift are one duty in every attendance
// view (server/rules/manpower-report.mjs, dutiesOf), whatever number of vehicles and whatever hours they add up to,
// so hours beyond the shift never keep the driver's number off a card and never add a payment.
// They are still a doubt about the number: the second card is most often a colleague's whose number was misread.
// So such a card waits for one answer from a person, "did this driver also drive this vehicle?". The answer is kept on
// the card (driverShiftConfirmed: who and when). A card being edited is not asked again when it, or another card of
// that driver and shift, already carries the answer; every further vehicle added to the shift is asked once.
export const driverShiftConfirmed=data=>Boolean(data?.driverShiftConfirmed);
export const driverShiftMark=(by,at=new Date().toISOString())=>({by:String(by||'').slice(0,120),at});
async function assertVlbDriverShiftHmr(client,data,recordId){
 const shift=vlbRecordShift(data);
 const limit=shiftHmrLimit(data,shift);
 const employeeId=String(data.employeeId??'').trim();
 const caliberId=String(data.caliberId??'').trim().toUpperCase();
 // A dummy ID is many temporary drivers, so their hours are not one person's.
 if(!limit||(!employeeId&&!caliberId)||cardHasDummyEmployee(data))return;
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
 if(driverShiftConfirmed(data)||recordId&&peers.some(row=>driverShiftConfirmed(row.data)))return;
 const conflicts=peers.map(row=>({id:String(row.id),bookNo:row.book_no}));
 const driver=String(data.employeeName||data.caliberId||employeeId).trim(),cards=conflicts.map(row=>row.bookNo).join(', ');
 throw Object.assign(new Error(`${driver} already has card ${cards} on another vehicle in this shift (${data.bookDate}, shift ${shift}). With this card the working HMR comes to ${total/1000} hours (${saved/1000} already saved); the shift is ${limit} hours. If ${driver} also drove this vehicle, save this card and answer Yes: it stays under ${driver} and one shift is counted. If not, correct the driver on this card.`),
  {status:409,details:{code:'driver_shift_hmr_limit',conflicts,confirm:{driver,hours:total/1000,limit}}});
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
