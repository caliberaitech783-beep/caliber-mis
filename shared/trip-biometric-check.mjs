import {cShiftNight,cShiftDays} from './c-shift-punches.mjs';
// Attendance Sheet Mismatch, drivers and operators (owner, 23 Nov 2026): Reports > Manpower & OT > Attendance Sheet
// Mismatch now compares the biometric log of a site with trip card attendance, for drivers and operators only.
// The site's device log is uploaded (the ZKTeco attlog .dat, or the device's Excel/CSV export), the site is chosen, and
// each driver/operator day is set beside the trip cards, log books and zero-trip entries Pulse-II holds for it.
// Nothing is saved: the file is read in the browser and only its employee numbers are asked about.
//
// The attlog .dat line: employee no. <TAB> YYYY-MM-DD HH:MM:SS <TAB> verify <TAB> state (0 = IN, 1 = OUT) <TAB> work code <TAB> reserved.
// The device's employee no. is the number of the Caliber ID: 17817 is CMLL17817.
import {canonicalSiteName} from './site-location.mjs';
import {compareAttendance,employeeCode,parseBiometricSheet,MISMATCH_TYPES} from './attendance-mismatch.mjs';
import {drivesOrOperates} from './caliber-id-check.mjs';
import {lineNumber,dmy} from './attendance-sheet-check.mjs';
import {OPERATIONAL_START} from './operational-start.mjs';
import {employeeNumber} from './hr-employee-master.mjs';

export const REPEAT_PUNCH_SECONDS=120;   // the same IN or OUT again within 2 minutes is one punch
export const PAIR_HOURS=16;              // an OUT later than this after the IN is not the same duty
export const MAX_DAYS=31;
export const FINDINGS=[
 ...MISMATCH_TYPES,
 {key:'miss-punch',label:'Miss punch (IN or OUT missing)',tone:'yellow'},
];
export const FINDING_FILLS={'no-biometric':'FFFF9E9E','no-trip-card':'FFFFC78A','site-mismatch':'FFD9B8FF','shift-mismatch':'FFE0C9A6','miss-punch':'FFFFE066'};
const KEYS=FINDINGS.map(f=>f.key);
const text=v=>String(v??'').trim();
export const isDriverOrOperator=designation=>Boolean(text(designation))&&drivesOrOperates({designation});

// ---- Reading the attlog .dat -----------------------------------------------------------------------------------------
const LINE=/^\s*(\d{1,12})\t\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*\t\s*\d*\s*\t\s*(\d+)/;
export function looksLikeAttlog(content){return String(content||'').split(/\r?\n/).slice(0,20).some(line=>LINE.test(line));}
export function parseAttlog(content){
 const punches=[],bad=[];
 String(content||'').split(/\r?\n/).forEach((line,i)=>{
  if(!line.trim())return;
  const m=LINE.exec(line);
  if(!m||+m[3]>23||+m[4]>59||!['0','1'].includes(m[6])){bad.push(i+1);return;}
  punches.push({code:String(Number(m[1])),date:m[2],time:m[3]+':'+m[4],at:Date.parse(m[2]+'T'+m[3]+':'+m[4]+':'+(m[5]||'00')+'+05:30'),dir:m[6]==='0'?'IN':'OUT'});
 });
 if(!punches.length)throw Error('No punch line could be read. Upload the attlog .dat file of the biometric device (employee no., date time, …, 0 for IN / 1 for OUT).');
 return {punches,bad};
}

// One line per employee and date: the IN of that date with the OUT that follows it (within PAIR_HOURS, so a night duty
// that ends after midnight stays on the date of its IN). An OUT with no IN before it is kept on its own date.
export function attlogDays(punches){
 const byCode=new Map();
 for(const p of [...punches].sort((a,b)=>a.code.localeCompare(b.code)||a.at-b.at))(byCode.get(p.code)||byCode.set(p.code,[]).get(p.code)).push(p);
 const days=new Map();let repeats=0;
 for(const [code,all] of byCode){
  const list=[];
  for(const p of all){const prev=list.at(-1);if(prev&&prev.dir===p.dir&&p.at-prev.at<REPEAT_PUNCH_SECONDS*1000){repeats++;continue;}list.push(p);}
  for(let i=0;i<list.length;i++){
   const p=list[i],next=list[i+1];let line;
   if(p.dir==='IN'&&next?.dir==='OUT'&&next.at-p.at<=PAIR_HOURS*3600000){line={date:p.date,inTime:p.time,outTime:next.time};i++;}
   else line=p.dir==='IN'?{date:p.date,inTime:p.time,outTime:''}:{date:p.date,inTime:'',outTime:p.time};
   const key=code+'|'+line.date,held=days.get(key);
   if(!held){days.set(key,{caliberCode:code,...line});continue;}
   // A second duty the same date: the first IN and the last OUT stand for the day.
   if(line.inTime&&(!held.inTime||line.inTime<held.inTime))held.inTime=line.inTime;
   if(line.outTime&&(!held.outTime||line.outTime>held.outTime))held.outTime=line.outTime;
  }
 }
 return {days:[...days.values()],repeats};
}

// Either file the device gives: the attlog .dat (text) or its Excel/CSV export (rows of cells).
export function biometricDays({content,rows}){
 if(content!==undefined&&looksLikeAttlog(content)){
  const {punches,bad}=parseAttlog(content),{days,repeats}=attlogDays(punches);
  return {days,punches:punches.length,ins:punches.filter(p=>p.dir==='IN').length,outs:punches.filter(p=>p.dir==='OUT').length,bad:bad.length,repeats,kind:'attlog'};
 }
 const {punches,errors}=parseBiometricSheet(rows||[]);
 if(!punches.length)throw Error('No punch line could be read from this file.');
 return {days:punches.map(p=>({caliberCode:employeeCode(p.caliberCode),date:p.date,inTime:p.inTime,outTime:p.outTime})),punches:punches.length,ins:0,outs:0,bad:errors.length,repeats:0,kind:'export'};
}

// ---- Punches already held: machine direct (HR Pulse) and imported in Pulse-II -----------------------------------------
// Owner, 23 Nov 2026: "show the mismatch only for drivers and operators for both biometric punch fetched directly or
// imported in app". The site machines push to HR Pulse (caliber-hr server/mis-biometric-punches.mjs gives them here);
// device files uploaded on Attendance Management are in mis_biometric_punches. No upload is needed on this tab.

// Machine punches as HR Pulse sends them: [[employee code, machine user ID, 'YYYY-MM-DD HH:MM', site index, type]].
// The employee is the code HR linked the machine ID to; without a link the machine ID is the employee number (17817 is
// CMLL17817). Many machines send the same punch type for every punch, so a duty is read from the times: punches within
// PAIR_HOURS of the first one are one duty (a night duty stays on the date it began); a punch marked IN after one marked
// OUT starts the next duty. The first punch is the IN, the last the OUT; a lone punch is an IN, or an OUT when marked so.
//
// Days HR corrected (owner, 25 Nov 2026): HR Pulse sends the days an HR administrator corrected on Attendance roster ›
// Manual Biometric beside the punches: [[site index, date, employee code or machine ID, code, In, Out, reason, by]].
// A corrected day stands in place of what the punches make of it:
//  - an In (and Out) given: the day is that In and Out; the punches of that duty are not read for it. An Out not after
//    the In is the next morning, and a duty of the next date that starts by CORRECTED_OUT_GRACE_MINUTES after that Out
//    is the same night, so it is not read as a day of its own either.
//  - A, WO, H, CO or L: no biometric day (the person was not at work).
//  - P, HD or OD with no time: the day stands, with its punches if any, and is not a miss punch.
export const CORRECTED_OUT_GRACE_MINUTES=180;
export const HR_NOT_AT_WORK=['A','WO','H','CO','L'];
const addOneDay=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const CLOCK=/^([01]\d|2[0-3]):[0-5]\d$/;
export function hrCorrections({corrections=[],sites=[]}={},{siteName=name=>name}={}){
 const list=new Map();
 for(const row of Array.isArray(corrections)?corrections:[]){
  const [siteAt,date,code,status,inTime,outTime,reason,by]=Array.isArray(row)?row:[];
  const number=employeeNumber(code),day=text(date),code_=text(status).toUpperCase();
  if(!number||!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;
  const inT=CLOCK.test(text(inTime))?text(inTime):'',outT=inT&&CLOCK.test(text(outTime))?text(outTime):'';
  if(!inT&&!code_)continue;
  const overnight=Boolean(outT&&outT<=inT);
  list.set(number+'|'+day,{caliberCode:number,date:day,status:code_,inTime:inT,outTime:outT,site:siteName(text(sites[siteAt])),reason:text(reason),by:text(by),
   absent:HR_NOT_AT_WORK.includes(code_),overnight,nextDate:addOneDay(day),outAt:overnight?Date.parse(addOneDay(day)+'T'+outT+':00Z'):null});
 }
 return list;
}

export function machineDays({punches=[],sites=[],corrections=[]}={},{siteName=name=>name,masters=[]}={}){
 const byCode=new Map();let unread=0;
 const fixes=hrCorrections({corrections,sites},{siteName}),nights=new Map([...fixes.values()].filter(c=>c.overnight).map(c=>[c.caliberCode+'|'+c.nextDate,c]));
 for(const row of Array.isArray(punches)?punches:[]){
  const [code,machineId,stamp,siteAt,type]=Array.isArray(row)?row:[];
  const number=employeeNumber(code)||employeeNumber(machineId),m=/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(text(stamp));
  if(!number||!m){unread++;continue;}
  const p={date:m[1],time:m[2],at:Date.parse(m[1]+'T'+m[2]+':00Z'),dir:text(type)==='0'?'IN':text(type)==='1'?'OUT':'',site:siteName(text(sites[siteAt]))};
  (byCode.get(number)||byCode.set(number,[]).get(number)).push(p);
 }
 const days=new Map();
 const keep=(code,duty)=>{
  const first=duty[0],last=duty.at(-1),lone=duty.length===1;
  // A duty a correction replaces: its own date was given an In or a not-at-work code, or it is the morning of a
  // corrected night.
  const own=fixes.get(code+'|'+first.date);
  if(own&&(own.inTime||own.absent))return;
  const night=nights.get(code+'|'+first.date);
  if(night&&first.at<=night.outAt+CORRECTED_OUT_GRACE_MINUTES*60000)return;
  const line={caliberCode:code,date:first.date,inTime:lone&&first.dir==='OUT'?'':first.time,outTime:lone?(first.dir==='OUT'?first.time:''):last.time,site:first.site||last.site,source:'machine'};
  const key=code+'|'+line.date,held=days.get(key);
  if(!held){days.set(key,line);return;}
  if(line.inTime&&(!held.inTime||line.inTime<held.inTime))held.inTime=line.inTime;
  if(line.outTime&&(!held.outTime||line.outTime>held.outTime))held.outTime=line.outTime;
 };
 for(const [code,all] of byCode){
  all.sort((a,b)=>a.at-b.at);
  let duty=[];
  for(const p of all){
   const prev=duty.at(-1);
   if(prev&&p.at-prev.at<REPEAT_PUNCH_SECONDS*1000&&p.dir===prev.dir)continue;
   const night=duty.length&&cShiftNight(duty[0].date,duty[0].time,duty[0].site,masters),sameNight=night&&night===cShiftNight(p.date,p.time,p.site,masters)&&canonicalSiteName(p.site)===canonicalSiteName(duty[0].site)&&!(p.dir==='IN'&&prev.dir==='OUT'&&prev.date===p.date&&p.date!==duty[0].date);
   if(duty.length&&!sameNight&&(p.at-duty[0].at>PAIR_HOURS*3600000||(p.dir==='IN'&&duty.some(x=>x.dir==='OUT'))||night)){keep(code,duty);duty=[];}
   duty.push(p);
  }
  if(duty.length)keep(code,duty);
 }
 for(const [key,c] of fixes){
  const held=days.get(key),hr={by:c.by,reason:c.reason,status:c.status,inTime:c.inTime,outTime:c.outTime};
  if(c.absent){days.delete(key);continue;}
  if(c.inTime){days.set(key,{caliberCode:c.caliberCode,date:c.date,inTime:c.inTime,outTime:c.outTime,site:c.site||held?.site||'',source:'machine',corrected:hr});continue;}
  // P, HD or OD with no time: present by HR's word.
  days.set(key,{caliberCode:c.caliberCode,date:c.date,inTime:held?.inTime||'',outTime:held?.outTime||'',site:held?.site||c.site,source:'machine',corrected:hr,presentByHr:true});
 }
 return {days:cShiftDays([...days.values()],{masters}),unread};
}

// Lines of mis_biometric_punches (already one per employee and date).
export const importedDays=lines=>(Array.isArray(lines)?lines:[]).map(l=>({caliberCode:employeeNumber(l.caliberCode)||employeeCode(l.caliberCode),date:text(l.date),inTime:text(l.inTime),outTime:text(l.outTime),site:text(l.site),source:'imported'}))
 .filter(d=>d.caliberCode&&d.date);

export const SOURCE_LABEL={machine:'Machine',imported:'Imported','machine+imported':'Machine + Imported'};
// A day HR corrected says so beside its source, with who corrected it and why.
export const correctionText=day=>day?.corrected?'Corrected in HR'+(day.corrected.by?' by '+day.corrected.by:'')+(day.corrected.reason?': '+day.corrected.reason:''):'';
export const sourceLabelOf=day=>day?(SOURCE_LABEL[day.source]||'')+(day.corrected?' · corrected in HR':''):'';
// One line per employee and date from both: the earliest IN and the latest OUT; the machine's site first. A day HR
// corrected keeps the corrected In and Out (the imported punches of it are what HR corrected).
export function mergeBiometricDays(...lists){
 const days=new Map();
 for(const d of lists.flat()){
  const key=d.caliberCode+'|'+d.date,held=days.get(key);
  if(!held){days.set(key,{...d});continue;}
  if(held.corrected||d.corrected){
   const fixed=held.corrected?held:{...d},other=held.corrected?d:held;
   if(!fixed.site)fixed.site=other.site;
   if(fixed.source!==other.source)fixed.source='machine+imported';
   days.set(key,fixed);continue;
  }
  if(d.inTime&&(!held.inTime||d.inTime<held.inTime))held.inTime=d.inTime;
  if(d.outTime&&(!held.outTime||d.outTime>held.outTime))held.outTime=d.outTime;
  if(!held.site)held.site=d.site;
  if(held.source!==d.source)held.source='machine+imported';
 }
 return [...days.values()];
}

// The dates to read Pulse-II for: the dates of the file, from 1 Nov 2026 up to today, at most 31 days.
export function biometricRange(days,today){
 const dates=[...new Set(days.map(d=>d.date))].filter(d=>d>=OPERATIONAL_START&&(!today||d<=today)).sort();
 if(!dates.length)return null;
 const from=dates[0],limit=new Date(Date.parse(from+'T00:00:00Z')+(MAX_DAYS-1)*86400000).toISOString().slice(0,10),last=dates.at(-1);
 return {from,to:last>limit?limit:last,cut:last>limit};
}

// days:       biometricDays().days
// lines:      Pulse-II attendance of the dates (otDuties and attendanceEquipment of /api/reports/manpower/attendance)
// lockedDays: its locked site-days ('siteKey|date')
// people:     Employee Master's answer for the numbers ({number,found,name,designation,siteLabel,atSite})
// site, from, to: the chosen site and the dates compared.
export function tripBiometricCheck({days=[],lines=[],lockedDays=[],people=[],site,from,to,masters}){
 const siteKey=canonicalSiteName(site);
 const master=new Map(people.map(p=>[String(p.number),p]));
 const inRange=d=>d>=from&&d<=to;
 // Trip card side: duties at this site, and duties elsewhere of people punching here (they show as a site mismatch).
 const duties=lines.map(l=>({...l,caliberCode:lineNumber(l)})).filter(l=>l.caliberCode&&inRange(l.date));
 const here=l=>canonicalSiteName(l.siteKey||l.site)===siteKey;
 const onCards=new Set(duties.filter(here).map(l=>l.caliberCode));
 // A day with no site of its own (an uploaded device file) is a day at the chosen site.
 const punchedHere=d=>!d.site||canonicalSiteName(d.site)===siteKey;
 const inFile=new Set(days.filter(punchedHere).map(d=>d.caliberCode));
 const dayOf=new Map(days.map(d=>[d.caliberCode+'|'+d.date,d]));
 // Drivers and operators only: Employee Master says so, or the person is on a trip card of this site.
 const scope=code=>onCards.has(code)||isDriverOrOperator(master.get(code)?.designation);
 const notInMaster=[...inFile].filter(code=>!master.get(code)?.found&&!onCards.has(code)).sort((a,b)=>a-b);
 const otherStaff=[...inFile].filter(code=>master.get(code)?.found&&!scope(code));
 // Days elsewhere count only for people on a trip card here (they show as a different site).
 const punches=days.filter(d=>inRange(d.date)&&scope(d.caliberCode)&&(punchedHere(d)||onCards.has(d.caliberCode))).map(d=>({...d,site:d.site||site,employeeName:master.get(d.caliberCode)?.name||''}));
 const compared=duties.filter(l=>here(l)||inFile.has(l.caliberCode));
 const {lines:found}=compareAttendance({punches,duties:compared,lockedDays,from,to,masters});
 // A mismatch of this site: the trip card is here, or the punch is.
 const ofSite=f=>canonicalSiteName(f.siteKey||f.site)===siteKey||(f.type!=='no-biometric'&&canonicalSiteName(f.punchSite)===siteKey);
 const findings=found.filter(f=>KEYS.includes(f.type)&&ofSite(f)).map(f=>{
  const m=master.get(f.caliberCode),day=f.type==='no-biometric'?null:dayOf.get(f.caliberCode+'|'+f.date),source=day?.source||'';
  return {...f,employeeId:'CMLL'+f.caliberCode,employeeName:m?.name||f.employeeName||'',designation:m?.designation||'',label:FINDINGS.find(x=>x.key===f.type).label,source,sourceLabel:sourceLabelOf(day),hrCorrection:correctionText(day),detail:[f.detail,correctionText(day)].filter(Boolean).join(' · ')};
 });
 // One line per person: days on the device, days on trip cards, days on both, and each finding.
 const people_=new Map();
 const person=code=>people_.get(code)||people_.set(code,{caliberCode:code,employeeId:'CMLL'+code,name:master.get(code)?.name||'',designation:master.get(code)?.designation||'',
  bioDays:new Set(),tripDays:new Set(),...Object.fromEntries(KEYS.map(k=>[k,0]))}).get(code);
 for(const d of punches)if(punchedHere(d))person(d.caliberCode).bioDays.add(d.date);
 for(const l of duties)if(here(l))person(l.caliberCode).tripDays.add(l.date);
 for(const f of findings)person(f.caliberCode)[f.type]++;
 const perPerson=[...people_.values()].map(p=>{
  const both=[...p.bioDays].filter(d=>p.tripDays.has(d)).length;
  const issues=KEYS.reduce((s,k)=>s+p[k],0);
  if(!p.name){const d=duties.find(l=>l.caliberCode===p.caliberCode);p.name=text(d?.employeeName);}
  const bioByDate=new Map(punches.filter(d=>d.caliberCode===p.caliberCode&&punchedHere(d)).map(d=>[d.date,d]));
  const dutyByDate=new Map();
  for(const duty of duties.filter(l=>l.caliberCode===p.caliberCode&&here(l)))(dutyByDate.get(duty.date)||dutyByDate.set(duty.date,[]).get(duty.date)).push(duty);
  const findingByDate=new Map(findings.filter(f=>f.caliberCode===p.caliberCode).map(f=>[f.date,f]));
  const dates=[...new Set([...p.bioDays,...p.tripDays,...findingByDate.keys()])].sort();
  const details=dates.map(date=>{
   const bio= bioByDate.get(date),cards=dutyByDate.get(date)||[],finding=findingByDate.get(date);
   return {date,biometric:Boolean(bio),logBook:cards.length>0,both:Boolean(bio&&cards.length),sourceLabel:sourceLabelOf(bio),punchSite:bio?.site||'',inTime:bio?.inTime||'',outTime:bio?.outTime||'',
    shift:[...new Set(cards.map(l=>l.shift).filter(Boolean))].join(', '),tripSite:[...new Set(cards.map(l=>l.site).filter(Boolean))].join(', '),equipment:[...new Set(cards.flatMap(l=>String(l.doors||l.equipment||'').split(',')).map(text).filter(Boolean))].join(', '),
    books:[...new Set(cards.flatMap(l=>Array.isArray(l.books)?l.books:String(l.books||l.logBook||'').split(',')).map(text).filter(Boolean))].join(', '),findingType:finding?.type||'',findingLabel:finding?.label||'',detail:finding?.detail||''};
  });
  return {...p,bioDays:p.bioDays.size,tripDays:p.tripDays.size,both,issues,details};
 }).sort((a,b)=>b.issues-a.issues||a.caliberCode.localeCompare(b.caliberCode,undefined,{numeric:true}));
 const counts=Object.fromEntries(KEYS.map(k=>[k,findings.filter(f=>f.type===k).length]));
 const locked=lockedDays.filter(k=>canonicalSiteName(k.slice(0,k.lastIndexOf('|')))===siteKey).map(k=>k.slice(k.lastIndexOf('|')+1)).filter(inRange);
 return {site,from,to,findings,perPerson,counts,notInMaster,otherStaff:otherStaff.length,
  totals:{people:perPerson.length,bioDays:punches.filter(punchedHere).length,tripDays:perPerson.reduce((s,p)=>s+p.tripDays,0),both:perPerson.reduce((s,p)=>s+p.both,0),findings:findings.length,
   peopleWithFindings:perPerson.filter(p=>p.issues).length,lockedDates:[...new Set(locked)].length}};
}

// ---- The Excel given back -------------------------------------------------------------------------------------------
export function tripBiometricWorkbook(result,{fileName='',checkedAt=''}={}){
 const period=dmy(result.from)+' to '+dmy(result.to),title=result.site+' · Trip card vs biometric · '+period;
 const typeIndex=Object.fromEntries(FINDINGS.map(f=>[f.key,f.key]));
 const list={name:'Mismatches',title,plainSerial:true,fills:FINDING_FILLS,
  headerRows:[title+(fileName?' · file: '+fileName:'')+(checkedAt?' · checked '+checkedAt:''),...FINDINGS.map(f=>f.label)],headerFills:Object.fromEntries(FINDINGS.map((f,i)=>[i+1,f.key])),
  cellFills:result.findings.map(f=>({4:typeIndex[f.type]})),
  columns:['Date','Employee ID','Name','Designation','Mismatch','Biometric source','Punch site','Biometric IN','Biometric OUT','Trip card shift','Trip card site','Equipment','Trip cards / log books','Detail'].map(label=>({label})),
  rows:result.findings.map(f=>[dmy(f.date),f.employeeId,f.employeeName,f.designation,f.label,f.sourceLabel||'',f.punchSite||'',f.inTime||'',f.outTime||'',f.tripShift||'',f.tripSite||'',f.doors||f.equipment||'',f.books||'',f.detail||''])};
 const each={name:'Per employee',title:result.site+' · Drivers and operators · '+period,plainSerial:true,
  columns:['Employee ID','Name','Designation','Days on biometric','Days on trip cards','Days on both',...FINDINGS.map(f=>f.label),'Mismatches'].map(label=>({label})),
  rows:result.perPerson.map(p=>[p.employeeId,p.name,p.designation,String(p.bioDays),String(p.tripDays),String(p.both),...FINDINGS.map(f=>String(p[f.key])),String(p.issues)])};
 const summary={name:'Summary',title:result.site+' · Summary · '+period,plainSerial:true,columns:['Check','Count','Note'].map(label=>({label})),rows:[
  ['Drivers and operators compared',String(result.totals.people),'Employee Master designation is a driver or operator, or the person is on a trip card of this site.'],
  ['Driver/operator days on biometric',String(result.totals.bioDays),''],
  ['Driver/operator days on trip cards',String(result.totals.tripDays),''],
  ['Days on both',String(result.totals.both),''],
  ['Mismatches',String(result.totals.findings),'Listed on the sheet "Mismatches".'],
  ...FINDINGS.map(f=>['· '+f.label,String(result.counts[f.key]),'']),
  ['Dates locked in Pulse-II at this site',String(result.totals.lockedDates),'"No trip card" is judged only on locked dates.'],
  ['Other staff on the biometric (not compared)',String(result.otherStaff),'Helpers, supervisors, mechanics and staff: no trip card work.'],
  ['Biometric numbers not in Employee Master',String(result.notInMaster.length),result.notInMaster.join(', ')],
 ]};
 return {title,sheets:[list,each,summary]};
}
