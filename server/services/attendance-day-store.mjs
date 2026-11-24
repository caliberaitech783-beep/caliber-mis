// Stored locked days (owner, 16 Nov 2026). Attendance Batch-wise, Month-wise and the HR feed count only fully locked
// site-days, and a locked day does not change. So the card fields the attendance build needs are kept per site and date
// once the day is locked, and the report reads them instead of reading every card again.
//
// A stored day is used only while it still matches the cards and batches as they are now. Each stored day carries a
// signature of:
//  - its cards: how many, the sum of their ids and the sum of their revisions. Every edit raises a card's revision; a card
//    added, deleted, restored or moved to another date or site changes the count or the ids.
//  - its batches: each batch id with its lock count (closure_revision), which rises every time the batch is locked again.
// A batch that is reopened takes its day out of the reports at once (the locked-days rule); when it is locked again its
// lock count has risen, so the stored day no longer matches and is read live, then stored again by the next sweep.
// The report never writes: it reads stored days that match and reads the rest live. The sweep below fills the store.
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {OPERATIONAL_START} from '../../shared/operational-start.mjs';
import {lockedSiteDays,nextReportDate} from '../rules/manpower-report.mjs';

export const ATTENDANCE_DAY_STORE_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_attendance_day_cards(
 site TEXT NOT NULL,book_date DATE NOT NULL,signature TEXT NOT NULL,card_count INTEGER NOT NULL,cards JSONB NOT NULL,
 built_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(book_date,site));`;
// The switch: ATTENDANCE_DAY_STORE=0 turns off both the sweep and the use of stored days (everything is read live).
export const attendanceDayStoreEnabled=(env=process.env)=>env.ATTENDANCE_DAY_STORE!=='0';

const HISTORY_CARD_FIELDS=['bookDate','location','bookShiftCode','cardShift','shiftName','shiftId','masterShiftStart','door','assetId','employeeId','caliberId','employeeName','openingHmr','closingHmr','openingKmr','closingKmr','completedTrips','totalTrips','scanBatchId','scanCardId'];
// The attendance register needs the duty fields plus the trip rows (trip count), the second operator and ELB trips.
// manualShift and shiftHours: the Day / Night choice of a manual card and its hours (shared/duty-shift.mjs).
export const ATTENDANCE_CARD_FIELDS=[...HISTORY_CARD_FIELDS,'trips','timeMode','operatorSplit','fleetTrips','manualShift','shiftHours'];
export {HISTORY_CARD_FIELDS};

const CARD_LIMIT=50000;
const dayKey=(site,date)=>site+'\u0000'+date;
const siteDay=(site,date)=>canonicalSiteName(site)+'|'+date;
// The batches of each site-day (canonical site), as "id@lock count" in a fixed order.
export function batchSignatures(batches){
 const out=new Map();
 for(const b of batches){const k=siteDay(b.site,b.report_date);if(!out.has(k))out.set(k,[]);out.get(k).push(String(b.id)+'@'+Number(b.closure_revision||0)+(b.closed_at?'':'!'));}
 for(const [k,list] of out)out.set(k,list.sort().join(','));
 return out;
}
// The live signature of every saved site-day (card site as written) in the dates, with its batches.
export async function cardSignatures(client,{from,to},sites,batches){
 const {rows}=await client.query(`SELECT site,book_date::text AS date,count(*)::int AS n,sum(id)::text AS ids,sum(revision)::text AS revs
  FROM mis_log_books WHERE book_type IN ('vehicle','equipment','lmv') AND deleted_at IS NULL AND book_date>=$$2026-11-01$$
  AND book_date BETWEEN $1 AND $2 AND ($3::text[] IS NULL OR site=ANY($3::text[])) GROUP BY site,book_date`,[from,to,sites]);
 const ofBatches=batchSignatures(batches),out=new Map();
 for(const r of rows)out.set(dayKey(r.site,r.date),{site:r.site,date:r.date,count:r.n,signature:`${r.n}:${r.ids}:${r.revs}|${ofBatches.get(siteDay(r.site,r.date))||''}`});
 return out;
}
// The card fields of the listed site-days (card site as written), read live from the log books.
const DAY_CARDS_SQL=(limit)=>`SELECT l.id,l.book_no,l.book_type,l.book_date::text,l.site,l.asset_id,
  (SELECT COALESCE(jsonb_object_agg(field.key,field.value),'{}'::jsonb) FROM jsonb_each(l.data) AS field WHERE field.key=ANY($5::text[])) AS data,
  '[]'::jsonb AS batches
  FROM mis_log_books l WHERE l.book_type IN ('vehicle','equipment','lmv') AND l.deleted_at IS NULL AND l.book_date>=$$2026-11-01$$
  AND l.book_date BETWEEN $3 AND $4 AND (l.site,l.book_date) IN (SELECT want.site,want.book_date FROM unnest($1::text[],$2::date[]) AS want(site,book_date))
  ORDER BY l.book_date,l.id LIMIT ${limit}`;
const dayArgs=(days,fields)=>{const dates=days.map(d=>d.date).sort();return [days.map(d=>d.site),days.map(d=>d.date),dates[0],dates.at(-1),fields];};
const tooLarge=()=>Object.assign(new Error('Earlier duty history is too large to read for this selection. Open one site and try again.'),{status:400});
async function readDayCards(client,days,fields){
 if(!days.length)return [];
 const {rows}=await client.query(DAY_CARDS_SQL(CARD_LIMIT+1),dayArgs(days,fields));
 if(rows.length>CARD_LIMIT)throw tooLarge();
 return rows;
}
// The same cards as one JSON text, built by Postgres (24 Nov 2026). Unpacking a week of every site's cards (with their trip
// rows) held the server's main thread for seconds; the text goes to a report worker as it is (report-build-pool.mjs).
// id and asset_id are BIGINT, which the database driver hands over as text, so they are sent as text here too.
async function readDayCardsText(client,days,fields){
 if(!days.length)return {text:'[]',count:0};
 const sql=DAY_CARDS_SQL(CARD_LIMIT+1).replace('SELECT l.id,l.book_no,l.book_type,l.book_date::text,l.site,l.asset_id,','SELECT l.id::text AS id,l.book_no,l.book_type,l.book_date::text AS book_date,l.site,l.asset_id::text AS asset_id,');
 const {rows:[row]}=await client.query(`SELECT count(*)::int AS n,COALESCE(json_agg(c ORDER BY c.book_date,c.id::bigint),'[]')::text AS cards FROM (${sql}) c`,dayArgs(days,fields));
 if(row.n>CARD_LIMIT)throw tooLarge();
 return {text:row.cards,count:row.n};
}
// The cards of the locked site-days in the dates: from the store where the stored day still matches, the rest live.
// Days that are not locked are not read at all; the locked-days rule leaves them out of the report anyway.
// asText: the cards come as JSON texts (cardsJson, each a JSON array) instead of rows, with the site-days they cover (days).
// The saved site-days in the dates that are locked, with their signatures: what lockedDayCards reads.
export const lockedSignedDays=(signatures,{from,to},locked)=>[...signatures.values()].filter(d=>d.date>=from&&d.date<=to&&locked.has(siteDay(d.site,d.date)));
export async function lockedDayCards(client,{from,to},{sites,locked,signatures,useStore=true,fields=ATTENDANCE_CARD_FIELDS,asText=false}){
 const wanted=lockedSignedDays(signatures,{from,to},locked);
 if(!wanted.length)return asText?{cardsJson:[],days:[],stored:0,live:0}:{rows:[],stored:0,live:0};
 const fresh=new Map();
 if(useStore){
  const {rows}=await client.query(`SELECT site,book_date::text AS date,signature,${asText?'cards::text AS cards':'cards'} FROM mis_attendance_day_cards
   WHERE book_date BETWEEN $1 AND $2 AND ($3::text[] IS NULL OR site=ANY($3::text[]))`,[from,to,sites]);
  for(const r of rows){const k=dayKey(r.site,r.date);if(signatures.get(k)?.signature===r.signature)fresh.set(k,r.cards);}
 }
 const missing=wanted.filter(d=>!fresh.has(dayKey(d.site,d.date)));
 const counts={stored:wanted.length-missing.length,live:missing.length};
 if(asText){
  const live=await readDayCardsText(client,missing,fields);
  return {cardsJson:[...wanted.flatMap(d=>fresh.has(dayKey(d.site,d.date))?[fresh.get(dayKey(d.site,d.date))]:[]),live.text],days:wanted,...counts};
 }
 const live=await readDayCards(client,missing,fields);
 const stored=wanted.flatMap(d=>fresh.get(dayKey(d.site,d.date))||[]);
 return {rows:[...stored,...live],...counts};
}
// The batches of every card of the listed site-days, as one JSON text {card id: [{id,name,closed_at}]}: the stored days keep
// no batch, and Site Sheet vs Trip Card and Trip Card vs Bio-punch filter by it. Same cards as lockedDayCards reads.
export async function dayCardBatchesText(client,days){
 if(!days.length)return '{}';
 const dates=days.map(d=>d.date).sort();
 const {rows:[row]}=await client.query(`SELECT COALESCE(json_object_agg(x.id,x.batches),'{}')::text AS links FROM (
  SELECT e.logbook_id::text AS id,jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'closed_at',b.closed_at) ORDER BY b.id) AS batches
  FROM mis_vlb_batch_entries e JOIN mis_vlb_batches b ON b.id=e.batch_id JOIN mis_log_books l ON l.id=e.logbook_id
  WHERE b.archived_at IS NULL AND b.deleted_at IS NULL AND l.book_type IN ('vehicle','equipment','lmv') AND l.deleted_at IS NULL AND l.book_date>=$$2026-11-01$$
  AND l.book_date BETWEEN $3 AND $4 AND (l.site,l.book_date) IN (SELECT want.site,want.book_date FROM unnest($1::text[],$2::date[]) AS want(site,book_date))
  GROUP BY e.logbook_id) x`,[days.map(d=>d.site),days.map(d=>d.date),dates[0],dates.at(-1)]);
 return row?.links||'{}';
}

const SHIFT_MASTER_SQL="SELECT id,record_data FROM master_records WHERE master_name='Shift Master' ORDER BY id";
const BATCHES_SQL=`SELECT id,site,book_date::text AS report_date,shift,closed_at,closure_revision FROM mis_vlb_batches
 WHERE deleted_at IS NULL AND archived_at IS NULL AND book_date BETWEEN $1 AND $2`;
export const ATTENDANCE_BATCH_COLUMNS='id,name,site,book_date::text AS report_date,closed_at,shift,stage,closure_revision';
const istToday=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));

// The sweep stores every locked site-day of the last `days` days that is missing from the store or no longer matches.
// It runs with no request (trusted scope), one site-day per short transaction, at most `perPass` days a run, and only
// one copy at a time across app instances (advisory lock).
export function attendanceDayStoreSweep({pool,ensure=async()=>{},days=45,perPass=40,intervalMs=10*60000,firstRunMs=5*60000,now=()=>Date.now(),log=console}){
 let timer=null,busy=false;
 const runOnce=async()=>{
  if(busy)return {skipped:'busy'};busy=true;let client,locked=false;
  try{
   await ensure();
   client=await pool.connect();
   locked=(await client.query("SELECT pg_try_advisory_lock(hashtext('mis_attendance_day_cards')) AS ok")).rows[0]?.ok===true;
   if(!locked)return {skipped:'another instance'};
   const to=istToday(now()),earliest=nextReportDate(to,-days),from=earliest<OPERATIONAL_START?OPERATIONAL_START:earliest;
   const shifts=(await client.query(SHIFT_MASTER_SQL)).rows.map(r=>({...r.record_data,id:String(r.id)}));
   const batches=(await client.query(BATCHES_SQL,[from,to])).rows;
   const lockedDays=lockedSiteDays(shifts,batches);
   const signatures=await cardSignatures(client,{from,to},null,batches);
   const stored=new Map((await client.query('SELECT site,book_date::text AS date,signature FROM mis_attendance_day_cards WHERE book_date BETWEEN $1 AND $2',[from,to])).rows.map(r=>[dayKey(r.site,r.date),r.signature]));
   const stale=[...signatures.values()].filter(d=>lockedDays.has(siteDay(d.site,d.date))&&stored.get(dayKey(d.site,d.date))!==d.signature)
    .sort((a,b)=>b.date.localeCompare(a.date)).slice(0,perPass);
   let saved=0;
   for(const day of stale){
    try{
     // The day's signature and cards from one snapshot, so what is stored is exactly what the signature describes.
     await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
     const dayBatches=(await client.query(BATCHES_SQL,[day.date,day.date])).rows;
     if(!lockedSiteDays(shifts,dayBatches).has(siteDay(day.site,day.date))){await client.query('ROLLBACK');continue;}
     const current=(await cardSignatures(client,{from:day.date,to:day.date},[day.site],dayBatches)).get(dayKey(day.site,day.date));
     if(!current){await client.query('ROLLBACK');continue;}
     const cards=await readDayCards(client,[day],ATTENDANCE_CARD_FIELDS);
     await client.query(`INSERT INTO mis_attendance_day_cards(site,book_date,signature,card_count,cards,built_at) VALUES($1,$2,$3,$4,$5::jsonb,NOW())
      ON CONFLICT(book_date,site) DO UPDATE SET signature=EXCLUDED.signature,card_count=EXCLUDED.card_count,cards=EXCLUDED.cards,built_at=EXCLUDED.built_at`,
      [day.site,day.date,current.signature,cards.length,JSON.stringify(cards)]);
     await client.query('COMMIT');saved++;
    }catch(error){await client.query('ROLLBACK').catch(()=>{});log.error?.('Attendance day store:',day.site,day.date,error.code||error.message);}
   }
   return {checked:signatures.size,stale:stale.length,saved};
  }finally{
   if(client){if(locked)await client.query("SELECT pg_advisory_unlock(hashtext('mis_attendance_day_cards'))").catch(()=>{});client.release();}
   busy=false;
  }
 };
 return {runOnce,start(){if(timer||!intervalMs)return;const tick=()=>void runOnce().catch(e=>log.error?.('Attendance day store:',e.code||e.message));
  timer=setTimeout(()=>{tick();timer=setInterval(tick,intervalMs);timer.unref?.();},firstRunMs);timer.unref?.();},
  stop(){clearTimeout(timer);clearInterval(timer);timer=null;}};
}
