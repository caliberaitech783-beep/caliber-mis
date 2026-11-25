// Trip Card vs Bio-punch with the site's own sheet (owner, 24 Nov 2026): "here i need a upload section to upload my excel
// file which is made manually. In second step compare both the file (excel which i will upload and the other file which
// will be created from ur side). I need date wise scanned, attendance and all other which is useful to compare."
//
// Three sources, one person on one date at the site:
//   your sheet  the P / A attendance Excel the site keeps by hand (parseAttendanceSheet, shared/attendance-sheet-check.mjs)
//   trip card   Pulse-II trip card attendance (scanned card, manual card, zero-trip entry), locked dates only
//   bio-punch   the punches Pulse-II holds (machine direct + imported)
// Drivers and operators only, as in the rest of this report: helpers, mechanics and staff keep no trip card.
// Nothing is saved. Screens: src/trip-card-biopunch.jsx; the run: src/trip-card-biopunch-run.mjs.
import {markKind,dmy} from './attendance-sheet-check.mjs';
import {isDriverOrOperator} from './trip-biometric-check.mjs';

const text=value=>value===null||value===undefined?'':String(value).trim();
const uniq=list=>[...new Set(list.filter(Boolean))];

// Every difference a person-day can have, in the order they are counted.
export const DAY_DIFFERENCES=[
 {key:'sheetNoCard',label:'Your sheet P, no trip card',short:'Sheet P, no card',tone:'orange',needsAll:true},
 {key:'cardNotP',label:'Trip card, your sheet not P',short:'Card, sheet not P',tone:'blue'},
 {key:'cardNotInSheet',label:'Trip card, person not in your sheet',short:'Card, not in sheet',tone:'blue'},
 {key:'cardNoBio',label:'Trip card, no bio-punch',short:'Card, no punch',tone:'red'},
 {key:'missPunch',label:'Miss punch (IN or OUT missing)',short:'Miss punch',tone:'yellow'},
 {key:'punchAway',label:'Bio-punch at another site',short:'Punch elsewhere',tone:'purple'},
 {key:'bioNoCard',label:'Bio-punch, no trip card',short:'Punch, no card',tone:'orange',needsAll:true},
 {key:'sheetNoBio',label:'Your sheet P, no bio-punch',short:'Sheet P, no punch',tone:'red'},
];
const SOURCE_SHORT={scanned:'Scanned','manual':'Manual','scanned+manual':'Scanned + manual','zero-trip':'Zero-trip',training:'VTC Training'};

// Your sheet, read for comparing: number|date -> mark, the people, and the dates it has a mark for.
export function sheetFromFile(sheet){
 const marks=new Map(),people=new Map();
 const index=new Map(sheet.dates.map((date,i)=>[date,i]));
 for(const p of sheet.people){
  if(!p.number)continue;
  people.set(p.number,{number:p.number,id:p.id,name:p.name,designation:p.designation,row:p.row});
  for(const date of sheet.filledDates){const mark=text(p.marks[index.get(date)]);marks.set(p.number+'|'+date,{mark,kind:markKind(mark),row:p.row});}
 }
 return {marks,people:new Set(people.keys()),info:people,dates:new Set(sheet.filledDates)};
}

// One line per person and date of the dates, with what each source says and every difference.
// cards:   cardAttendances() of the selection (log book / batch already chosen)
// sheet:   sheetFromFile() or null; punches: punchDays(); people: Employee Master answer ({number,name,designation,found})
// all:     true when every log book and batch is chosen ("no trip card" can only be said then)
// locked:  Set of the dates locked in Pulse-II at the site
export function personDays({cards,sheet=null,punches,people=[],dates,locked,all=true}){
 const master=new Map(people.map(p=>[String(p.number),p]));
 const cardsOf=new Map();
 for(const c of cards){const k=c.number+'|'+c.date;(cardsOf.get(k)||cardsOf.set(k,[]).get(k)).push(c);}
 const onCards=new Set(cards.map(c=>c.number));
 // Drivers and operators: Employee Master or your sheet says so, or the person is on a trip card here.
 const scope=number=>onCards.has(number)||isDriverOrOperator(master.get(number)?.designation)||isDriverOrOperator(sheet?.info.get(number)?.designation);
 const lines=[];
 for(const date of dates){
  const who=new Set(cards.filter(c=>c.date===date).map(c=>c.number));
  if(all){
   if(sheet&&sheet.dates.has(date))for(const n of sheet.people){const m=sheet.marks.get(n+'|'+date);if(m?.kind==='present'&&scope(n))who.add(n);}
   for(const key of punches.here.keys()){const [n,d]=key.split('|');if(d===date&&scope(n))who.add(n);}
  }
  for(const number of who){
   const key=number+'|'+date,own=cardsOf.get(key)||[],m=sheet?.marks.get(key),p=punches.here.get(key),away=punches.away.get(key);
   const inSheet=Boolean(sheet?.people.has(number)),sheetHasDate=Boolean(sheet?.dates.has(date)),isLocked=locked.has(date);
   const sheetP=m?.kind==='present',card=own.length>0,bioFull=Boolean(p?.inTime&&p?.outTime),bioAny=Boolean(p);
   const diffs=[];
   if(isLocked){
    if(sheet&&sheetHasDate&&sheetP&&!card&&all)diffs.push('sheetNoCard');
    if(sheet&&card&&inSheet&&sheetHasDate&&!sheetP)diffs.push('cardNotP');
    if(sheet&&card&&!inSheet)diffs.push('cardNotInSheet');
    if(card&&!bioAny)diffs.push(away?'punchAway':'cardNoBio');
    if(bioAny&&!card&&all)diffs.push('bioNoCard');
   }
   if(bioAny&&!bioFull)diffs.push('missPunch');
   // A trip card without a punch already says so; "your sheet P, no bio-punch" is for a day with no trip card.
   if(sheet&&sheetHasDate&&sheetP&&!bioAny&&!card)diffs.push(away?'punchAway':'sheetNoBio');
   const info=master.get(number)||{},mine=sheet?.info.get(number)||{};
   diffs.splice(0,diffs.length,...new Set(diffs));
   const sources=uniq(own.map(c=>c.source));
   lines.push({id:key,number,date,dateLabel:dmy(date),employeeId:mine.id||own[0]?.employeeId||'CMLL'+number,name:mine.name||info.name||own[0]?.name||'',
    designation:mine.designation||info.designation||'',locked:isLocked,
    sheetSays:!sheet?'':!inSheet?'Not in sheet':!sheetHasDate?'No column':m?.mark||'(blank)',sheetP,
    cardSays:!isLocked?'Date not locked':card?uniq(own.map(c=>c.shiftLabel)).join(' + ')+' · '+uniq(own.flatMap(c=>c.logBooks)).join(' + ')+' · '+sources.map(s=>SOURCE_SHORT[s]||s).join(' + '):'No trip card',
    card,sources,logBook:uniq(own.flatMap(c=>c.logBooks)).join(' + '),books:uniq(own.map(c=>c.books)).join('; '),doors:uniq(own.map(c=>c.doors)).join('; '),
    bioSays:p?(p.inTime||'—')+' → '+(p.outTime||'—'):away?'At '+text(away.site)+' '+(away.inTime||'—')+' → '+(away.outTime||'—'):'No punch',bioIn:text(p?.inTime),bioOut:text(p?.outTime),bioAny,bioFull,
    diffs,agree:!diffs.length&&isLocked&&card&&bioFull&&(!sheet||sheetP),
    result:!diffs.length?(isLocked&&card&&bioFull&&(!sheet||sheetP)?(sheet?'All three agree':'Trip card and bio-punch agree'):!isLocked?'Date not locked yet':'No difference'):diffs.map(d=>DAY_DIFFERENCES.find(x=>x.key===d).label).join(' · ')});
  }
 }
 return lines.sort((a,b)=>a.date.localeCompare(b.date)||Number(a.agree)-Number(b.agree)||a.name.localeCompare(b.name));
}

// One row per date: your sheet, trip cards (scanned / manual / zero-trip), bio-punch, all agree, and each difference.
export function dateRows({lines,cards,sheet=null,dates,locked}){
 return dates.map(date=>{
  const own=lines.filter(l=>l.date===date),day=cards.filter(c=>c.date===date);
  const row={id:date,date,dateLabel:dmy(date),locked:locked.has(date)?'Yes':'No',
   sheetP:sheet&&sheet.dates.has(date)?own.filter(l=>l.sheetP).length:'—',
   cards:day.length,scanned:day.filter(c=>c.source==='scanned'||c.source==='scanned+manual').length,manual:day.filter(c=>c.source==='manual').length,
   zeroTrip:day.filter(c=>c.source==='zero-trip').length,bio:own.filter(l=>l.bioAny).length,agree:own.filter(l=>l.agree).length,people:own.length};
  for(const d of DAY_DIFFERENCES)row[d.key]=own.filter(l=>l.diffs.includes(d.key)).length;
  row.differences=own.filter(l=>l.diffs.length).length;
  return row;
 });
}
export const dateTotals=rows=>{
 const sum=key=>rows.reduce((n,r)=>n+(typeof r[key]==='number'?r[key]:0),0);
 return {id:'total',date:'',dateLabel:'All dates',locked:rows.filter(r=>r.locked==='Yes').length+' locked',
  sheetP:rows.some(r=>typeof r.sheetP==='number')?sum('sheetP'):'—',...Object.fromEntries(['cards','scanned','manual','zeroTrip','bio','agree','people','differences',...DAY_DIFFERENCES.map(d=>d.key)].map(k=>[k,sum(k)]))};
};

// ---- The Excel --------------------------------------------------------------------------------------------------------
export const PULSE_FILLS={missing:'FFFFC78A',extra:'FF9EC9FF',punch:'FFFFE066',same:'FFC9F2D4'};
// The sheet Pulse-II would have written, in the layout of yours: one line per person, one column per date.
//   P-S scanned trip card · P-M manual trip card · P-Z zero-trip entry · B bio-punch here · A nothing · ? date not locked
// Coloured against your sheet: green same, orange your P with no trip card, blue a trip card where your sheet is not P,
// yellow a bio-punch with no trip card.
export function pulseSheet({lines,sheet=null,dates,locked,title}){
 const byPerson=new Map();
 for(const l of lines)(byPerson.get(l.number)||byPerson.set(l.number,{...l,days:new Map()}).get(l.number)).days.set(l.date,l);
 if(sheet)for(const n of sheet.people)if(!byPerson.has(n)){const i=sheet.info.get(n);byPerson.set(n,{number:n,employeeId:i.id,name:i.name,designation:i.designation,days:new Map()});}
 const order=[...byPerson.values()].sort((a,b)=>(Number(sheet?.info.get(a.number)?.row)||1e9)-(Number(sheet?.info.get(b.number)?.row)||1e9)||a.name.localeCompare(b.name));
 const code=l=>{if(!l)return '';const c=l.card?'P-'+(l.sources.includes('scanned')||l.sources.includes('scanned+manual')?'S':l.sources.includes('manual')?'M':'Z'):'';return [c,l.bioAny?'B':''].filter(Boolean).join(' ');};
 const rows=[],cellFills=[];
 for(const p of order){
  const fills={};
  const cells=dates.map((date,i)=>{
   const l=p.days.get(date);
   if(!locked.has(date))return l?.bioAny?'? B':'?';
   const value=code(l)||'A';
   if(sheet&&sheet.people.has(p.number)&&sheet.dates.has(date)){
    const mine=sheet.marks.get(p.number+'|'+date),sheetP=mine?.kind==='present';
    fills[4+i]=sheetP&&!l?.card?'missing':!sheetP&&l?.card?'extra':sheetP&&l?.card?'same':'';
   }
   if(!fills[4+i]&&l?.bioAny&&!l.card)fills[4+i]='punch';
   if(!fills[4+i])delete fills[4+i];
   return value;
  });
  rows.push([p.employeeId||'CMLL'+p.number,p.name||'',p.designation||'',sheet?.people.has(p.number)?'Yes':'No',...cells,
   String(dates.filter(d=>p.days.get(d)?.card).length),String(dates.filter(d=>p.days.get(d)?.bioAny).length)]);
  cellFills.push(fills);
 }
 return {name:'Pulse-II sheet',title,plainSerial:true,fills:PULSE_FILLS,
  headerRows:[title,'P-S scanned trip card · P-M manual trip card · P-Z zero-trip entry · B bio-punch at this site · A nothing in Pulse-II · ? date not locked yet',
   ...(sheet?['Colours against your sheet: GREEN same · ORANGE your sheet P, no trip card · BLUE trip card, your sheet not P · YELLOW bio-punch, no trip card']:[])],
  columns:['EMP. ID','Name','Designation','In your sheet',...dates.map(dmy),'Trip card days','Bio-punch days'].map(label=>({label})),rows,cellFills};
}
export function dateSheet(rows,{sheet,title}){
 const total=dateTotals(rows);
 const cols=[['dateLabel','Date'],['locked','Locked in Pulse-II'],...(sheet?[['sheetP','Your sheet P']]:[]),['cards','Trip card attendances'],['scanned','Trip card – scanned'],['manual','Trip card – manual'],['zeroTrip','Zero-trip entry'],
  ['bio','Bio-punch present'],['agree',sheet?'All three agree':'Card and punch agree'],...DAY_DIFFERENCES.filter(d=>sheet||!d.key.startsWith('sheet')&&d.key!=='cardNotP'&&d.key!=='cardNotInSheet').map(d=>[d.key,d.label])];
 return {name:'Date-wise',title,plainSerial:true,columns:cols.map(([,label])=>({label})),
  rows:[...rows,total].map(r=>cols.map(([k])=>String(r[k]??''))),highlightedRows:new Set([rows.length])};
}
export function differenceSheet(lines,{title,sheet}){
 const bad=lines.filter(l=>l.diffs.length);
 return {name:'Every person-day difference',title,plainSerial:true,
  columns:['Date','EMP. ID','Name','Designation',...(sheet?['Your sheet']:[]),'Trip card','Log book','Card no.','Equipment','Bio-punch','Difference'].map(label=>({label})),
  rows:bad.map(l=>[l.dateLabel,l.employeeId,l.name,l.designation,...(sheet?[l.sheetSays]:[]),l.cardSays,l.logBook,l.books,l.doors,l.bioSays,l.result])};
}
