// Site Sheet vs Trip Card (owner, 23 Nov 2026): the attendance Excel a site keeps by hand against Pulse-II trip cards,
// date by shift, both ways, with a drill-down: "where the trip card has calculated a present but the sheet has not,
// shift wise with drill down, and secondly the opposite way".
//
// It reads the result of checkAttendanceSheet (shared/attendance-sheet-check.mjs): one cell per person and date, with its
// state and the duties of that date. One line here is one person on one date (and one shift):
//   card    the sheet says A, PL, - or blank; Pulse-II has a trip card, log book or zero-trip entry at this site (blue)
//   noCard  the sheet says P; Pulse-II has no duty that date at all (orange)
//   away    the sheet says P; Pulse-II has that date's duty at another site (purple)
// The site's sheet has dates only, no shift. A line takes the shift of its Pulse-II duty; a "sheet P, no trip card" line
// has no duty, so its shift is not known and it sits in its own column. Its nearest worked shift at this site is given as a
// hint for finding the missing card; it is never counted as that shift.
import {dmy} from './attendance-sheet-check.mjs';

export const UNKNOWN_SHIFT='zz-not-in-sheet';
export const DAY_KINDS=[
 {key:'card',label:'Trip card present, sheet not P',short:'Trip card, sheet not P',tone:'blue'},
 {key:'noCard',label:'Sheet P, no trip card',short:'Sheet P, no trip card',tone:'orange'},
 {key:'away',label:'Sheet P, trip card at another site',short:'Sheet P, card at another site',tone:'purple'},
];
export const kindLabel=key=>DAY_KINDS.find(k=>k.key===key)?.label||'';
// Owner, 24 Nov 2026: the site's sheet is uploaded one log book at a time. The user first says which log book the file is
// (VLB, ELB or LMV), uploads it, and gets the result of that log book only: its sheet against its own trip cards. Each
// log book keeps its own file and its own result. The tabs, in order:
export const SHEET_BOOKS=[
 {key:'VLB',label:'VLB sheet',about:'Vehicle Log Book · tippers and other vehicles'},
 {key:'ELB',label:'ELB sheet',about:'Equipment Log Book · excavators, dozers, graders, loaders, drills'},
 {key:'LMV',label:'LMV sheet',about:'LMV Log Book · light vehicles'},
];
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

// The log books and batches of a line's duties (for the VLB / ELB / LMV tab and the batch choice).
const tags=duties=>({logBooks:uniq(duties.flatMap(d=>d.logBooks||[])),batches:uniq(duties.flatMap(d=>d.batches||[]))});
// The lines of a log book tab and a batch. "Sheet P, no trip card" has no card, so no log book or batch: it is shown only
// when every log book and batch is chosen.
export function selectDayLines(lines,{logBook='',batch=''}={}){
 if(!logBook&&!batch)return lines;
 return lines.filter(l=>l.kind!=='noCard'&&(!logBook||l.logBooks.includes(logBook))&&(!batch||(batch==='(no batch)'?!l.batches.length:l.batches.includes(batch))));
}

// One line per person, date and shift for the three kinds.
export function sheetDayLines(result){
 const lines=[];
 for(const r of result?.rows||[]){
  if(!r.pulse?.found)continue;
  const worked=r.cells.filter(c=>c.duties?.length).map(c=>({date:c.date,shifts:uniq(c.duties.map(d=>d.shift))}));
  const base={row:r.row,id:r.id,name:r.name,pulseName:r.pulse?.name||'',designation:r.designation||r.pulse?.designation||''};
  for(const c of r.cells){
   if(c.state==='duty'){
    const duties=c.duties||[];
    for(const shift of uniq(duties.map(d=>d.shift)).length?uniq(duties.map(d=>d.shift)):['']){
     const own=duties.filter(d=>d.shift===shift);
     lines.push({...base,...tags(own),kind:'card',date:c.date,shift,sheetSays:c.mark||'(blank)',pulseSays:'Duty in '+(shiftName(shift)||'a shift')+(joined(own,'doors')?' on '+joined(own,'doors'):''),books:joined(own,'books'),equipment:joined(own,'doors'),site:result.site,nearest:'',correction:ADVICE.card});
    }
   }else if(c.state==='noDuty'){
    lines.push({...base,logBooks:[],batches:[],kind:'noCard',date:c.date,shift:UNKNOWN_SHIFT,sheetSays:c.mark,pulseSays:'No duty saved',books:'',equipment:'',site:'',nearest:nearestShift(worked,c.date),correction:ADVICE.noCard});
   }else if(c.state==='site'){
    const away=c.away||[];
    for(const shift of uniq(away.map(d=>d.shift)).length?uniq(away.map(d=>d.shift)):['']){
     const own=away.filter(d=>d.shift===shift);
     lines.push({...base,...tags(own),kind:'away',date:c.date,shift,sheetSays:c.mark,pulseSays:'Duty at '+(joined(own,'site')||'another site')+(shift?' in '+shiftName(shift):''),books:joined(own,'books'),equipment:joined(own,'doors'),site:joined(own,'site'),nearest:nearestShift(worked,c.date),correction:ADVICE.away});
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

// One person day by day: the sheet's mark beside Pulse-II for every date of the sheet that is filled.
const STATE_WORDS={duty:'Trip card present, sheet not P',noDuty:'Sheet P, no trip card',site:'Sheet P, trip card at another site',book:'Sheet P, trip card in another log book',skip:'Not compared',
 '':'Same in both'};
// A duty of another log book on a date (only when the sheet was uploaded as one log book): "ELB card in Shift A".
const otherSays=c=>uniq(c.other.flatMap(d=>d.logBooks)).join(' + ')+' card in '+uniq(c.other.map(d=>shiftName(d.shift))).join(' + ');
export function personDays(row){
 return (row?.cells||[]).map(c=>{
  const cards=[...(c.duties||[]),...(c.away||[]),...(c.other||[])],own=c.duties?.length||c.away?.length;
  return {id:c.date,date:c.date,sheetSays:c.mark||'(blank)',
   pulseSays:c.duties?.length?'Duty in '+uniq(c.duties.map(d=>shiftName(d.shift))).join(' + '):c.away?.length?'Duty at '+joined(c.away,'site'):c.other?.length?otherSays(c)
    :c.state==='book'?'No trip card; his trip cards are '+(row.otherBooks||'in another log book'):c.pulse==='?'?'Date not locked yet':c.pulse?'No duty':'Not compared',
   books:joined(cards,'books'),equipment:joined(cards,'doors'),
   state:c.state,result:c.state?STATE_WORDS[c.state]??'':!c.pulse?'Not compared':c.other?.length&&!own?'Trip card in another log book: not compared here'
    :c.kind==='present'&&!own?'Not judged: not a driver or operator':STATE_WORDS['']};
 });
}
// The people of a one-log-book sheet whose trip cards are in another log book, for the screen: one line per person.
export const otherBookRows=result=>(result?.otherBook||[]).map(p=>({...p,key:'other-'+p.row,which:p.whole?'Every trip card':'Some days',datesLabel:p.dates.map(dayMonth).join(', ')}));

// ---- The Excel ------------------------------------------------------------------------------------------------------
// Three sheets for buildXlsxSheetsWorkbook, put after the site's own sheet: the date by shift counts, then the lines of
// each way, date and shift in order.
export function sheetDaySheets(result,lines=sheetDayLines(result)){
 const period=result.dates?.compared?.length?dmy(result.dates.compared[0])+' to '+dmy(result.dates.compared.at(-1)):'';
 const rows=dayShiftRows(lines);
 const shifts=uniq(rows.map(r=>r.shift)).sort((a,b)=>shiftRank(a)-shiftRank(b)||a.localeCompare(b));
 // One column per shift and kind that occurs, then the day totals.
 const cols=shifts.flatMap(shift=>DAY_KINDS.filter(k=>rows.some(r=>r.shift===shift&&r[k.key]>0)).map(k=>({shift,kind:k.key,label:shiftName(shift)+' · '+k.short})));
 const dates=uniq(rows.map(r=>r.date)).sort();
 const count=(date,shift,kind)=>rows.filter(r=>(!date||r.date===date)&&(!shift||r.shift===shift)).reduce((n,r)=>n+(kind?r[kind]:r.total),0);
 const gridRow=date=>[date?dmy(date):'All dates',...cols.map(c=>String(count(date,c.shift,c.kind))),...DAY_KINDS.map(k=>String(count(date,'',k.key))),String(count(date,'',''))];
 const grid={name:'Date x shift',title:result.site+' · Trip card against the sheet · date by shift · '+period,plainSerial:true,
  headerRows:[result.site+' · Trip card against the sheet · date by shift · '+period,
   'Each figure is people on that date and shift. Trip card, sheet not P: Pulse-II has a duty, the sheet says A, PL, - or blank. Sheet P, no trip card: the sheet says P, Pulse-II has no duty that date.',
   'The site sheet has dates only, no shift: a "sheet P, no trip card" line has no duty to take a shift from, so it is under "Shift not in sheet".'],
  columns:['Date',...cols.map(c=>c.label),...DAY_KINDS.map(k=>'Day · '+k.short),'Day · all'].map(label=>({label})),
  rows:[...dates.map(gridRow),gridRow('')],highlightedRows:new Set([dates.length])};
 const detail=(kinds,name,title,withNearest)=>({name,title:result.site+' · '+title+' · '+period,plainSerial:true,
  columns:['Date','Shift','Row in sheet','EMP. ID','Name in sheet','Name in Pulse-II','Designation','Sheet says','Pulse-II says',...(withNearest?['Nearest shift worked here']:[]),'Trip cards / log books','Equipment','Correction required'].map(label=>({label})),
  rows:lines.filter(l=>kinds.includes(l.kind)).map(l=>[dmy(l.date),shiftName(l.shift),String(l.row),l.id,l.name,l.pulseName,l.designation,l.sheetSays,l.pulseSays,...(withNearest?[l.nearest]:[]),l.books,l.equipment,l.correction])});
 return [grid,
  detail(['card'],'Trip card, sheet not P','Trip card present, sheet not P',false),
  detail(['noCard','away'],'Sheet P, no trip card','Sheet P, no trip card at this site',true)];
}
// One more sheet when the file was uploaded as one log book: the people marked P whose trip card is in another log book.
export function otherBookSheet(result){
 const book=result.logBook||'this log book',period=result.dates?.compared?.length?dmy(result.dates.compared[0])+' to '+dmy(result.dates.compared.at(-1)):'';
 const title=result.site+' · In the '+book+' sheet, trip cards in another log book · '+period;
 return {name:'Another log book',title,plainSerial:true,
  headerRows:[title,
   'These people are marked P in the '+book+' sheet, but the trip card of that date is in another log book. They are present: nothing is counted against '+book+', and nothing is listed as a missing card.',
   '"Every trip card": the person has no '+book+' trip card on any compared date, so he is not compared under '+book+' at all. Check him under the tab of his own log book, with that log book\'s sheet.'],
  columns:['Row in sheet','EMP. ID','Name in sheet','Name in Pulse-II','Designation','Trip cards are in','Which days','P days in the sheet','With a trip card there','With no trip card','Dates','Trip cards / log books'].map(label=>({label})),
  rows:otherBookRows(result).map(p=>[String(p.row),p.id,p.name,p.pulseName,p.designation,p.books,p.which,String(p.days),String(p.cardDays),String(p.noCardDays),p.datesLabel,p.cards])};
}
