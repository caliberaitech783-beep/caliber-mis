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

const METER_COLUMNS=`to_char(book_date,'YYYY-MM-DD') AS date, data->>'bookShiftCode' AS "bookShiftCode",
    data->>'cardShift' AS "cardShift", data->>'shiftName' AS "shiftName",
    data->'closingKmr' AS "openingKmr", data->'closingHmr' AS "openingHmr",
    CASE WHEN book_date=$2::date THEN data->'trips' END AS trips,
    data->>'masterShiftStart' AS "masterShiftStart"`;
// Saved Trip Cards of one vehicle on the card date and on its latest earlier date.
export async function readVlbOpeningMeterRows(client,assetId,date,sites){
 return (await client.query(`
   SELECT ${METER_COLUMNS}
   FROM mis_log_books
   WHERE book_type='vehicle' AND deleted_at IS NULL AND asset_id=$1
    AND ($3::text[] IS NULL OR site=ANY($3))
    AND book_date IN ($2::date, (
     SELECT max(book_date) FROM mis_log_books
     WHERE book_type='vehicle' AND deleted_at IS NULL AND asset_id=$1 AND book_date<$2::date
      AND ($3::text[] IS NULL OR site=ANY($3))
    ))
   ORDER BY book_date DESC,id DESC`,[assetId,date,sites])).rows;
}
// The same rows for many vehicles in one query: a scan entry asks for every card's vehicle at once.
export async function preloadVlbOpeningMeterRows(client,assetIds,date,sites){
 const ids=[...new Set(assetIds.map(String))].filter(id=>/^[1-9]\d{0,17}$/.test(id));
 const byAsset=new Map(ids.map(id=>[id,[]]));
 if(!ids.length||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return new Map();
 const {rows}=await client.query(`
   SELECT l.asset_id::text AS asset_id, ${METER_COLUMNS}
   FROM mis_log_books l
   WHERE l.book_type='vehicle' AND l.deleted_at IS NULL AND l.asset_id=ANY($1::bigint[])
    AND ($3::text[] IS NULL OR l.site=ANY($3))
    AND (l.book_date=$2::date OR l.book_date=(
     SELECT max(p.book_date) FROM mis_log_books p
     WHERE p.book_type='vehicle' AND p.deleted_at IS NULL AND p.asset_id=l.asset_id AND p.book_date<$2::date
      AND ($3::text[] IS NULL OR p.site=ANY($3))
    ))
   ORDER BY l.book_date DESC,l.id DESC`,[ids,date,sites]);
 for(const {asset_id,...row} of rows)byAsset.get(asset_id)?.push(row);
 return byAsset;
}

export async function fillVlbScanOpeningMeters(client,draft,{sites,extraction={},context=draft,readRows=readVlbOpeningMeterRows}){
 const assetId=String(draft.assetId??'');
 const date=context.bookDate;
 const shift=vlbRecordShift({cardShift:context.cardShift});
 const times=tripTimes(draft.trips);
 const identity=[assetId,date,shift,context.location,...times].join('|');
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
  const rows=await readRows(client,assetId,date,sites);
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
 if(source||Object.keys(values).length){
  // Keep the stored object when nothing changed. A rebuilt copy has its keys in
  // a different order from the one PostgreSQL jsonb returns, which made every
  // batch read look like a draft change and raise the card revision.
  const fields=Object.keys(values);
  const unchanged=source?.identity===identity&&Object.keys(source.values||{}).length===fields.length&&
   fields.every(field=>String(source.values[field])===String(values[field]));
  if(!unchanged)next.openingMeterCarryover={identity,values};
 }
 return next;
}
