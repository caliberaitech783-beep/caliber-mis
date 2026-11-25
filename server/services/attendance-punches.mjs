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

const IMPORTED_PUNCHES_SQL="SELECT caliber_code,punch_date::text AS date,in_time,out_time,site FROM mis_biometric_punches WHERE punch_date BETWEEN $1 AND $2 LIMIT 100001";
const HR_MAX_DAYS=31;
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
  if(held&&held.until>now())return held.days;
  let timer;
  const days=Promise.race([
   Promise.resolve().then(()=>readHrPunchesWithDayBefore(hrPunches,{from,to})).then(answer=>machineDays(answer,{siteName:name=>hrSiteName(name)||name}).days),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('HR Pulse took too long')),waitMs);}),
  ]).finally(()=>clearTimeout(timer));
  const entry={days:days.catch(()=>{entry.until=now()+failedKeepMs;return [];}),until:now()+keepMs};
  kept.set(id,entry);
  for(const [key,value] of kept)if(value.until<=now()&&key!==id)kept.delete(key);
  return entry.days;
 };
 const machine=async(from,to)=>{
  if(!hrPunches)return [];
  const chunks=[];
  for(let start=from;start<=to;start=addDays(start,HR_MAX_DAYS)){const end=addDays(start,HR_MAX_DAYS-1);chunks.push(machineChunk(start,end<to?end:to));}
  return (await Promise.all(chunks)).flat();
 };
 const imported=(from,to)=>pool.query(IMPORTED_PUNCHES_SQL,[from,to])
  .then(result=>importedDays(result.rows.map(row=>({caliberCode:row.caliber_code,date:row.date,inTime:row.in_time,outTime:row.out_time,site:row.site}))))
  .catch(error=>{if(error?.code==='42P01'||/does not exist/.test(String(error?.message)))return [];throw error;});
 return async({from,to})=>{
  const [fromMachine,fromImport]=await Promise.all([machine(from,to),imported(from,to)]);
  return punchKeys(mergeBiometricDays(fromMachine,fromImport).filter(day=>day.date>=from&&day.date<=to));
 };
}
