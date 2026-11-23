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
 const inFile=new Set(days.map(d=>d.caliberCode));
 // Drivers and operators only: Employee Master says so, or the person is on a trip card of this site.
 const scope=code=>onCards.has(code)||isDriverOrOperator(master.get(code)?.designation);
 const notInMaster=[...inFile].filter(code=>!master.get(code)?.found&&!onCards.has(code)).sort((a,b)=>a-b);
 const otherStaff=[...inFile].filter(code=>master.get(code)?.found&&!scope(code));
 const punches=days.filter(d=>inRange(d.date)&&scope(d.caliberCode)).map(d=>({...d,site,employeeName:master.get(d.caliberCode)?.name||''}));
 const compared=duties.filter(l=>here(l)||inFile.has(l.caliberCode));
 const {lines:found}=compareAttendance({punches,duties:compared,lockedDays,from,to,masters});
 const findings=found.filter(f=>KEYS.includes(f.type)&&(f.type!=='no-biometric'||canonicalSiteName(f.siteKey||f.site)===siteKey)).map(f=>{
  const m=master.get(f.caliberCode);
  return {...f,employeeId:'CMLL'+f.caliberCode,employeeName:m?.name||f.employeeName||'',designation:m?.designation||'',label:FINDINGS.find(x=>x.key===f.type).label};
 });
 // One line per person: days on the device, days on trip cards, days on both, and each finding.
 const people_=new Map();
 const person=code=>people_.get(code)||people_.set(code,{caliberCode:code,employeeId:'CMLL'+code,name:master.get(code)?.name||'',designation:master.get(code)?.designation||'',
  bioDays:new Set(),tripDays:new Set(),...Object.fromEntries(KEYS.map(k=>[k,0]))}).get(code);
 for(const d of punches)person(d.caliberCode).bioDays.add(d.date);
 for(const l of duties)if(here(l))person(l.caliberCode).tripDays.add(l.date);
 for(const f of findings)person(f.caliberCode)[f.type]++;
 const perPerson=[...people_.values()].map(p=>{
  const both=[...p.bioDays].filter(d=>p.tripDays.has(d)).length;
  const issues=KEYS.reduce((s,k)=>s+p[k],0);
  if(!p.name){const d=duties.find(l=>l.caliberCode===p.caliberCode);p.name=text(d?.employeeName);}
  return {...p,bioDays:p.bioDays.size,tripDays:p.tripDays.size,both,issues};
 }).sort((a,b)=>b.issues-a.issues||a.caliberCode.localeCompare(b.caliberCode,undefined,{numeric:true}));
 const counts=Object.fromEntries(KEYS.map(k=>[k,findings.filter(f=>f.type===k).length]));
 const locked=lockedDays.filter(k=>canonicalSiteName(k.slice(0,k.lastIndexOf('|')))===siteKey).map(k=>k.slice(k.lastIndexOf('|')+1)).filter(inRange);
 return {site,from,to,findings,perPerson,counts,notInMaster,otherStaff:otherStaff.length,
  totals:{people:perPerson.length,bioDays:punches.length,tripDays:perPerson.reduce((s,p)=>s+p.tripDays,0),both:perPerson.reduce((s,p)=>s+p.both,0),findings:findings.length,
   peopleWithFindings:perPerson.filter(p=>p.issues).length,lockedDates:[...new Set(locked)].length}};
}

// ---- The Excel given back -------------------------------------------------------------------------------------------
export function tripBiometricWorkbook(result,{fileName='',checkedAt=''}={}){
 const period=dmy(result.from)+' to '+dmy(result.to),title=result.site+' · Trip card vs biometric · '+period;
 const typeIndex=Object.fromEntries(FINDINGS.map(f=>[f.key,f.key]));
 const list={name:'Mismatches',title,plainSerial:true,fills:FINDING_FILLS,
  headerRows:[title+(fileName?' · file: '+fileName:'')+(checkedAt?' · checked '+checkedAt:''),...FINDINGS.map(f=>f.label)],headerFills:Object.fromEntries(FINDINGS.map((f,i)=>[i+1,f.key])),
  cellFills:result.findings.map(f=>({4:typeIndex[f.type]})),
  columns:['Date','Employee ID','Name','Designation','Mismatch','Biometric IN','Biometric OUT','Trip card shift','Trip card site','Equipment','Trip cards / log books','Detail'].map(label=>({label})),
  rows:result.findings.map(f=>[dmy(f.date),f.employeeId,f.employeeName,f.designation,f.label,f.inTime||'',f.outTime||'',f.tripShift||'',f.tripSite||'',f.doors||f.equipment||'',f.books||'',f.detail||''])};
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
