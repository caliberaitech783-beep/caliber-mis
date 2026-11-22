// Attendance Management (owner, 20 Nov 2026): biometric punches against trip card / log book attendance.
//
// Biometric punches come from the device's Excel or CSV export, uploaded on "Biometric integration"
// (server/routes/biometric-attendance.mjs keeps one line per employee and date: first In, last Out, site).
// Trip card attendance is the Attendance register's own reading (/api/reports/manpower/attendance): only locked site-days.
//
// Both sides meet on the Caliber code (employee code) and the date. One line is written per finding:
//  - no-biometric   trip card / log book shows the person on duty, no biometric punch that day
//  - no-trip-card   biometric punch, no trip card or zero-trip entry that day (only on a locked site-day)
//  - site-mismatch  punched at one site, the trip card is at another
//  - shift-mismatch the In punch is more than 3 hours from the start of every shift the trip card shows
//  - miss-punch     In without Out, or Out without In                       (Attendance Regularization)
//  - late-come      In more than 15 minutes after the shift start         (Attendance Regularization)
//  - early-going    Out more than 15 minutes before the shift end         (Attendance Regularization)
import {SHIFT_MASTER_DEFAULTS} from './shift-master.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {bookShiftCode} from './trip-card-rules.mjs';

export const GRACE_MINUTES=15;
export const SHIFT_WINDOW_MINUTES=180;
export const MISMATCH_TYPES=[
 {key:'no-biometric',label:'No biometric punch',tone:'red'},
 {key:'no-trip-card',label:'No trip card',tone:'orange'},
 {key:'site-mismatch',label:'Different site',tone:'purple'},
 {key:'shift-mismatch',label:'Different shift',tone:'brown'},
];
export const REGULARIZATION_TYPES={
 'late-early':[{key:'late-come',label:'Late come',tone:'orange'},{key:'early-going',label:'Early going',tone:'brown'}],
 'miss-punch':[{key:'miss-punch',label:'Miss punch',tone:'red'}],
};
export const NO_SITE='Site not given';

// ---- Reading the device export ------------------------------------------------------------------------------------
const norm=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const HEADERS={
 code:['employee code','emp code','empcode','emp no','employee no','caliber id','caliber code','employee id','emp id','code','card no','user id','enroll no','paycode'],
 name:['employee name','emp name','name','user name'],
 date:['date','attendance date','punch date','att date','work date'],
 in:['in time','in','in punch','first punch','punch in','intime','check in','first in'],
 out:['out time','out','out punch','last punch','punch out','outtime','check out','last out'],
 stamp:['punch time','date time','datetime','log time','log date','punch date time','check time','time'],
 site:['site','location','project','branch','device location','unit'],
};
const findHeader=row=>{
 const cells=row.map(norm),at={};
 for(const [field,names] of Object.entries(HEADERS)){const i=cells.findIndex(c=>names.includes(c));if(i>=0)at[field]=i;}
 return at;
};
const pad=n=>String(n).padStart(2,'0');
const isoOf=(y,m,d)=>{const t=Date.UTC(y,m-1,d),dt=new Date(t);return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d?`${y}-${pad(m)}-${pad(d)}`:'';};
const MONTHS={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
export function readDate(value){
 if(value instanceof Date&&!Number.isNaN(value.getTime()))return isoOf(value.getUTCFullYear(),value.getUTCMonth()+1,value.getUTCDate());
 const s=String(value??'').trim();let m;
 if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)))return isoOf(+m[1],+m[2],+m[3]);
 if((m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)))return isoOf(m[3].length===2?2000+ +m[3]:+m[3],+m[2],+m[1]);
 if((m=s.match(/^(\d{1,2})[- ]([a-z]{3})[a-z]*[- ,]+(\d{2,4})/i))&&MONTHS[m[2].toLowerCase()])return isoOf(m[3].length===2?2000+ +m[3]:+m[3],MONTHS[m[2].toLowerCase()],+m[1]);
 return '';
}
export function readTime(value){
 if(value instanceof Date&&!Number.isNaN(value.getTime()))return pad(value.getUTCHours())+':'+pad(value.getUTCMinutes());
 if(typeof value==='number'&&value>=0&&value<1){const mins=Math.round(value*1440)%1440;return pad(Math.floor(mins/60))+':'+pad(mins%60);}
 const s=String(value??'').trim();
 const m=s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i);if(!m)return '';
 let h=+m[1];const min=+m[2];if(min>59)return '';
 if(m[3]){if(h<1||h>12)return '';h=h%12+(/^p/i.test(m[3])?12:0);}
 return h<24?pad(h)+':'+pad(min):'';
}
const stampParts=value=>{
 if(value instanceof Date&&!Number.isNaN(value.getTime()))return {date:readDate(value),time:readTime(value)};
 const s=String(value??'').trim();return {date:readDate(s),time:readTime(s.replace(/^\S+\s+/,''))};
};
// CMLL5311, CMPL5311 and 5311 are one person: the device gives the bare number, a trip card gives the Caliber ID.
export const employeeCode=value=>{const s=String(value??'').trim().toUpperCase().replace(/\s+/g,''),m=s.match(/^(?:CMLL|CMPL)?[-/]?(\d+)$/);return m?String(Number(m[1])):s;};

// Turns the device export (rows of cells, the first rows may be titles) into one punch line per employee and date.
// Two layouts are read: In / Out columns, or one line per punch (a Punch time column): first punch In, last punch Out.
export function parseBiometricSheet(sheet){
 const rows=Array.isArray(sheet)?sheet:[];
 const headerAt=rows.slice(0,20).findIndex(r=>{const h=findHeader(r||[]);return h.code!==undefined&&(h.date!==undefined||h.stamp!==undefined);});
 if(headerAt<0)throw Error('Select the biometric export with an Employee code column and a Date (or Punch time) column.');
 const h=findHeader(rows[headerAt]),perPunch=h.in===undefined&&h.out===undefined&&h.stamp!==undefined;
 if(!perPunch&&h.in===undefined&&h.out===undefined)throw Error('Select the biometric export with In time and Out time columns, or a Punch time column.');
 const lines=new Map(),errors=[];
 rows.slice(headerAt+1).forEach((row,i)=>{
  if(!row||row.every(c=>c===null||c===undefined||String(c).trim()===''))return;
  const code=employeeCode(row[h.code]);const at=headerAt+i+2;
  if(!code){errors.push(`Line ${at}: no employee code.`);return;}
  let date,inTime='',outTime='';
  if(perPunch){const p=stampParts(row[h.stamp]);date=h.date!==undefined?readDate(row[h.date])||p.date:p.date;inTime=outTime=p.time;}
  else{date=readDate(row[h.date]);inTime=h.in!==undefined?readTime(row[h.in]):'';outTime=h.out!==undefined?readTime(row[h.out]):'';}
  if(!date){errors.push(`Line ${at}: date not readable.`);return;}
  if(!inTime&&!outTime)return; // absent on the device: nothing to compare
  const site=h.site!==undefined?String(row[h.site]??'').trim():'';
  const name=h.name!==undefined?String(row[h.name]??'').trim():'';
  const key=code+'|'+date,held=lines.get(key);
  if(!held){lines.set(key,{caliberCode:code,date,inTime,outTime:perPunch?'':outTime,employeeName:name,site,punches:1});return;}
  held.punches++;
  if(perPunch){const times=[held.inTime,held.outTime,inTime].filter(Boolean).sort();held.inTime=times[0];held.outTime=times.length>1?times.at(-1):'';}
  else{if(inTime&&(!held.inTime||inTime<held.inTime))held.inTime=inTime;if(outTime&&(!held.outTime||outTime>held.outTime))held.outTime=outTime;}
  if(!held.site&&site)held.site=site;if(!held.employeeName&&name)held.employeeName=name;
 });
 return {punches:[...lines.values()].map(({punches,...p})=>p),errors};
}

// ---- Shift times ---------------------------------------------------------------------------------------------------
const GENERIC_SHIFTS=[['S1','05:00','13:00'],['S2','13:00','21:00'],['S3','21:00','05:00'],['D','08:00','20:00'],['N','20:00','08:00']];
const mins=t=>{const m=String(t||'').match(/^(\d{1,2}):(\d{2})/);return m?+m[1]*60+ +m[2]:null;};
export function siteShifts(site,masters=SHIFT_MASTER_DEFAULTS){
 const key=canonicalSiteName(site);
 const own=key?masters.filter(s=>canonicalSiteName(s.site)===key).map(s=>({code:bookShiftCode(s.shiftName),start:mins(s.startTime),end:mins(s.endTime)})).filter(s=>s.code&&s.start!==null&&s.end!==null):[];
 const codes=new Set(own.map(s=>s.code));
 return [...own,...GENERIC_SHIFTS.filter(([c])=>!codes.has(c)).map(([code,a,b])=>({code,start:mins(a),end:mins(b),generic:true}))];
}
const apart=(a,b)=>{const d=Math.abs(a-b)%1440;return Math.min(d,1440-d);};
// The shift a punch belongs to: the site's own shifts (Shift Master) first, the shift whose start is nearest the In punch.
export function shiftOfPunch(time,site,masters){
 const t=mins(time);if(t===null)return '';
 const all=siteShifts(site,masters),own=all.filter(s=>!s.generic&&['S1','S2','S3'].includes(s.code));
 const list=own.length?own:all.filter(s=>['S1','S2','S3'].includes(s.code));
 return list.reduce((best,s)=>!best||apart(t,s.start)<apart(t,best.start)?s:best,null)?.code||'';
}

// ---- Comparing -----------------------------------------------------------------------------------------------------
// punches: [{caliberCode,date,inTime,outTime,site,employeeName}]
// duties:  trip card attendance lines (otDuties + attendanceEquipment of the attendance read): {date,shift,site,caliberCode,employeeName,equipment,doors,books}
// lockedDays: ['siteKey|date'] of the dates asked.
export function compareAttendance({punches=[],duties=[],lockedDays=[],from='',to='',masters}={}){
 const locked=new Set(lockedDays),lockedDates=new Set(lockedDays.map(k=>k.slice(k.lastIndexOf('|')+1)));
 const inRange=d=>(!from||d>=from)&&(!to||d<=to);
 const trip=new Map();let noCode=0;
 for(const d of duties){
  if(!inRange(d.date))continue;
  const code=employeeCode(d.caliberCode);if(!code){noCode++;continue;}
  const key=code+'|'+d.date;(trip.get(key)||trip.set(key,[]).get(key)).push(d);
 }
 const punched=new Map(punches.filter(p=>inRange(p.date)).map(p=>[employeeCode(p.caliberCode)+'|'+p.date,p]));
 const lines=[];
 const add=(type,base,extra={})=>lines.push({id:type+'|'+base.caliberCode+'|'+base.date+'|'+lines.length,type,label:typeLabel(type),...base,...extra});
 for(const [key,list] of trip){
  const p=punched.get(key);if(p)continue;
  const d=list[0];
  add('no-biometric',{caliberCode:employeeCode(d.caliberCode),employeeName:d.employeeName||'',date:d.date,shift:d.shift,site:d.site,siteKey:canonicalSiteName(d.site)||d.site,inTime:'',outTime:'',
   tripSite:sitesOf(list),tripShift:shiftsOf(list),equipment:joined(list,'equipment'),doors:joined(list,'doors'),books:joined(list,'books')},
   {detail:'On the trip card / log book, no punch on the biometric device.'});
 }
 for(const [key,p] of punched){
  const list=trip.get(key)||[],code=key.slice(0,key.indexOf('|'));
  const site=canonicalSiteName(p.site)||'',siteLabel=String(p.site||'').trim()||NO_SITE;
  const tripSite=sitesOf(list),own=list.find(d=>!site||canonicalSiteName(d.site)===site)||list[0];
  const shift=own?.shift||shiftOfPunch(p.inTime||p.outTime,site||own?.site,masters);
  const base={caliberCode:code,employeeName:p.employeeName||own?.employeeName||'',date:p.date,shift,site:own?own.site:siteLabel,siteKey:own?canonicalSiteName(own.site)||own.site:site||NO_SITE,
   inTime:p.inTime||'',outTime:p.outTime||'',punchSite:siteLabel,tripSite,tripShift:shiftsOf(list),equipment:joined(list,'equipment'),doors:joined(list,'doors'),books:joined(list,'books')};
  if(!p.inTime||!p.outTime)add('miss-punch',base,{detail:p.inTime?'In punch '+p.inTime+', no Out punch.':'Out punch '+p.outTime+', no In punch.'});
  if(!list.length){
   const dayLocked=site?locked.has(site+'|'+p.date):lockedDates.has(p.date);
   if(dayLocked)add('no-trip-card',base,{detail:'Punched on the biometric device, no trip card, log book or zero-trip entry.'});
   continue;
  }
  if(site&&!list.some(d=>canonicalSiteName(d.site)===site))add('site-mismatch',base,{detail:'Punched at '+siteLabel+', trip card at '+tripSite+'.'});
  const t=mins(p.inTime);
  if(t===null)continue;
  const timed=list.map(d=>({d,s:siteShifts(d.site,masters).find(x=>x.code===d.shift)})).filter(x=>x.s);
  if(!timed.length)continue;
  const near=timed.reduce((a,b)=>apart(t,b.s.start)<apart(t,a.s.start)?b:a);
  if(apart(t,near.s.start)>SHIFT_WINDOW_MINUTES){add('shift-mismatch',base,{detail:'In punch '+p.inTime+' does not fit trip card shift '+shiftsOf(list)+'.'});continue;}
  const s=near.s,late=((t-s.start)%1440+1440)%1440;
  const shiftBase={...base,shift:near.d.shift,site:near.d.site,siteKey:canonicalSiteName(near.d.site)||near.d.site,shiftStart:clock(s.start),shiftEnd:clock(s.end)};
  if(late>GRACE_MINUTES&&late<=SHIFT_WINDOW_MINUTES)add('late-come',shiftBase,{lateMinutes:late,detail:'In '+p.inTime+', shift starts '+clock(s.start)+' ('+late+' min late).'});
  const o=mins(p.outTime);
  if(o!==null){
   const length=((s.end-s.start)%1440+1440)%1440||1440,worked=((o-s.start)%1440+1440)%1440,early=length-worked;
   if(early>GRACE_MINUTES&&early<length)add('early-going',shiftBase,{earlyMinutes:early,detail:'Out '+p.outTime+', shift ends '+clock(s.end)+' ('+early+' min early).'});
  }
 }
 return {lines:lines.sort((a,b)=>a.date.localeCompare(b.date)||String(a.siteKey).localeCompare(String(b.siteKey))||String(a.shift).localeCompare(String(b.shift))||a.caliberCode.localeCompare(b.caliberCode,undefined,{numeric:true})),noCode};
}
const clock=m=>pad(Math.floor(m/60)%24)+':'+pad(m%60);
const joined=(list,f)=>[...new Set(list.map(d=>d[f]).filter(Boolean))].join('; ');
const sitesOf=list=>[...new Set(list.map(d=>d.site).filter(Boolean))].join(', ');
const shiftsOf=list=>[...new Set(list.map(d=>d.shift).filter(Boolean))].join(', ');
const ALL_TYPES=[...MISMATCH_TYPES,...Object.values(REGULARIZATION_TYPES).flat()];
export const typeLabel=key=>ALL_TYPES.find(t=>t.key===key)?.label||key;

// Step 1: one line per site with a count of each kind.
export function mismatchSites(lines,types){
 const keys=types.map(t=>t.key),bySite=new Map();
 for(const l of lines){if(!keys.includes(l.type))continue;const k=l.siteKey||NO_SITE;const r=bySite.get(k)||bySite.set(k,{id:k,key:k,site:l.site||k,total:0,...Object.fromEntries(keys.map(x=>[x,0]))}).get(k);r[l.type]++;r.total++;}
 return [...bySite.values()].sort((a,b)=>b.total-a.total||String(a.site).localeCompare(String(b.site)));
}
// Step 2: one row per date and shift of a site, with a count of each kind (DateShiftGrid rows).
export function mismatchShifts(lines,types){
 const keys=types.map(t=>t.key),rows=new Map();
 for(const l of lines){if(!keys.includes(l.type))continue;const k=l.date+'|'+(l.shift||'—');const r=rows.get(k)||rows.set(k,{id:k,key:k,date:l.date,shift:l.shift||'—',total:0,...Object.fromEntries(keys.map(x=>[x,0]))}).get(k);r[l.type]++;r.total++;}
 return [...rows.values()];
}
