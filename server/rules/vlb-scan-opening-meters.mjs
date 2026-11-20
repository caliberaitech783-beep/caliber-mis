import {vlbRecordShift} from '../../shared/vlb-batch-format.mjs';
import {validTripTime} from '../../shared/vlb-trip-handover.mjs';
import {CARD_SHIFTS,normalizeCardShift,VLB_SHIFT_KMR_LIMIT} from '../../shared/trip-card-rules.mjs';

const shiftOrder={S1:1,S2:2,S3:3,D:4,N:5};
const openingFields=['openingKmr','openingHmr'];
const reading=value=>['string','number'].includes(typeof value)&&String(value).trim()!==''&&Number.isFinite(Number(value));
const seconds=value=>value.split(':').reduce((total,part,index)=>total+Number(part)*[3600,60,1][index],0);

function fitsClosing(field,value,draft,hours){
 if(!reading(value)||Number(value)<0)return false;
 const closing=draft[field.replace('opening','closing')];
 if(!reading(closing)||Number(closing)<0)return true;
 const limit=field==='openingKmr'?VLB_SHIFT_KMR_LIMIT:hours;
 const delta=Number(closing)-Number(value);
 return delta>=0&&delta-limit<=Number.EPSILON*Math.max(1,Math.abs(Number(value)),Math.abs(Number(closing)))*4;
}

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
const METER_HISTORY_SQL=`
 SELECT cards.asset_id::text AS asset_id, ${METER_COLUMNS}
 FROM unnest($1::bigint[]) AS assets(asset_id)
 LEFT JOIN LATERAL (
  SELECT book_date AS previous_date FROM mis_log_books
  WHERE book_type='vehicle' AND deleted_at IS NULL AND asset_id=assets.asset_id
   AND book_date<$2::date AND ($3::text[] IS NULL OR site=ANY($3))
  ORDER BY book_date DESC LIMIT 1
 ) previous ON true
 JOIN mis_log_books cards ON cards.asset_id=assets.asset_id
  AND cards.book_date IN ($2::date,previous.previous_date)
 WHERE cards.book_type='vehicle' AND cards.deleted_at IS NULL
  AND ($3::text[] IS NULL OR cards.site=ANY($3))
 ORDER BY cards.book_date DESC,cards.id DESC`;

// Both paths read all shifts on the card date and on the latest earlier allowed date.
export async function readVlbOpeningMeterRows(client,assetId,date,sites){
 const {rows}=await client.query(METER_HISTORY_SQL,[[assetId],date,sites]);
 return rows.map(({asset_id,...row})=>row);
}

export async function preloadVlbOpeningMeterRows(client,assetIds,date,sites){
 const ids=[...new Set(assetIds.map(String))].filter(id=>/^[1-9]\d{0,17}$/.test(id));
 const byAsset=new Map(ids.map(id=>[id,[]]));
 if(!ids.length||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return new Map();
 const {rows}=await client.query(METER_HISTORY_SQL,[ids,date,sites]);
 for(const {asset_id,...row} of rows)byAsset.get(asset_id)?.push(row);
 return byAsset;
}

const METER_HISTORY_INDEX='mis_log_books_vlb_meter_asset_date';
export async function ensureVlbOpeningMeterIndex(pool){
 const client=await pool.connect();
 const lock=2026111901;
 let locked=false;
 try{
  locked=(await client.query('SELECT pg_try_advisory_lock($1) AS locked',[lock])).rows[0].locked;
  if(!locked)return 'busy';
  const {rows:[index]}=await client.query('SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass($1)',[METER_HISTORY_INDEX]);
  if(index?.indisvalid)return;
  if(index)await client.query(`DROP INDEX CONCURRENTLY ${METER_HISTORY_INDEX}`);
  await client.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${METER_HISTORY_INDEX}
   ON mis_log_books(asset_id,book_date DESC) WHERE book_type='vehicle' AND deleted_at IS NULL`);
 }finally{
  try{if(locked)await client.query('SELECT pg_advisory_unlock($1)',[lock]);}
  catch(error){client.release(error);throw error;}
  if(client.release)client.release();
 }
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
 const hours=[8,9,12].includes(Number(context.shiftHours))?Number(context.shiftHours):
  CARD_SHIFTS[normalizeCardShift(context.cardShift)]?.hours??Infinity;
 const fits=(field,value)=>fitsClosing(field,value,draft,hours);
 for(const field of openingFields){
  if(source?.values?.[field]===undefined||String(source.values[field])!==String(draft[field]))continue;
  // Recover existing review drafts where a previous card displaced the scanned value.
  if(!source.version&&fits(field,extraction[field]))next[field]=extraction[field];
  else if(source.identity===identity&&fits(field,draft[field]))values[field]=draft[field];
  else next[field]=reading(extraction[field])?extraction[field]:'';
 }
 const candidates=openingFields.filter(field=>values[field]===undefined&&
  (!reading(next[field])||(String(extraction[field])===String(next[field])&&!fits(field,next[field]))));
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
  const filled=candidates.filter(field=>fits(field,previous?.[field]));
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
  if(!unchanged)next.openingMeterCarryover={version:1,identity,values};
 }
 return next;
}
