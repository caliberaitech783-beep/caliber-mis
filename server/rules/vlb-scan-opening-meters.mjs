import {vlbRecordShift} from '../../shared/vlb-batch-format.mjs';
import {validTripTime} from '../../shared/vlb-trip-handover.mjs';
import {CARD_SHIFTS,normalizeCardShift} from '../../shared/trip-card-rules.mjs';

const shiftOrder={S1:1,S2:2,S3:3,D:4,N:5};
const openingFields=['openingKmr','openingHmr'];
const reading=value=>['string','number'].includes(typeof value)&&String(value).trim()!==''&&Number.isFinite(Number(value));
const seconds=value=>value.split(':').reduce((total,part,index)=>total+Number(part)*[3600,60,1][index],0);

function tripTimes(trips){
 return (Array.isArray(trips)?trips:[]).flatMap(row=>['loadingTime','unloadingTime']
  .filter(key=>validTripTime(row?.[key])&&!row.timeEstimates?.[key])
  .map(key=>seconds(row[key])));
}

export async function fillVlbScanOpeningMeters(client,draft,{sites,extraction={}}){
 const assetId=String(draft.assetId??'');
 const date=draft.bookDate;
 const shift=vlbRecordShift({cardShift:draft.cardShift});
 const times=tripTimes(draft.trips);
 const identity=[assetId,date,shift,draft.location,...times].join('|');
 const source=draft.openingMeterCarryover;
 const next={...draft};
 const values={};
 for(const field of openingFields){
  if(source?.values?.[field]===undefined||String(source.values[field])!==String(draft[field]))continue;
  if(source.identity===identity)values[field]=draft[field];
  else next[field]='';
 }
 const candidates=openingFields.filter(field=>values[field]===undefined&&
  (!reading(next[field])||(!source&&reading(extraction[field])&&String(extraction[field])===String(next[field]))));
 if(candidates.length&&/^[1-9]\d{0,17}$/.test(assetId)&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&shift){
  const {rows}=await client.query(`
   SELECT to_char(book_date,'YYYY-MM-DD') AS date, data->>'bookShiftCode' AS "bookShiftCode",
    data->>'cardShift' AS "cardShift", data->>'shiftName' AS "shiftName",
    data->'closingKmr' AS "openingKmr", data->'closingHmr' AS "openingHmr",
    CASE WHEN book_date=$2::date THEN data->'trips' END AS trips,
    data->>'masterShiftStart' AS "masterShiftStart"
   FROM mis_log_books
   WHERE book_type='vehicle' AND deleted_at IS NULL AND asset_id=$1
    AND ($3::text[] IS NULL OR site=ANY($3))
    AND book_date IN ($2::date, (
     SELECT max(book_date) FROM mis_log_books
     WHERE book_type='vehicle' AND deleted_at IS NULL AND asset_id=$1 AND book_date<$2::date
      AND ($3::text[] IS NULL OR site=ANY($3))
    ))
   ORDER BY book_date DESC,id DESC`,[assetId,date,sites]);
  const previous=rows.map(row=>{
   const rank=shiftOrder[vlbRecordShift(row)]||0;
   let lastTrip=-Infinity;
   const start=validTripTime(row.masterShiftStart)?row.masterShiftStart:CARD_SHIFTS[normalizeCardShift(shift)]?.start;
   if(row.date===date&&rank===shiftOrder[shift]&&start&&times.length){
    const relative=time=>(time-seconds(start)+86400)%86400;
    const end=Math.max(...tripTimes(row.trips).map(relative));
    if(end<=Math.min(...times.map(relative)))lastTrip=end;
   }
   return {row,rank,lastTrip};
  }).filter(({row,rank,lastTrip})=>row.date<date||(rank>0&&rank<shiftOrder[shift])||Number.isFinite(lastTrip))
   .sort((a,b)=>b.row.date.localeCompare(a.row.date)||b.rank-a.rank||b.lastTrip-a.lastTrip)[0]?.row;
  const filled=candidates.filter(field=>reading(previous?.[field]));
  for(const field of filled)next[field]=values[field]=previous[field];
  for(const key of ['meterReviewFields','extractionReviewFields']){
   if(filled.length&&Array.isArray(next[key]))next[key]=next[key].filter(field=>!filled.includes(field));
  }
 }
 if(source||Object.keys(values).length)next.openingMeterCarryover={identity,values};
 return next;
}
