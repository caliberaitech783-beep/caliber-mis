// Site Sheet vs Trip Card (owner, 23 Nov 2026): the attendance Excel a site keeps by hand against Pulse-II trip cards,
// date by shift, both ways, with a drill-down: "where the trip card has calculated a present but the sheet has not,
// shift wise with drill down, and secondly the opposite way". Later the same evening: the sheet is saved per login and
// read on screen, no Excel; after the date by shift step comes a department-wise, designation-wise or category-wise step
// (HR Pulse's Employee Master: DEPARTMENT, DESIGNATION, CATEGORY).
//
// It reads the result of checkAttendanceSheet (shared/attendance-sheet-check.mjs): one cell per person and date, with its
// state and the duties of that date. One line here is one person on one date (and one shift):
//   card    the sheet says A, PL, - or blank; Pulse-II has a trip card, log book or zero-trip entry at this site (blue)
//   noCard  the sheet says P; Pulse-II has no duty that date at all (orange)
//   away    the sheet says P; Pulse-II has that date's duty at another site (purple)
// The site's sheet has dates only, no shift. A line takes the shift of its Pulse-II duty; a "sheet P, no trip card" line
// has no duty, so its shift is not known and it sits in its own column. Its nearest worked shift at this site is given as a
// hint for finding the missing card; it is never counted as that shift.
import {employeeNumber} from './hr-employee-master.mjs';
import {SHEET_MAX_PEOPLE} from './attendance-sheet-check.mjs';

export const UNKNOWN_SHIFT='zz-not-in-sheet';
export const DAY_KINDS=[
 {key:'card',label:'Trip card present, sheet not P',short:'Trip card, sheet not P',tone:'blue'},
 {key:'noCard',label:'Sheet P, no trip card',short:'Sheet P, no trip card',tone:'orange'},
 {key:'away',label:'Sheet P, trip card at another site',short:'Sheet P, card at another site',tone:'purple'},
];
export const kindLabel=key=>DAY_KINDS.find(k=>k.key===key)?.label||'';
export const shiftName=shift=>shift===UNKNOWN_SHIFT?'Shift not in sheet':/^[A-C]$/.test(String(shift))?'Shift '+shift:String(shift||'');

const text=value=>value===null||value===undefined?'':String(value).trim();
const dayMonth=date=>/^\d{4}-\d{2}-\d{2}$/.test(String(date))?date.slice(8,10)+'-'+date.slice(5,7):text(date);
const uniq=list=>[...new Set(list.filter(Boolean))];
const joined=(list,field)=>uniq(list.map(d=>text(d[field]))).join('; ');
const SHIFT_ORDER=['A','B','C','Day','Night'];
const shiftRank=shift=>{const at=SHIFT_ORDER.indexOf(shift);return shift===UNKNOWN_SHIFT?99:at<0?50:at;};
export const byDateShift=(a,b)=>String(a.date).localeCompare(String(b.date))||shiftRank(a.shift)-shiftRank(b.shift)||(Number(a.row)||0)-(Number(b.row)||0);

const ADVICE={
 card:'The sheet does not say P; Pulse-II has a duty saved for this date and shift. Correct the sheet to P, or correct the Caliber ID on that card if another person worked.',
 noCard:'The sheet says P; Pulse-II has no trip card, log book or zero-trip entry for this date. Save the missing card or zero-trip entry, or correct the sheet to A.',
 away:'The sheet says P here; Pulse-II has the duty of this date at another site. Correct the sheet, or correct the site or the Caliber ID on that card.',
};

// The nearest dates before and after `date` with a duty at this site, with their shifts: a hint for a missing card.
export function nearestShift(worked,date){
 const before=worked.filter(w=>w.date<date).at(-1),after=worked.find(w=>w.date>date);
 const say=w=>w.shifts.map(shiftName).join(' + ')+' on '+dayMonth(w.date);
 return [before,after].filter(Boolean).map(say).join(' · ')||'No duty at this site on any compared date';
}

// One line per person, date and shift for the three kinds. Department, designation and category are HR Pulse's (the
// Employee Master copy); the sheet's own designation is used only when Employee Master has none.
export function sheetDayLines(result){
 const lines=[];
 for(const r of result?.rows||[]){
  if(!r.pulse?.found)continue;
  const worked=r.cells.filter(c=>c.duties?.length).map(c=>({date:c.date,shifts:uniq(c.duties.map(d=>d.shift))}));
  const base={row:r.row,id:r.id,name:r.name,pulseName:r.pulse?.name||'',designation:text(r.pulse?.designation)||text(r.designation),
   department:text(r.pulse?.department),category:text(r.pulse?.category)};
  for(const c of r.cells){
   if(c.state==='duty'){
    const duties=c.duties||[];
    for(const shift of uniq(duties.map(d=>d.shift)).length?uniq(duties.map(d=>d.shift)):['']){
     const own=duties.filter(d=>d.shift===shift);
     lines.push({...base,kind:'card',date:c.date,shift,sheetSays:c.mark||'(blank)',pulseSays:'Duty in '+(shiftName(shift)||'a shift')+(joined(own,'doors')?' on '+joined(own,'doors'):''),books:joined(own,'books'),equipment:joined(own,'doors'),site:result.site,nearest:'',correction:ADVICE.card});
    }
   }else if(c.state==='noDuty'){
    lines.push({...base,kind:'noCard',date:c.date,shift:UNKNOWN_SHIFT,sheetSays:c.mark,pulseSays:'No duty saved',books:'',equipment:'',site:'',nearest:nearestShift(worked,c.date),correction:ADVICE.noCard});
   }else if(c.state==='site'){
    const away=c.away||[];
    for(const shift of uniq(away.map(d=>d.shift)).length?uniq(away.map(d=>d.shift)):['']){
     const own=away.filter(d=>d.shift===shift);
     lines.push({...base,kind:'away',date:c.date,shift,sheetSays:c.mark,pulseSays:'Duty at '+(joined(own,'site')||'another site')+(shift?' in '+shiftName(shift):''),books:joined(own,'books'),equipment:joined(own,'doors'),site:joined(own,'site'),nearest:nearestShift(worked,c.date),correction:ADVICE.away});
    }
   }
  }
 }
 return lines.sort(byDateShift);
}

// The boxes of the date by shift grid: one row per date and shift with the count of each kind.
export function dayShiftRows(lines){
 const rows=new Map();
 for(const l of lines){
  const id=l.date+'|'+l.shift;
  const row=rows.get(id)||rows.set(id,{id,date:l.date,shift:l.shift,total:0,card:0,noCard:0,away:0}).get(id);
  row.total++;row[l.kind]++;
 }
 return [...rows.values()].sort(byDateShift);
}

// What a kind adds up to: lines (person-days) and different people.
export function kindTotals(lines){
 return Object.fromEntries(DAY_KINDS.map(k=>{const own=lines.filter(l=>l.kind===k.key);return [k.key,{lines:own.length,people:new Set(own.map(l=>l.id)).size}];}));
}

// ---- Department, designation, category --------------------------------------------------------------------------------
// HR Pulse writes one job several ways ("TIPPER DRIVER", "DRIVER (TIPPER)", "TIPPER-DRIVER": 259 people at Sasti). Names
// that differ only in letter case, punctuation, spacing or word order are one line, shown in the spelling most people
// have. A real misspelling ("PC- OPRATOR") stays its own line: HR corrects it in HR Pulse.
export const GROUP_BYS=[
 {key:'department',label:'Department-wise',heading:'Department'},
 {key:'designation',label:'Designation-wise',heading:'Designation'},
 {key:'category',label:'Category-wise',heading:'Category'},
];
export const NOT_GIVEN='Not given in HR Pulse';
export const groupKey=value=>text(value).toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().split(' ').filter(Boolean).sort().join(' ');
export function groupLines(lines,by){
 const groups=new Map();
 for(const l of lines){
  const written=text(l[by]),key=groupKey(written)||'~';
  const g=groups.get(key)||groups.set(key,{key,spellings:new Map(),total:0,card:0,noCard:0,away:0,ids:new Set(),cardIds:new Set(),noCardIds:new Set(),awayIds:new Set()}).get(key);
  g.total++;g[l.kind]++;g.ids.add(l.id);g[l.kind+'Ids'].add(l.id);
  if(written)g.spellings.set(written,(g.spellings.get(written)||new Set()).add(l.id));
 }
 return [...groups.values()].map(g=>{
  const spellings=[...g.spellings.entries()].sort((a,b)=>b[1].size-a[1].size||a[0].localeCompare(b[0])).map(([name])=>name);
  return {id:g.key,key:g.key,label:spellings[0]||NOT_GIVEN,spellings,total:g.total,card:g.card,noCard:g.noCard,away:g.away,
   people:g.ids.size,cardPeople:g.cardIds.size,noCardPeople:g.noCardIds.size,awayPeople:g.awayIds.size};
 }).sort((a,b)=>b.total-a.total||a.label.localeCompare(b.label));
}
export const inGroup=(line,by,key)=>(groupKey(line[by])||'~')===key;

// One person day by day: the sheet's mark beside Pulse-II for every date of the sheet that is filled.
const STATE_WORDS={duty:'Trip card present, sheet not P',noDuty:'Sheet P, no trip card',site:'Sheet P, trip card at another site',skip:'Not compared',
 '':'Same in both'};
export function personDays(row){
 return (row?.cells||[]).map(c=>({id:c.date,date:c.date,sheetSays:c.mark||'(blank)',
  pulseSays:c.duties?.length?'Duty in '+uniq(c.duties.map(d=>shiftName(d.shift))).join(' + '):c.away?.length?'Duty at '+joined(c.away,'site'):c.pulse==='?'?'Date not locked yet':c.pulse?'No duty':'Not compared',
  books:joined([...(c.duties||[]),...(c.away||[])],'books'),equipment:joined([...(c.duties||[]),...(c.away||[])],'doors'),
  state:c.state,result:c.state?STATE_WORDS[c.state]??'':!c.pulse?'Not compared':c.kind==='present'&&!c.duties?.length&&!c.away?.length?'Not judged: not a driver or operator':STATE_WORDS['']}));
}

// ---- The saved sheet ------------------------------------------------------------------------------------------------
// What is kept of an uploaded sheet (owner: "user-wise it will save"): the lines and marks parseAttendanceSheet read, and
// nothing else of the file. The server keeps it as it comes back from here, so a sheet the browser could not have read
// is refused.
const ISO=/^\d{4}-\d{2}-\d{2}$/;
const capped=(value,length)=>text(value).replace(/\s+/g,' ').slice(0,length);
export function savedSheetFrom(sheet){
 const dates=Array.isArray(sheet?.dates)?sheet.dates.map(String):[];
 if(!dates.length||dates.length>62||!dates.every(d=>ISO.test(d)))throw Error('This sheet has no date columns that can be kept.');
 const people=Array.isArray(sheet?.people)?sheet.people:[];
 if(!people.length)throw Error('This sheet has no employee line to keep.');
 if(people.length>SHEET_MAX_PEOPLE)throw Error(`Keep up to ${SHEET_MAX_PEOPLE} employees in one sheet.`);
 const kept=people.map(p=>{
  const marks=Array.isArray(p?.marks)?p.marks:[];
  if(marks.length!==dates.length)throw Error('A line of this sheet does not have one mark per date.');
  const id=capped(p.id,40);
  return {row:Number(p.row)||0,sr:capped(p.sr,12),id,number:employeeNumber(id),name:capped(p.name,120),designation:capped(p.designation,80),marks:marks.map(m=>capped(m,8))};
 });
 const keepDates=list=>(Array.isArray(list)?list.map(String):[]).filter(d=>ISO.test(d));
 const filledDates=keepDates(sheet.filledDates).filter(d=>dates.includes(d));
 if(!filledDates.length)throw Error('No date of this sheet is marked.');
 return {sheetName:capped(sheet.sheetName,60),headerRow:Number(sheet.headerRow)||0,dates,filledDates,missingDates:keepDates(sheet.missingDates).slice(0,62),
  noId:(Array.isArray(sheet.noId)?sheet.noId:[]).slice(0,SHEET_MAX_PEOPLE).map(l=>({row:Number(l?.row)||0,name:capped(l?.name,120)})),people:kept};
}
// The month a saved sheet belongs to: the month of its first marked date. One login keeps one sheet per site and month.
export const sheetMonth=sheet=>[...(sheet?.filledDates||[])].sort()[0]?.slice(0,7)||'';
