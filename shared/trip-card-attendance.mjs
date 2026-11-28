// Trip card attendance, card by card (owner, 24 Nov 2026). Site Sheet vs Trip Card and Trip Card vs Bio-punch both ask
// the same human question of a selection (a site, a log book VLB / ELB / LMV, a batch, From and To):
//   "Of the trip cards here, which ones are fine and need no attention, and which ones do, and why?"
// One trip card attendance is one person in one shift on one date at the site, from saved VLB, ELB and LMV cards and
// zero-trip entries (a driver on two machines in a shift is one attendance). Each is judged against the site's own
// attendance sheet (P on that date) and / or the biometric punches (an IN and an OUT at this site that date).
// A card with nothing wrong is OK and is only counted; a card with a problem is listed with every problem it has.
// Nothing is saved: the rules are pure, the screens are src/site-sheet-trip-card.jsx and src/trip-card-biopunch.jsx.
import {canonicalSiteName} from './site-location.mjs';
import {lineNumber,markKind,dmy} from './attendance-sheet-check.mjs';

export const LOG_BOOK_TABS=[
 {key:'',label:'All log books'},
 {key:'VLB',label:'VLB'},
 {key:'ELB',label:'ELB'},
 {key:'LMV',label:'LMV'},
];
// How the attendance came into Pulse-II (server/rules/manpower-report.mjs cardSource).
export const SOURCES=[
 {key:'scanned',label:'Trip card – scanned'},
 {key:'manual',label:'Trip card – manual'},
 {key:'scanned+manual',label:'Trip card – scanned + manual'},
 {key:'zero-trip',label:'Zero-trip entry (no card)'},
 {key:'training',label:'VTC Training (present, no card)'},
 {key:'od',label:'On Duty, OD (present, no card)'},
];
export const sourceLabel=key=>SOURCES.find(s=>s.key===key)?.label||'Trip card';
// Every problem a trip card can have, in the order they are listed.
export const CARD_ISSUES=[
 {key:'not-in-sheet',label:'Person not in the site sheet',side:'sheet'},
 {key:'sheet-not-p',label:'Sheet not P',side:'sheet'},
 {key:'sheet-blank',label:'Sheet blank for this date',side:'sheet'},
 {key:'sheet-mark',label:'Sheet mark not understood',side:'sheet'},
 {key:'no-punch',label:'No bio-punch',side:'bio'},
 {key:'punch-other-site',label:'Bio-punch at another site',side:'bio'},
 {key:'miss-punch',label:'Miss punch (IN or OUT missing)',side:'bio'},
];
export const issueLabel=key=>CARD_ISSUES.find(i=>i.key===key)?.label||key;
const ADVICE={
 'not-in-sheet':'Add the person to the site sheet, or correct the Caliber ID written on the card.',
 'sheet-not-p':'Correct the sheet to P, or correct the Caliber ID on the card if another person worked.',
 'sheet-blank':'Mark the date P in the sheet.',
 'sheet-mark':'Write P, A, PL or - in the sheet.',
 'no-punch':'Ask the person to punch, regularise the day in HR Pulse, or correct the Caliber ID on the card.',
 'punch-other-site':'Correct the site on the card, or the machine the person punched on.',
 'miss-punch':'Regularise the missing IN or OUT punch in HR Pulse.',
};

const text=value=>value===null||value===undefined?'':String(value).trim();
const uniq=list=>[...new Set(list.map(text).filter(Boolean))];
// Log books are joined "VLB + ELB"; batches, card numbers and doors "A; B" (a batch name may itself hold a "+").
const split=(value,by=/\s*;\s*/)=>Array.isArray(value)?uniq(value):uniq(text(value).split(by));
const SHIFT_ORDER=['S1','S2','S3','A','B','C','D','N','Day','Night'];
const shiftRank=shift=>{const at=SHIFT_ORDER.indexOf(shift);return at<0?50:at;};
const shiftWord=code=>({S1:'Shift A',S2:'Shift B',S3:'Shift C',A:'Shift A',B:'Shift B',C:'Shift C',D:'Day',N:'Night'})[code]||text(code);
const mergeSource=list=>{
 const keys=new Set(list);
 if(keys.has('scanned+manual')||keys.has('scanned')&&keys.has('manual'))return 'scanned+manual';
 return keys.has('scanned')?'scanned':keys.has('manual')?'manual':keys.has('zero-trip')||!keys.size?'zero-trip':keys.has('training')?'training':keys.has('od')?'od':[...keys][0];
};

// The trip card attendances of a site between from and to: one per person, date and shift.
// lines: otDuties + attendanceEquipment of /api/reports/manpower/attendance (with logBooks, source, batches).
export function cardAttendances(lines,{site,from='',to=''}={}){
 const siteKey=canonicalSiteName(site),held=new Map();
 for(const l of lines||[]){
  const number=lineNumber(l);
  if(!number||!l.date||!l.shift||(from&&l.date<from)||(to&&l.date>to))continue;
  if(canonicalSiteName(l.siteKey||l.site)!==siteKey)continue;
  const key=number+'|'+l.date+'|'+l.shift;
  const card=held.get(key)||held.set(key,{key,number,date:l.date,shift:l.shift,site:text(l.site),employeeId:'',name:'',logBooks:[],sources:[],batches:[],books:[],doors:[],equipment:[],trips:null}).get(key);
  card.employeeId||=text(l.employeeId)||text(l.caliberCode);
  card.name||=text(l.employeeName);
  card.logBooks.push(...split(l.logBooks?.length?l.logBooks:l.logBook,/\s*[;+]\s*/));
  card.sources.push(text(l.source)||(l.books?'manual':'zero-trip'));
  card.batches.push(...split(l.batches));card.books.push(...split(l.books));card.doors.push(...split(l.doors));card.equipment.push(...split(l.equipment));
  if(Number.isFinite(Number(l.trips))&&l.trips!==null&&l.trips!=='')card.trips=(card.trips||0)+Number(l.trips);
 }
 return [...held.values()].map(c=>({...c,logBooks:uniq(c.logBooks),source:mergeSource(c.sources),batches:uniq(c.batches),books:uniq(c.books).join('; '),doors:uniq(c.doors).join('; '),
  equipment:uniq(c.equipment).join('; '),shiftLabel:shiftWord(c.shift),dateLabel:dmy(c.date)}))
  .sort((a,b)=>a.date.localeCompare(b.date)||shiftRank(a.shift)-shiftRank(b.shift)||a.name.localeCompare(b.name));
}

// The batches a log book tab offers, with how many attendances each holds.
export function batchChoices(cards,logBook=''){
 const counts=new Map();
 for(const c of cards)if(!logBook||c.logBooks.includes(logBook))for(const b of c.batches.length?c.batches:['(no batch)'])counts.set(b,(counts.get(b)||0)+1);
 return [...counts].map(([value,count])=>({value,count})).sort((a,b)=>a.value.localeCompare(b.value,undefined,{numeric:true}));
}
export const logBookCounts=cards=>Object.fromEntries(LOG_BOOK_TABS.map(t=>[t.key,t.key?cards.filter(c=>c.logBooks.includes(t.key)).length:cards.length]));
// The cards of a log book tab and a batch ('' = all).
export function selectCards(cards,{logBook='',batch=''}={}){
 return cards.filter(c=>(!logBook||c.logBooks.includes(logBook))&&(!batch||(batch==='(no batch)'?!c.batches.length:c.batches.includes(batch))));
}

// The site's sheet, read for judging cards: number|date -> the mark, and the numbers on the sheet.
// result: checkAttendanceSheet's result.
export function sheetMarks(result){
 const marks=new Map(),people=new Set();
 for(const r of result?.rows||[]){
  if(!r.number)continue;people.add(String(r.number));
  for(const c of r.cells||[])marks.set(r.number+'|'+c.date,{mark:text(c.mark),kind:c.kind||markKind(c.mark),row:r.row});
 }
 return {marks,people,dates:new Set(result?.dates?.compared||[])};
}
// The punches, read for judging cards: number|date -> the day at this site, and the day at another site.
// days: biometric days ({caliberCode,date,inTime,outTime,site,source}); a day without a site is at the chosen site.
export function punchDays(days,site){
 const siteKey=canonicalSiteName(site),here=new Map(),away=new Map();
 for(const d of days||[]){
  const key=String(Number(d.caliberCode))+'|'+d.date;
  (!d.site||canonicalSiteName(d.site)===siteKey?here:away).set(key,d);
 }
 return {here,away};
}

// Each card with its problems. sheet: sheetMarks() or null; punches: punchDays() or null.
export function judgeCards(cards,{sheet=null,punches=null}={}){
 return cards.map(c=>{
  const issues=[],key=c.number+'|'+c.date;
  let sheetSays='',bioIn='',bioOut='',bioSite='';
  if(sheet&&(!sheet.dates||sheet.dates.has(c.date))){
   const m=sheet.marks.get(key);
   if(!sheet.people.has(c.number))issues.push('not-in-sheet');
   else if(m){
    sheetSays=m.mark||'(blank)';
    if(m.kind==='blank')issues.push('sheet-blank');
    else if(m.kind==='unknown')issues.push('sheet-mark');
    else if(m.kind!=='present')issues.push('sheet-not-p');
   }else{sheetSays='(no mark)';issues.push('sheet-blank');}
  }
  if(punches){
   const p=punches.here.get(key),other=punches.away.get(key);
   if(p){bioIn=text(p.inTime);bioOut=text(p.outTime);if(!bioIn||!bioOut)issues.push('miss-punch');}
   else if(other){bioIn=text(other.inTime);bioOut=text(other.outTime);bioSite=text(other.site);issues.push('punch-other-site');}
   else issues.push('no-punch');
  }
  return {...c,sheetSays,bioIn,bioOut,bioSite,issues,ok:!issues.length,
   problem:issues.map(issueLabel).join(' · '),correction:issues.map(i=>ADVICE[i]).join(' '),
   sourceLabel:sourceLabel(c.source),logBook:c.logBooks.join(' + ')||'Zero-trip',batch:c.batches.join('; ')||'(no batch)'};
 });
}

// The summary of judged cards: how many, how many OK, how many need attention, by source and by problem.
export function cardSummary(judged){
 const by=key=>judged.filter(c=>c.source===key).length;
 const scannedAny=judged.filter(c=>c.source==='scanned'||c.source==='scanned+manual').length;
 const manualAny=judged.filter(c=>c.source==='manual'||c.source==='scanned+manual').length;
 return {total:judged.length,ok:judged.filter(c=>c.ok).length,attention:judged.filter(c=>!c.ok).length,
  people:new Set(judged.map(c=>c.number)).size,peopleAttention:new Set(judged.filter(c=>!c.ok).map(c=>c.number)).size,
  sources:Object.fromEntries(SOURCES.map(s=>[s.key,by(s.key)])),scanned:scannedAny,manual:manualAny,
  withPunch:judged.filter(c=>c.bioIn||c.bioOut).filter(c=>!c.issues.includes('punch-other-site')).length,
  fullPunch:judged.filter(c=>c.bioIn&&c.bioOut&&!c.issues.includes('punch-other-site')).length,
  issues:Object.fromEntries(CARD_ISSUES.map(i=>[i.key,judged.filter(c=>c.issues.includes(i.key)).length]))};
}

// Two Excel sheets (buildXlsxSheetsWorkbook): the cards that need attention with their problems, then the OK cards.
export function cardSheets(judged,{title,withSheet=false,withBio=false}){
 const columns=['Date','Shift','EMP. ID','Name','Log book','Batch','Trip card / log book no.','Equipment','How it came in',
  ...(withSheet?['Sheet says']:[]),...(withBio?['Bio IN','Bio OUT','Punch site']:[])];
 const row=c=>[c.dateLabel,c.shiftLabel,c.employeeId,c.name,c.logBook,c.batch,c.books,c.doors||c.equipment,c.sourceLabel,
  ...(withSheet?[c.sheetSays]:[]),...(withBio?[c.bioIn,c.bioOut,c.bioSite]:[])];
 const bad=judged.filter(c=>!c.ok),good=judged.filter(c=>c.ok);
 return [
  {name:'Needs attention',title:title+' · trip cards that need attention ('+bad.length+')',plainSerial:true,
   columns:[...columns,'Problem','Correction required'].map(label=>({label})),rows:bad.map(c=>[...row(c),c.problem,c.correction])},
  {name:'OK cards',title:title+' · trip cards that are OK, no attention needed ('+good.length+')',plainSerial:true,
   columns:columns.map(label=>({label})),rows:good.map(row)},
 ];
}
