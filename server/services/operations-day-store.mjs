// Stored closed days for the Operations reports (owner, 18 Nov 2026: "the batches which are closed … pre-buffer it, so it
// will not take time … if a batch is recreated or modified … again it should buffer … every day morning 4 a.m.").
//
// What is stored: per site and date, every saved VLB and ELB card of that day already cut down to what the step reports
// read (OPERATIONS_RECORD_FIELDS) with its trip count worked out, so a report reads a few small rows per day instead of
// every card with its trip rows. Only days whose batches are all locked are stored (the locked-days rule of the
// attendance store); today and any day still open are always read live.
//
// When a stored day is used: only while it still matches the cards and batches as they are now. Each stored day carries
// a signature of its cards (how many, the sum of their ids, the sum of their revisions: every edit raises a revision; a
// card added, deleted, restored or moved changes the count or the ids) and of its batches (each batch id with its lock
// count, which rises every time the batch is locked again; an open batch is marked). A reopened, changed or relocked
// batch therefore no longer matches: its day is read live at once, and the sweep stores it again within minutes.
//
// When it is stored: a sweep every five minutes stores the newest locked days that are missing or no longer match (40 a
// run), and once a day after 04:30 IST it goes through every locked day of the last 45 days. One server at a time.
// OPERATIONS_DAY_STORE=0 turns off both the sweep and the use of stored days (everything is read live).
import {OPERATIONAL_START,operationalDate} from '../../shared/operational-start.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {withVlbTripCounts} from '../../shared/vlb-trip-handover.mjs';
import {lockedSiteDays,nextReportDate} from '../rules/manpower-report.mjs';

export const OPERATIONS_DAY_STORE_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_operations_day_records(
 site TEXT NOT NULL,book_date DATE NOT NULL,signature TEXT NOT NULL,record_count INTEGER NOT NULL,records JSONB NOT NULL,
 built_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(book_date,site));`;
export const operationsDayStoreEnabled=(env=process.env)=>env.OPERATIONS_DAY_STORE!=='0';

// The card fields the step reports read (src/operations-report-model.mjs and src/saved-report-steps-model.mjs).
// test/operations-day-store.test.mjs builds every step report from these and from whole cards and expects the same tables.
export const OPERATIONS_RECORD_FIELDS=['bookDate','location','shiftName','shiftId','masterShiftStart','assetId','door','caliberId',
 'employeeName','employeeId','workOrderContract','openingKmr','closingKmr','replacementKmr','openingHmr','closingHmr','shiftHours',
 'remark','breakdownHours','breakdownHoursSource','hoursWarning'];
// What a live read takes from each card: the fields above plus what the trip count is worked out from.
const READ_FIELDS=[...OPERATIONS_RECORD_FIELDS,'trips','timeMode','completedTrips','totalTrips'];
// Raising this stores every day again (the stored form changed).
const FORM='ops-v1';

const num=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const siteDay=(site,date)=>canonicalSiteName(site)+'|'+date;
const dayKey=(site,date)=>site+'\u0000'+date;

// A card as the step reports need it. Its trips become one count, the same count normalise() would add up from the rows.
export function operationsStepRecord(row){
 const source=row.data&&typeof row.data==='object'?row.data:{},data={};
 for(const field of OPERATIONS_RECORD_FIELDS)if(source[field]!==undefined)data[field]=source[field];
 data.completedTrips=num(source.completedTrips)??num(source.totalTrips)??(Array.isArray(source.trips)?source.trips:[]).reduce((s,t)=>s+(num(t?.completedTrips)??num(t?.tripCount)??0),0);
 return {id:row.id,book_no:row.book_no,book_type:row.book_type,data};
}
// Cards read with their trip rows → step records, VLB trip counts worked out as the VLB register counts them.
export function operationsStepRecords(rows){
 const vehicles=withVlbTripCounts(rows.filter(r=>r.book_type==='vehicle'));
 return [...vehicles,...rows.filter(r=>r.book_type!=='vehicle'&&operationalDate(r.data?.bookDate))].map(operationsStepRecord);
}
// The order the Operations reading always had: VLB cards first, each kind by date and id. Report lines that add cards up
// keep the order the cards come in, so stored and live days together must come back in this order.
export const sortStepRecords=records=>records.sort((a,b)=>(a.book_type==='vehicle'?0:1)-(b.book_type==='vehicle'?0:1)||String(a.data.bookDate).localeCompare(String(b.data.bookDate))||Number(a.id)-Number(b.id));

// The batches of each site-day (canonical site), as "id@lock count" in a fixed order; "!" marks a batch not locked.
function batchSignatures(batches){
 const out=new Map();
 for(const b of batches){const k=siteDay(b.site,b.report_date);if(!out.has(k))out.set(k,[]);out.get(k).push(String(b.id)+'@'+Number(b.closure_revision||0)+(b.closed_at?'':'!'));}
 for(const [k,list] of out)out.set(k,list.sort().join(','));
 return out;
}
// The live signature of every site-day with saved VLB/ELB cards (card site as written) in the dates.
export async function operationsDaySignatures(client,{from,to},batches,sites=null){
 const {rows}=await client.query(`SELECT site,book_date::text AS date,count(*)::int AS n,sum(id)::text AS ids,sum(revision)::text AS revs
  FROM mis_log_books WHERE book_type IN ('vehicle','equipment') AND deleted_at IS NULL AND book_date>=$$2026-11-01$$
  AND book_date BETWEEN $1 AND $2 AND ($3::text[] IS NULL OR site=ANY($3::text[])) GROUP BY site,book_date`,[from,to,sites]);
 const ofBatches=batchSignatures(batches),out=new Map();
 for(const r of rows)out.set(dayKey(r.site,r.date),{site:r.site,date:r.date,signature:`${FORM}|${r.n}:${r.ids}:${r.revs}|${ofBatches.get(siteDay(r.site,r.date))||''}`});
 return out;
}
// The cards of the listed site-days, read live with only the fields the step records are made from.
async function readDayRows(client,days){
 if(!days.length)return [];
 const dates=days.map(d=>d.date).sort();
 const {rows}=await client.query(`SELECT l.id,l.book_no,l.book_type,
  (SELECT COALESCE(jsonb_object_agg(field.key,field.value),'{}'::jsonb) FROM jsonb_each(l.data) AS field WHERE field.key=ANY($5::text[])) AS data
  FROM mis_log_books l WHERE l.book_type IN ('vehicle','equipment') AND l.deleted_at IS NULL AND l.book_date>=$$2026-11-01$$
  AND l.book_date BETWEEN $3 AND $4 AND (l.site,l.book_date) IN (SELECT want.site,want.book_date FROM unnest($1::text[],$2::date[]) AS want(site,book_date))
  ORDER BY l.book_date,l.id`,[days.map(d=>d.site),days.map(d=>d.date),dates[0],dates.at(-1),READ_FIELDS]);
 return rows;
}

export const OPERATIONS_BATCHES_SQL=`SELECT id,site,book_date::text AS report_date,shift,closed_at,closure_revision FROM mis_vlb_batches
 WHERE deleted_at IS NULL AND archived_at IS NULL AND book_date BETWEEN $1 AND $2`;

// The step records of every saved VLB/ELB card in the dates: stored days that still match, the rest read live.
export async function operationsDayRecords(client,{from,to},{useStore=true}={}){
 const batches=(await client.query(OPERATIONS_BATCHES_SQL,[from,to])).rows;
 const signatures=await operationsDaySignatures(client,{from,to},batches);
 const fresh=new Map();
 if(useStore&&signatures.size){
  const {rows}=await client.query('SELECT site,book_date::text AS date,signature,records FROM mis_operations_day_records WHERE book_date BETWEEN $1 AND $2',[from,to]);
  for(const r of rows){const k=dayKey(r.site,r.date);if(signatures.get(k)?.signature===r.signature)fresh.set(k,r.records);}
 }
 const missing=[...signatures.entries()].filter(([k])=>!fresh.has(k)).map(([,d])=>d);
 const live=operationsStepRecords(await readDayRows(client,missing));
 return {records:sortStepRecords([...[...fresh.values()].flat(),...live]),stored:fresh.size,live:missing.length};
}

const istNow=now=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));return {date:`${parts.year}-${parts.month}-${parts.day}`,minutes:Number(parts.hour)*60+Number(parts.minute)};};
export const NIGHTLY_MINUTES=4*60+30;
const SHIFT_MASTER_SQL="SELECT id,record_data FROM master_records WHERE master_name='Shift Master' ORDER BY id";

// The sweep. Each stored day is read in one snapshot with its signature, so what is stored is exactly what it describes.
export function operationsDayStoreSweep({pool,ensure=async()=>{},days=45,perPass=40,intervalMs=5*60000,firstRunMs=4*60000,now=()=>Date.now(),log=console}){
 let timer=null,busy=false,nightlyDone='';
 const runOnce=async({all=false}={})=>{
  if(busy)return {skipped:'busy'};busy=true;let client,locked=false;
  try{
   await ensure();
   client=await pool.connect();
   locked=(await client.query("SELECT pg_try_advisory_lock(hashtext('mis_operations_day_records')) AS ok")).rows[0]?.ok===true;
   if(!locked)return {skipped:'another instance'};
   const {date:to,minutes}=istNow(now());
   const nightly=all||(minutes>=NIGHTLY_MINUTES&&nightlyDone!==to);
   const earliest=nextReportDate(to,-days),from=earliest<OPERATIONAL_START?OPERATIONAL_START:earliest;
   const shifts=(await client.query(SHIFT_MASTER_SQL)).rows.map(r=>({...r.record_data,id:String(r.id)}));
   const batches=(await client.query(OPERATIONS_BATCHES_SQL,[from,to])).rows;
   const lockedDays=lockedSiteDays(shifts,batches);
   const signatures=await operationsDaySignatures(client,{from,to},batches);
   const stored=new Map((await client.query('SELECT site,book_date::text AS date,signature FROM mis_operations_day_records WHERE book_date BETWEEN $1 AND $2',[from,to])).rows.map(r=>[dayKey(r.site,r.date),r.signature]));
   const stale=[...signatures.values()].filter(d=>lockedDays.has(siteDay(d.site,d.date))&&stored.get(dayKey(d.site,d.date))!==d.signature)
    .sort((a,b)=>b.date.localeCompare(a.date)).slice(0,nightly?Infinity:perPass);
   let saved=0;
   for(const day of stale){
    try{
     await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
     const dayBatches=(await client.query(OPERATIONS_BATCHES_SQL,[day.date,day.date])).rows;
     if(!lockedSiteDays(shifts,dayBatches).has(siteDay(day.site,day.date))){await client.query('ROLLBACK');continue;}
     const current=(await operationsDaySignatures(client,{from:day.date,to:day.date},dayBatches,[day.site])).get(dayKey(day.site,day.date));
     if(!current){await client.query('ROLLBACK');continue;}
     const records=operationsStepRecords(await readDayRows(client,[day]));
     await client.query(`INSERT INTO mis_operations_day_records(site,book_date,signature,record_count,records,built_at) VALUES($1,$2,$3,$4,$5::jsonb,NOW())
      ON CONFLICT(book_date,site) DO UPDATE SET signature=EXCLUDED.signature,record_count=EXCLUDED.record_count,records=EXCLUDED.records,built_at=EXCLUDED.built_at`,
      [day.site,day.date,current.signature,records.length,JSON.stringify(records)]);
     await client.query('COMMIT');saved++;
    }catch(error){await client.query('ROLLBACK').catch(()=>{});log.error?.('Operations day store:',day.site,day.date,error.code||error.message);}
   }
   if(nightly&&!all)nightlyDone=to;
   return {checked:signatures.size,stale:stale.length,saved,nightly};
  }finally{
   if(client){if(locked)await client.query("SELECT pg_advisory_unlock(hashtext('mis_operations_day_records'))").catch(()=>{});client.release();}
   busy=false;
  }
 };
 return {runOnce,start(){if(timer||!intervalMs)return;const tick=()=>void runOnce().catch(e=>log.error?.('Operations day store:',e.code||e.message));
  timer=setTimeout(()=>{tick();timer=setInterval(tick,intervalMs);timer.unref?.();},firstRunMs);timer.unref?.();},
  stop(){clearTimeout(timer);clearInterval(timer);timer=null;}};
}
