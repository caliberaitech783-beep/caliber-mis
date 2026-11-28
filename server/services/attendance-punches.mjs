// Who punched, for the attendance build (owner, 24 Nov 2026: "attendance should be fetched if there is punch", with
// "Card + punch" chosen: a trip card left out of attendance because its driver could not be matched to one Employee
// Master person counts when that Caliber ID punched the biometric machine that day at that site. Nobody is marked
// present without a card).
//
// The punches are the site machines' (from HR Pulse, the same read as Caliber Punch Re-check) and the imported ones
// (mis_biometric_punches). HR Pulse is asked at most once per date range every few minutes and waited for only briefly:
// when it does not answer, the attendance read goes on with the imported punches, exactly as without punches.
import {employeeNumber,hrSiteName} from '../../shared/hr-employee-master.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {readHrPunchesWithDayBefore} from './hr-machine-punches.mjs';
import {importedDays,machineDays,mergeBiometricDays} from '../../shared/trip-biometric-check.mjs';

// Fixed blocks of dates (28 Nov 2026). HR Pulse's Attendance roster asks for one day at a time, and each ask reads that day
// with two days on either side. The machine punches were kept by the exact dates asked, so every day asked read about six
// days of every site's punches from HR Pulse again (about 120,000 punches), which no other ask could use. They are now read
// in fixed blocks of PUNCH_BLOCK_DAYS dates counted from 1 Nov 2026, each kept for a few minutes: an ask takes the one or
// two blocks its dates fall in, and the asks for the neighbouring days find them already read. A block is about the size
// of one read before, so HR Pulse is never asked for more at once than it was.
// A block is read with the day before it (hr-machine-punches.mjs), and HR Pulse sends the morning after its last date, so
// a night duty across a block's edge is paired as it was; each block gives only the days of its own dates.
export const PUNCH_BLOCK_DAYS=4;
const BLOCK_START='2026-11-01';
const dayNumber=date=>Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(BLOCK_START+'T00:00:00Z'))/86400000);
// The blocks that hold from … to, as [first date, last date]; dates before 1 Nov 2026 fall in earlier blocks of the same size.
export function punchBlocks(from,to,size=PUNCH_BLOCK_DAYS){
 const out=[];
 for(let n=Math.floor(dayNumber(from)/size);n*size<=dayNumber(to);n++)out.push([addDays(BLOCK_START,n*size),addDays(BLOCK_START,n*size+size-1)]);
 return out;
}
const IMPORTED_PUNCHES_SQL="SELECT caliber_code,punch_date::text AS date,in_time,out_time,site FROM mis_biometric_punches WHERE punch_date BETWEEN $1 AND $2 LIMIT 100001";
const addDays=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);

// One key per person, site and date that punched: "number|siteKey|date"; a punch with no site is "number||date".
export function punchKeys(days){
 const keys=new Set();
 for(const day of Array.isArray(days)?days:[]){
  const number=employeeNumber(day?.caliberCode),date=String(day?.date??'').slice(0,10);
  if(number&&/^\d{4}-\d{2}-\d{2}$/.test(date))keys.add(number+'|'+(canonicalSiteName(day.site)||'')+'|'+date);
 }
 return [...keys].sort();
}
// The keys of one date range (a week of the attendance read, with its adjoining days).
export const punchKeysBetween=(keys,from,to)=>keys.filter(key=>{const date=key.slice(key.lastIndexOf('|')+1);return date>=from&&date<=to;});

// hrPunches: ({from,to}) => HR Pulse's answer (createHrEmployeeSync().biometricPunches); none = machine punches not read.
// Returns read({from,to}) => the punch keys of the dates.
export function createAttendancePunches({pool,hrPunches=null,waitMs=10_000,keepMs=5*60_000,failedKeepMs=60_000,now=Date.now}={}){
 const kept=new Map();
 const machineChunk=(from,to)=>{
  const id=from+'|'+to,held=kept.get(id);
  if(held&&held.until>now())return held;
  let timer;
  const days=Promise.race([
   // Only the days of the block's own dates: the day before it belongs to the block before.
   Promise.resolve().then(()=>readHrPunchesWithDayBefore(hrPunches,{from,to})).then(answer=>machineDays(answer,{siteName:name=>hrSiteName(name)||name}).days.filter(day=>day.date>=from&&day.date<=to)),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('HR Pulse took too long')),waitMs);}),
  ]).finally(()=>clearTimeout(timer));
  // ok: false once HR Pulse did not answer for this block (it is then asked again after failedKeepMs).
  const entry={ok:true,until:now()+keepMs};
  entry.days=days.catch(()=>{entry.ok=false;entry.until=now()+failedKeepMs;return [];});
  kept.set(id,entry);
  for(const [key,value] of kept)if(value.until<=now()&&key!==id)kept.delete(key);
  return entry;
 };
 const machine=async(from,to)=>{
  if(!hrPunches)return [];
  // Two blocks at a time, so a month's read does not take every connection of HR Pulse at once.
  const blocks=punchBlocks(from,to),days=[];
  for(let i=0;i<blocks.length;i+=2){
   const round=blocks.slice(i,i+2).map(([start,end])=>machineChunk(start,end));
   days.push(...(await Promise.all(round.map(entry=>entry.days))).flat());
   // HR Pulse did not answer: the blocks still to come are not waited for as well. The read waits once, as it did
   // before the blocks, and goes on with the imported punches.
   if(round.some(entry=>!entry.ok))break;
  }
  return days;
 };
 const imported=(from,to)=>pool.query(IMPORTED_PUNCHES_SQL,[from,to])
  .then(result=>importedDays(result.rows.map(row=>({caliberCode:row.caliber_code,date:row.date,inTime:row.in_time,outTime:row.out_time,site:row.site}))))
  .catch(error=>{if(error?.code==='42P01'||/does not exist/.test(String(error?.message)))return [];throw error;});
 return async({from,to})=>{
  const [fromMachine,fromImport]=await Promise.all([machine(from,to),imported(from,to)]);
  return punchKeys(mergeBiometricDays(fromMachine,fromImport).filter(day=>day.date>=from&&day.date<=to));
 };
}
