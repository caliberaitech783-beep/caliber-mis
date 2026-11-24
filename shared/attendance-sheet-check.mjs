// Attendance Sheet Mismatch (owner, 23 Nov 2026): the attendance Excel a site keeps by hand (one line per employee, one
// column per date, P / A marks) against what Pulse-II holds, with the corrections needed given back as an Excel.
//
// The sheet:    SR NO | EMP. ID | NAME | DESIGNATION | one column per date | totals. The first rows may be titles.
// Pulse-II:     Employee Master (who an EMP. ID is, his name, his site, whether HR marks him LEFT) and the attendance the
//               Attendance Month-wise register reads: saved VLB, ELB and LMV cards and zero-trip entries of locked days.
// Both sides meet on the number of the EMP. ID (CMPL7191, CMLL7191 and 7191 are one person) and the date.
//
// What is compared, and what is not:
//  - Every line: is the EMP. ID in Employee Master, is it the same name, is the person held at this site, is he LEFT.
//  - A day counts only when the site's day is locked in Pulse-II (every batch closed), as in the register.
//  - "P in the sheet, no duty in Pulse-II" is judged only for a driver or an operator (by designation): a helper, a
//    mechanic or a supervisor works on no trip card, so Pulse-II holds no day of his to compare.
//  - "Not P in the sheet, a duty in Pulse-II" is judged for everyone.
import {canonicalSiteName} from './site-location.mjs';
import {employeeNumber} from './hr-employee-master.mjs';
import {readDate} from './attendance-mismatch.mjs';
import {drivesOrOperates} from './caliber-id-check.mjs';
import {OPERATIONAL_START} from './operational-start.mjs';

export const SHEET_MAX_PEOPLE=5000;
// The colours of the Excel given back (ARGB). One colour per kind of mismatch; the key is written at the top of the sheet.
export const SHEET_FILLS={id:'FFFF9E9E',name:'FFFFE066',site:'FFD9B8FF',noDuty:'FFFFC78A',duty:'FF9EC9FF',skip:'FFD9D9D9'};
export const SHEET_LEGEND=[
 ['id','RED on EMP. ID = ID mismatch: the ID is not in Pulse-II Employee Master, cannot be read, is written twice in the sheet, or HR marks the person LEFT.'],
 ['name','YELLOW on NAME = name mismatch: the name in the sheet differs from Pulse-II. The Pulse-II name is in the column "Name in Pulse-II"; the column "Name mismatch" says which kind: another name, fuller name, or spelling.'],
 ['site','PURPLE = another site: Pulse-II holds this person at another site (on EMP. ID), or his duty of that date is at another site (on the date).'],
 ['noDuty','ORANGE on a date = the sheet says P, Pulse-II has no trip card, log book or zero-trip entry for that date.'],
 ['duty','BLUE on a date = the sheet says A, PL, - or blank, Pulse-II has a duty saved for that date.'],
 ['skip','GREY on a date = not compared: the date is not locked in Pulse-II yet, or the mark is blank or not understood.'],
];
// A sheet uploaded as one log book (owner, 24 Nov 2026: the VLB, ELB and LMV sheets are uploaded and checked apart). A P
// whose trip card is in another log book is neither a match nor a missing card: it has its own colour and its own list.
export const BOOK_FILL='FF9FE0D6';
export const bookLegend=logBook=>['book','TEAL on a date = the sheet says P and Pulse-II has no '+logBook+' trip card for it: the trip card of that date, or every trip card of this person, is in another log book; or the person has no trip card in any log book and others with the same designation have their cards in another log book (or, when none of them has a card, the designation belongs there: a drill operator to ELB). Listed on the sheet "Another log book"; not counted as a missing card.'];
export const CORRECTION_KINDS={
 'no-id':'No EMP. ID','id-unreadable':'EMP. ID not readable','id-not-found':'EMP. ID not in Pulse-II','id-twice':'EMP. ID twice in the sheet','id-left':'HR marks LEFT',
 // A name mismatch is one colour in the sheet and three kinds in the lists, the one that matters first (nameDifference).
 'name-other':'Name differs: another name','name-fuller':'Name differs: fuller name on one side','name-spelling':'Name differs: spelling or initials',
 'site':'Held at another site','no-duty':'P in the sheet, no duty in Pulse-II','duty':'Not P in the sheet, duty in Pulse-II',
 'other-site':'Duty at another site','mark':'Mark not understood','blank':'Blank mark','no-column':'Date missing in the sheet','not-in-sheet':'In Pulse-II, not in the sheet',
};

const text=value=>value===null||value===undefined?'':String(value).trim();
const norm=value=>text(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const pad=n=>String(n).padStart(2,'0');
export const dmy=date=>/^\d{4}-\d{2}-\d{2}$/.test(String(date))?date.slice(8,10)+'-'+date.slice(5,7)+'-'+date.slice(0,4):text(date);
const dayMonth=date=>date.slice(8,10)+'-'+date.slice(5,7);
const nextDay=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const many=(n,one,more=one+'s')=>n+' '+(n===1?one:more);

// ---- Reading the sheet ---------------------------------------------------------------------------------------------
const HEADINGS={
 id:['emp id','employee id','emp code','employee code','emp no','employee no','caliber id','caliber code','cmll id','cmpl id','id no','id'],
 name:['name','employee name','emp name','name of the employee','name of employee','employee'],
 designation:['designation','desig','desg','designation name'],
 sr:['sr no','sr','sl no','sl','s no','sno','serial no'],
};
// A date heading: an Excel date, an Excel day number (a date cell with a format the reader does not know) or a written date.
export function headingDate(cell){
 if(cell instanceof Date)return readDate(cell);
 if(typeof cell==='number')return Number.isInteger(cell)&&cell>36525&&cell<73051?new Date(Date.UTC(1899,11,30)+cell*86400000).toISOString().slice(0,10):'';
 const written=text(cell);
 return /^\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(written)||/^\d{1,2}[- ][a-z]{3,9}[- ,]+\d{2,4}$/i.test(written)?readDate(written):'';
}
function headingOf(row){
 const at={},dates=[];
 (row||[]).forEach((cell,index)=>{
  const date=headingDate(cell);
  if(date){if(!dates.some(d=>d.date===date))dates.push({index,date});return;}
  const label=norm(cell);if(!label)return;
  for(const [field,names] of Object.entries(HEADINGS))if(at[field]===undefined&&names.includes(label))at[field]=index;
 });
 return at.id!==undefined&&dates.length?{at,dates}:null;
}
// What a mark says: present, absent, leave (a paid leave, weekly off or holiday), none ("-": not on the roll that day),
// blank, or unknown.
const LEAVE=new Set(['PL','CL','SL','EL','ML','L','LWP','WO','W/O','WOF','OFF','H','PH','HO','CO','C/O']);
export function markKind(mark){
 const m=text(mark).toUpperCase().replace(/\s+/g,'');
 if(!m)return 'blank';
 if(/^P\d?$/.test(m)||m==='PP'||m==='HD'||m==='HP'||m==='P/2')return 'present';
 if(m==='A'||m==='AB'||m==='ABS')return 'absent';
 if(LEAVE.has(m))return 'leave';
 if(/^[-–—]+$/.test(m)||m==='NA'||m==='N/A')return 'none';
 return 'unknown';
}

// rows: the cells of one worksheet, row by row (read-excel-file gives a date cell as a Date).
// Returns the people, the dates of the sheet and what is wrong with the sheet itself. Throws when it is not such a sheet.
export function parseAttendanceSheet(rows){
 const list=Array.isArray(rows)?rows:[];
 let headerAt=-1,heading=null;
 for(let i=0;i<Math.min(list.length,25)&&!heading;i++){heading=headingOf(list[i]);if(heading)headerAt=i;}
 if(!heading){
  const numbered=list.slice(0,25).some(row=>(row||[]).some(cell=>HEADINGS.id.includes(norm(cell)))&&(row||[]).filter(cell=>typeof cell==='number'&&cell>=1&&cell<=31).length>=10);
  throw Error(numbered?'The date headings of this sheet are only day numbers (1, 2, 3 …). Write each heading as a full date (01-11-2026) and upload again.'
   :'This sheet has no EMP. ID column with a date column beside it.');
 }
 const {at,dates}=heading,people=[],noId=[];
 list.slice(headerAt+1).forEach((row,i)=>{
  if(!row)return;
  const rowNo=headerAt+i+2,id=text(row[at.id]),name=at.name===undefined?'':text(row[at.name]).replace(/\s+/g,' ');
  const marks=dates.map(d=>text(row[d.index]));
  if(!id&&!name&&!marks.some(Boolean))return;
  if(!id){if(name||marks.some(m=>markKind(m)==='present'||markKind(m)==='absent'))noId.push({row:rowNo,name});return;}
  people.push({row:rowNo,sr:at.sr===undefined?'':text(row[at.sr]),id,number:employeeNumber(id),name,designation:at.designation===undefined?'':text(row[at.designation]).replace(/\s+/g,' '),marks});
 });
 if(!people.length)throw Error('No employee line was found under the headings of this sheet.');
 if(people.length>SHEET_MAX_PEOPLE)throw Error(`This sheet has ${people.length} employee lines. Upload up to ${SHEET_MAX_PEOPLE} at a time.`);
 const all=dates.map(d=>d.date),ordered=[...all].sort();
 const filled=all.filter((date,index)=>people.some(p=>p.marks[index]));
 const missing=[];
 for(let day=ordered[0];day<ordered.at(-1)&&missing.length<62;day=nextDay(day))if(!all.includes(day))missing.push(day);
 return {people,dates:all,filledDates:filled,missingDates:missing,noId,headerRow:headerAt+1};
}

// ---- Names ---------------------------------------------------------------------------------------------------------
// The same name written two ways is not a mismatch: letter case, dots and spacing, the order of the words, a father's
// name after "/" or "S/O", and the usual short forms (MD for MOHAMMAD, KU / KR for KUMAR).
const SHORT=new Map([['MOHD','MD'],['MOHAMMAD','MD'],['MOHAMMED','MD'],['MOHAMAD','MD'],['MOHAMED','MD'],['MOHAMMOD','MD'],['MO','MD'],['KU','KUMAR'],['KR','KUMAR'],['KM','KUMARI']]);
const words=name=>text(name).toUpperCase().replace(/[^A-Z]+/g,' ').trim().split(' ').filter(Boolean).map(word=>SHORT.get(word)||word);
const ownName=name=>text(name).split(/\s*\/\s*|\s+[SDW]\s*\/\s*O\s+/i)[0];
const alike=(a,b)=>a.length>0&&b.length>0&&(a.join('')===b.join('')||[...a].sort().join(' ')===[...b].sort().join(' '));
export function sameName(sheetName,masterName){
 const full=words(sheetName),own=words(ownName(sheetName)),master=words(masterName),masterOwn=words(ownName(masterName));
 return alike(full,master)||alike(own,master)||alike(own,masterOwn)||alike(full,masterOwn);
}
// How far apart two names are when they are not the same. Owner, 23 Nov 2026 ("Yes, group them"): the first sheet run on
// live gave 299 name mismatches for one site, of which about 257 were the same person written differently; they hid the
// ones that matter. The sheet keeps one colour for a name mismatch; the lists name the kind:
//   'spelling'  the same words a letter or two apart ("VITTHAL" / "VITHAL"), or an initial for a word
//   'fuller'    one side has more words (a surname, a father's name) and the rest pair up
//   'other'     another name: the EMP. ID may belong to someone else
// '' when the names are the same (sameName).
function lettersApart(a,b){
 const row=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  let previous=row[0];row[0]=i;
  for(let j=1;j<=b.length;j++){const keep=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=keep;}
 }
 return row[b.length];
}
// Two words are the same word in another spelling: one letter apart for a short word, two for a longer one, or an initial.
const nearWord=(a,b)=>a===b||(a.length===1?b.startsWith(a):b.length===1?a.startsWith(b):lettersApart(a,b)<=(Math.min(a.length,b.length)<=4?1:2));
// Every word of the shorter name has its own partner in the longer one; equal words pair first.
function pairedWords(shorter,longer){
 const left=[...longer],open=[];
 for(const word of shorter){const at=left.indexOf(word);if(at<0)open.push(word);else left.splice(at,1);}
 for(const word of open){const at=left.findIndex(other=>nearWord(word,other));if(at<0)return false;left.splice(at,1);}
 return true;
}
function namesApart(a,b){
 if(!a.length||!b.length)return 'other';
 const [shorter,longer]=a.length<=b.length?[a,b]:[b,a];
 // With the same number of words each word must pair ("ALI KHAN" is not "ANIL KHAN"); with a different number, a name
 // that is the same letters with a space moved or a letter or two changed is a spelling ("RAMKUMAR" / "RAM KUMAAR").
 if(shorter.length===longer.length?pairedWords(shorter,longer):lettersApart(a.join(''),b.join(''))<=2)return 'spelling';
 return pairedWords(shorter,longer)?'fuller':'other';
}
const NAME_GRADE={spelling:1,fuller:2,other:3};
export function nameDifference(sheetName,masterName){
 if(sameName(sheetName,masterName))return '';
 let least='other';
 for(const a of [words(sheetName),words(ownName(sheetName))])for(const b of [words(masterName),words(ownName(masterName))]){
  const kind=namesApart(a,b);if(NAME_GRADE[kind]<NAME_GRADE[least])least=kind;
 }
 return least;
}
const NAME_KIND_WORDS={other:'Another name',fuller:'Fuller name',spelling:'Spelling'};
const NAME_ADVICE={
 other:'Pulse-II has another name for this EMP. ID. First check that the ID belongs to this person: it may be wrong in the sheet. If the ID is right, ask HR to correct the name in Employee Master.',
 fuller:"The same name, written fuller on one side (a surname or a father's name). Write the name in the sheet as Employee Master has it, or ask HR to correct Employee Master.",
 spelling:'The same name in another spelling. Write the name in the sheet as Employee Master has it, or ask HR to correct the spelling in Employee Master.',
};

// ---- Comparing -----------------------------------------------------------------------------------------------------
const drives=designation=>Boolean(text(designation))&&drivesOrOperates({designation});
// The log book a designation belongs to, by the owner's rule (9 Nov 2026, the Jayant fleet list): VLB tippers; ELB
// excavator, dozer, grader, loader, drill (and the surface miner); LMV diesel and water tanker, service and shift van,
// camper, bus, Scorpio, Hydra and the LMV driver. Sites spell them their own way (LODER, TENKAR, DIESELTANKER, PC for the
// excavator). '' when the designation names none of them (an Eicher driver, an all-rounder): such a person stays under
// the log book his sheet was uploaded as. Owner, 24 Nov 2026: a driver or operator with no trip card in any log book is
// placed where his colleagues' cards are, and by this rule when none of them has a card (bookOfDesignation below), so a
// drill operator with no card is not counted as a missing VLB card.
const BOOK_WORDS=[
 ['ELB',/\b(?:PC|POCLAIN|EXCAVATOR|EXCAVETOR|DOZER|GRADER|LOADER|LODER|DRILL|SURFACE|SHOVEL)\b/],
 ['LMV',/\b(?:LMV|BUS|CAMPER|SCORPIO|HYDRA|BOLERO|VAN)\b|TANKER|TENKAR|TANKAR/],
 ['VLB',/\b(?:TIPPER|DUMPER|HAULPAK|VOLVO|SCANIA|HYVA)\b/],
];
export function designationLogBook(designation){
 const words=' '+text(designation).toUpperCase().replace(/[^A-Z]+/g,' ')+' ';
 return BOOK_WORDS.find(([,pattern])=>pattern.test(words))?.[0]||'';
}
// The number a Pulse-II duty line belongs to. The sheet's EMP. ID is the Employee ID, so the line's Employee ID decides
// when it is written as an ID (CMPL or CMLL and a number); a bare code could be another person's number, so then the
// Caliber ID is taken. Employee Master answers by the same number (recordNumber in shared/hr-employee-master.mjs).
const writtenAsId=value=>/^(?:CMPL|CMLL)[\s/-]*\d/i.test(text(value));
export const lineNumber=line=>(writtenAsId(line?.employeeId)?employeeNumber(line.employeeId):'')||employeeNumber(line?.caliberCode);
const lineId=(line,number)=>writtenAsId(line?.employeeId)?text(line.employeeId).toUpperCase():text(line?.caliberCode).toUpperCase()||number;
const shiftLetter=code=>({S1:'A',S2:'B',S3:'C',D:'Day',N:'Night'})[code]||text(code);
const joined=(list,field)=>[...new Set(list.map(l=>text(l[field])).filter(Boolean))].join('; ');
const siteOfKey=key=>canonicalSiteName(String(key).slice(0,String(key).lastIndexOf('|')));
// logBooks and batches: the log book tab (VLB / ELB / LMV) and batch of Site Sheet vs Trip Card filter on them.
// Log books are joined "VLB + ELB", batches "A; B" (a batch name may itself hold a "+").
const listOf=(value,by=/\s*[;+]\s*/)=>(Array.isArray(value)?value:text(value).split(by)).map(text).filter(Boolean);
const dutyNote=l=>({shift:shiftLetter(l.shift),books:text(l.books)||text(l.logBook),doors:text(l.doors),site:text(l.site),
 logBooks:listOf(l.logBooks?.length?l.logBooks:l.logBook),batches:listOf(l.batches,/\s*;\s*/)});

// sheet:      parseAttendanceSheet's result.
// site:       the site chosen on the screen.
// lines:      Pulse-II attendance of the dates (otDuties and attendanceEquipment of /api/reports/manpower/attendance).
// lockedDays: its locked site-days ('siteKey|date').
// people:     Employee Master's answer for the numbers of the sheet ({number,found,name,designation,siteLabel,atSite,working,left}).
// sitePeople: the people Employee Master holds working at this site ({number,name,designation}).
// today:      YYYY-MM-DD (IST); later dates are not compared.
// logBook:    VLB, ELB or LMV when the sheet was uploaded as the sheet of one log book. `lines` then hold only the duties
//             of that log book and otherLines the duties of the other two, so a P with a trip card in another log book is
//             told apart from a P with no trip card at all. '' = one sheet for every log book, as before.
export function checkAttendanceSheet({sheet,site,lines=[],lockedDays=[],people=[],sitePeople=[],today='',logBook='',otherLines=[]}){
 const siteKey=canonicalSiteName(site);
 const master=new Map(people.map(p=>[String(p.number),p]));
 const locked=new Set(lockedDays.filter(k=>siteOfKey(k)===siteKey).map(k=>String(k).slice(String(k).lastIndexOf('|')+1)));
 const byDay=new Map(),active=new Set();
 for(const line of lines){
  const number=lineNumber(line);if(!number||!line.date)continue;
  const entry={...line,number,here:canonicalSiteName(line.siteKey||line.site)===siteKey};
  const key=number+'|'+line.date;(byDay.get(key)||byDay.set(key,[]).get(key)).push(entry);active.add(number);
 }
 // The duties of the other log books: by person and date, and the log books each person's trip cards are in.
 const otherByDay=new Map(),otherBooks=new Map(),otherBook=[];
 for(const line of otherLines){
  const number=lineNumber(line);if(!number||!line.date)continue;
  const note=dutyNote(line),key=number+'|'+line.date;(otherByDay.get(key)||otherByDay.set(key,[]).get(key)).push(note);
  const held=otherBooks.get(number)||otherBooks.set(number,new Set()).get(number);for(const book of note.logBooks)held.add(book);
 }
 // The log book of a driver or operator who has no trip card at all, for a sheet of one log book: where the cards of the
 // others of the sheet with the same designation are (most people; a tie keeps this log book), else the owner's rule
 // (designationLogBook). At Sasti on 24 Nov 2026 the water tanker, diesel tanker, service van, bus and LMV drivers had
 // their cards mostly in VLB (Pulse-II files those machines as vehicles), and no drill operator had a card anywhere.
 const designationKey=value=>text(value).toUpperCase().replace(/[^A-Z]+/g,' ').trim();
 const booksByDesignation=new Map();
 if(logBook)for(const p of sheet.people){
  const books=new Set([...(active.has(p.number)?[logBook]:[]),...(otherBooks.get(p.number)||[])]);
  const key=designationKey(p.designation||master.get(p.number)?.designation);if(!key||!books.size)continue;
  const tally=booksByDesignation.get(key)||booksByDesignation.set(key,new Map()).get(key);
  for(const book of books)tally.set(book,(tally.get(book)||0)+1);
 }
 const bookOfDesignation=designation=>{
  const tally=booksByDesignation.get(designationKey(designation));
  if(!tally?.size)return designationLogBook(designation);
  const most=Math.max(...tally.values()),leaders=[...tally].filter(([,count])=>count===most).map(([book])=>book);
  return leaders.includes(logBook)?logBook:leaders.sort()[0];
 };
 const dateIndex=new Map(sheet.dates.map((date,index)=>[date,index]));
 const compared=sheet.filledDates.filter(date=>date>=OPERATIONAL_START&&(!today||date<=today));
 const early=sheet.filledDates.filter(date=>date<OPERATIONAL_START),later=sheet.filledDates.filter(date=>today&&date>today);
 const pending=compared.filter(date=>!locked.has(date)),judged=compared.filter(date=>locked.has(date));
 const rowsOf=new Map();
 for(const p of sheet.people)if(p.number)(rowsOf.get(p.number)||rowsOf.set(p.number,[]).get(p.number)).push(p.row);
 const corrections=[];
 const rows=sheet.people.map(p=>{
  const pulse=p.number?master.get(p.number)||null:null,twice=p.number&&rowsOf.get(p.number).length>1;
  const marked=kind=>p.marks.some((mark,index)=>sheet.filledDates.includes(sheet.dates[index])&&markKind(mark)===kind);
  const idIssue=!p.number?'id-unreadable':!pulse?.found?'id-not-found':twice?'id-twice':!pulse.working&&marked('present')?'id-left':'';
  const known=Boolean(pulse?.found),siteIssue=known&&pulse.working&&!pulse.atSite;
  const nameKind=known&&p.name&&pulse.name?nameDifference(p.name,pulse.name):'',nameDiffers=Boolean(nameKind);
  const onCards=drives(p.designation)||drives(pulse?.designation),hasDuties=known&&active.has(p.number);
  const add=(kind,extra)=>corrections.push({kind,label:CORRECTION_KINDS[kind],row:p.row,id:p.id,name:p.name,pulseName:pulse?.name||'',designation:p.designation,date:'',sheetSays:'',pulseSays:'',books:'',pulseSite:'',...extra});
  if(idIssue==='id-unreadable')add('id-unreadable',{sheetSays:p.id,correction:'This EMP. ID cannot be read as a Caliber ID (CMPL or CMLL and a number). Write the correct ID in the sheet.'});
  if(idIssue==='id-not-found')add('id-not-found',{sheetSays:p.id,pulseSays:'Not in Employee Master',correction:'This EMP. ID is not in Pulse-II Employee Master. Correct the ID in the sheet, or ask HR to add the employee to Employee Master.'});
  if(idIssue==='id-twice')add('id-twice',{sheetSays:'Rows '+rowsOf.get(p.number).join(', '),correction:'This EMP. ID is written on rows '+rowsOf.get(p.number).join(' and ')+' of the sheet. Keep one line, or correct the ID of the other person.'});
  if(idIssue==='id-left')add('id-left',{sheetSays:'P marked',pulseSays:pulse.left?'HR marks LEFT':"Not on HR's list",correction:(pulse.left?'HR marks this person LEFT':"This person is not on HR's list")+', but the sheet marks P. Remove the P marks, or ask HR to correct Employee Master.'});
  if(nameKind)add('name-'+nameKind,{sheetSays:p.name,pulseSays:pulse.name,correction:NAME_ADVICE[nameKind]});
  if(siteIssue)add('site',{sheetSays:site,pulseSays:pulse.siteLabel||'No site',pulseSite:pulse.siteLabel||'',correction:'Pulse-II Employee Master holds this person at '+(pulse.siteLabel||'no site')+'. Correct the site on Employee Current Location, or remove the person from this sheet.'});
  // The days. A person Pulse-II does not know has no day to compare. A person whose every trip card is in another log
  // book is not compared under this one: he belongs to that log book's sheet. A driver or operator with no trip card in
  // any log book is placed by his designation (bookOfDesignation): a drill operator belongs to ELB, so under VLB he is
  // listed apart, and under ELB his P days are missing ELB cards.
  const byDesignation=logBook&&known&&onCards&&!hasDuties&&!otherBooks.has(p.number)?bookOfDesignation(p.designation)||bookOfDesignation(pulse?.designation):'';
  const placed=Boolean(byDesignation&&byDesignation!==logBook);
  const elsewhere=known&&!hasDuties&&(otherBooks.has(p.number)||placed),judge=known&&(onCards||hasDuties)&&!elsewhere;
  let sheetP=0,pulseP=0;const noDuty=[],blanks=[],otherDays=[];
  const cells=sheet.filledDates.map(date=>{
   const mark=p.marks[dateIndex.get(date)],kind=markKind(mark),cell={date,mark,kind,state:'',pulse:''};
   if(!compared.includes(date))return cell;
   if(kind==='unknown'){cell.state='skip';add('mark',{date,sheetSays:mark,correction:'The mark "'+mark+'" is not understood. Write P, A, PL or - .'});return cell;}
   if(!known)return cell;
   if(!locked.has(date)){if(judge)cell.state='skip';cell.pulse='?';return cell;}
   const all=byDay.get(p.number+'|'+date)||[],here=all.filter(l=>l.here),away=all.filter(l=>!l.here);
   // The duties of the date, kept on the cell for the date by shift view (shared/site-sheet-days.mjs).
   cell.duties=here.map(dutyNote);cell.away=away.map(dutyNote);
   const other=otherByDay.get(p.number+'|'+date)||[];if(other.length)cell.other=other;
   cell.pulse=here.length?'P ('+[...new Set(here.map(l=>shiftLetter(l.shift)))].join('+')+')':away.length?'At '+joined(away,'site'):'A';
   if(judge){if(kind==='present')sheetP++;if(here.length)pulseP++;}
   if(kind==='present'){
    if(here.length)return cell;
    if(away.length){cell.state='site';add('other-site',{date,sheetSays:mark,pulseSays:'Duty at '+joined(away,'site')+' (Shift '+[...new Set(away.map(l=>shiftLetter(l.shift)))].join(', ')+')',books:joined(away,'books'),pulseSite:joined(away,'site'),
     correction:'The sheet says P here; Pulse-II has the duty of this date at '+joined(away,'site')+'. Correct the sheet, or correct the site or the Caliber ID on that card.'});return cell;}
    // P with the trip card in another log book: present, so not a missing card, and not a match of this log book either.
    // It is not one of this log book's P days.
    if(other.length||elsewhere){cell.state='book';otherDays.push(cell);if(judge)sheetP--;return cell;}
    if(onCards){cell.state='noDuty';noDuty.push(cell);}
    return cell;
   }
   if(here.length){cell.state='duty';add('duty',{date,sheetSays:mark||'(blank)',pulseSays:'Duty in Shift '+[...new Set(here.map(l=>shiftLetter(l.shift)))].join(', ')+(joined(here,'doors')?' on '+joined(here,'doors'):''),books:joined(here,'books')||joined(here,'logBook'),
    correction:'The sheet does not say P; Pulse-II has a duty saved for this date. Correct the sheet to P, or correct the Caliber ID on that card if another person worked.'});return cell;}
   if(kind==='blank'){cell.state='skip';blanks.push(date);}
   return cell;
  });
  // A driver with no duty on any locked date is one line, not one line per day: the cause is one (cards never saved, or
  // saved under another ID).
  if(noDuty.length&&pulseP===0&&noDuty.length>1)add('no-duty',{date:dmy(noDuty[0].date)+' to '+dmy(noDuty.at(-1).date),sheetSays:'P on '+many(noDuty.length,'date'),pulseSays:'No duty on any date',
   correction:'The sheet marks P on '+many(noDuty.length,'date')+'; Pulse-II has no trip card, log book or zero-trip entry for this person on any of them. Check the Caliber ID written on his cards, or save the missing cards.'});
  else for(const cell of noDuty)add('no-duty',{date:cell.date,sheetSays:cell.mark,pulseSays:'No duty saved',correction:'The sheet says P; Pulse-II has no trip card, log book or zero-trip entry for this date. Save the missing card or zero-trip entry, or correct the sheet to A.'});
  if(blanks.length)add('blank',{date:blanks.length===1?blanks[0]:'',sheetSays:'(blank)',pulseSays:blanks.length===1?'A':'',correction:(blanks.length===1?'This date is':many(blanks.length,'date')+' ('+blanks.map(dayMonth).join(', ')+') are')+' blank in the sheet. Write P, A, PL or - .'});
  const own=corrections.filter(c=>c.row===p.row);
  // One line per person for the days in another log book: they are not corrections of this log book.
  let books='';
  if(otherDays.length){
   const withCard=otherDays.filter(cell=>cell.other?.length);
   books=[...new Set(placed?[byDesignation]:elsewhere?[...otherBooks.get(p.number)]:withCard.flatMap(cell=>cell.other.flatMap(d=>d.logBooks)))].sort().join(' + ')||'another log book';
   otherBook.push({row:p.row,id:p.id,name:p.name,pulseName:pulse?.name||'',designation:p.designation||pulse?.designation||'',books,whole:elsewhere,byDesignation:placed,days:otherDays.length,cardDays:withCard.length,noCardDays:otherDays.length-withCard.length,
    dates:otherDays.map(cell=>cell.date),cards:[...new Set(withCard.flatMap(cell=>cell.other.map(d=>d.books)).filter(Boolean))].join('; ')});
  }
  const bookNote=otherDays.length&&!elsewhere?'P on '+many(otherDays.length,'date')+' with the trip card in '+books+': not counted here.':'';
  return {...p,pulse,idIssue,siteIssue,nameDiffers,nameKind,onCards,hasDuties,judge,elsewhere,byDesignation:placed,otherBooks:books||(placed?byDesignation:''),bookDays:otherDays.length,cells,sheetP:judge?sheetP:null,pulseP:judge?pulseP:null,difference:judge&&onCards?sheetP-pulseP:null,corrections:own.length,
   remark:!p.number||!known?'Days not compared: the EMP. ID is not in Pulse-II.'
    :placed?'Days not compared under '+logBook+': no trip card in any log book, and the designation belongs to '+byDesignation+'. Check this person under the '+byDesignation+' tab.'
    :elsewhere?'Days not compared under '+(logBook||'this log book')+': every trip card of this person is '+books+'.'
    :!judge?'Days not compared: not a driver or operator, and no duty in Pulse-II.':[!onCards?'Only days with a duty in Pulse-II are compared: not a driver or operator.':'',bookNote].filter(Boolean).join(' ')};
 });
 for(const line of sheet.noId)corrections.push({kind:'no-id',label:CORRECTION_KINDS['no-id'],row:line.row,id:'',name:line.name,pulseName:'',designation:'',date:'',sheetSays:'(blank)',pulseSays:'',books:'',pulseSite:'',correction:'This line has no EMP. ID. Write the ID, or the line cannot be compared.'});
 // In Pulse-II, not in the sheet: people with a duty at this site on a compared date, then people Employee Master holds here.
 const inSheet=new Set(sheet.people.map(p=>p.number).filter(Boolean)),judgedSet=new Set(judged),dutyPeople=new Map();
 for(const [key,list] of byDay){
  const [number,date]=key.split('|');if(inSheet.has(number)||!judgedSet.has(date))continue;
  const here=list.filter(l=>l.here);if(!here.length)continue;
  const held=dutyPeople.get(number)||dutyPeople.set(number,{number,id:lineId(here[0],number),name:text(here[0].employeeName),dates:[],books:[]}).get(number);
  held.dates.push(date);held.books.push(joined(here,'books'));
 }
 const designationOf=new Map(sitePeople.map(p=>[String(p.number),text(p.designation)]));
 const notInSheet=[...dutyPeople.values()].map(p=>({...p,dates:[...new Set(p.dates)].sort(),books:p.books.filter(Boolean).join('; '),designation:designationOf.get(p.number)||'',kind:'duty'}))
  .sort((a,b)=>b.dates.length-a.dates.length||a.name.localeCompare(b.name));
 for(const p of notInSheet)corrections.push({kind:'not-in-sheet',label:CORRECTION_KINDS['not-in-sheet'],row:'',id:p.id,name:'',pulseName:p.name,designation:p.designation,date:p.dates.length===1?p.dates[0]:dmy(p.dates[0])+' to '+dmy(p.dates.at(-1)),sheetSays:'Not in the sheet',pulseSays:many(p.dates.length,'duty date')+' at this site',books:p.books,pulseSite:site,
  correction:'Pulse-II has '+many(p.dates.length,'duty date')+' at this site for this person, who is not in the sheet. Add the person to the sheet, or correct the Caliber ID on those cards.'});
 // The sheet of one log book is not meant to hold everyone of the site: Employee Master's other people are not listed then.
 const listedOnly=logBook?[]:sitePeople.filter(p=>!inSheet.has(String(p.number))&&!dutyPeople.has(String(p.number))).map(p=>({number:String(p.number),id:String(p.number),name:text(p.name),designation:text(p.designation),dates:[],books:'',kind:'listed'}))
  .sort((a,b)=>a.name.localeCompare(b.name));
 // A date the sheet has no column for.
 const noColumn=sheet.missingDates.filter(date=>date>=OPERATIONAL_START&&(!today||date<=today)).map(date=>{
  const duties=new Set();for(const [key,list] of byDay)if(key.endsWith('|'+date)&&list.some(l=>l.here))duties.add(key);
  return {date,duties:duties.size,locked:locked.has(date)};
 });
 for(const d of noColumn)corrections.push({kind:'no-column',label:CORRECTION_KINDS['no-column'],row:'',id:'',name:'',pulseName:'',designation:'',date:d.date,sheetSays:'No column',pulseSays:d.locked?many(d.duties,'person','people')+' on duty':'Date not locked yet',books:'',pulseSite:'',
  correction:'The sheet has no column for this date. Add the column and mark it.'});
 corrections.sort((a,b)=>(Number(a.row)||1e9)-(Number(b.row)||1e9)||String(a.date).localeCompare(String(b.date)));
 const counts=Object.fromEntries(Object.keys(CORRECTION_KINDS).map(kind=>[kind,corrections.filter(c=>c.kind===kind).length]));
 return {site,siteKey,logBook,rows,corrections,counts,notInSheet,listedOnly,noColumn,otherBook,
  dates:{filled:sheet.filledDates,compared,judged,pending,early,later,unfilled:sheet.dates.filter(date=>!sheet.filledDates.includes(date))},
  totals:{people:rows.length,known:rows.filter(r=>r.pulse?.found).length,judged:rows.filter(r=>r.judge).length,drivers:rows.filter(r=>r.onCards).length,notJudged:rows.filter(r=>r.pulse?.found&&!r.judge).length,
   peopleWithCorrections:rows.filter(r=>r.corrections>0).length,corrections:corrections.length}};
}

// The dates Pulse-II must be read for: every date that is compared or missing from the sheet (at most 31 days).
export function sheetReadRange(sheet,today){
 const dates=[...sheet.filledDates,...sheet.missingDates].filter(date=>date>=OPERATIONAL_START&&(!today||date<=today)).sort();
 if(!dates.length)return null;
 const from=dates[0],last=dates.at(-1),limit=new Date(Date.parse(from+'T00:00:00Z')+30*86400000).toISOString().slice(0,10);
 return {from,to:last>limit?limit:last,cut:last>limit};
}

// ---- The Excel given back -------------------------------------------------------------------------------------------
// Sheet specs for buildXlsxSheetsWorkbook (shared/report-xlsx.mjs). The first sheet is the site's own sheet again, with
// each mismatch in its colour and the colour key at the top. No sheet of this workbook colours its Sr. No.: a red or
// orange serial number beside the colour key would be read as a mismatch.
export function attendanceSheetWorkbook(result,{fileName='',checkedAt=''}={}){
 const {site,rows,corrections,counts,dates,totals}=result,logBook=result.logBook||'';
 const period=dates.compared.length?dmy(dates.compared[0])+' to '+dmy(dates.compared.at(-1)):'no date to compare';
 const title=site+(logBook?' · '+logBook+' sheet':'')+' · Attendance sheet mismatch · '+period;
 // The sheet of one log book has one more colour: a P with the trip card in another log book.
 const legendKey=logBook?[...SHEET_LEGEND,bookLegend(logBook)]:SHEET_LEGEND,fillColours=logBook?{...SHEET_FILLS,book:BOOK_FILL}:SHEET_FILLS;
 const gridColumns=['Row in sheet','SR NO','EMP. ID','NAME','Name in Pulse-II','Name mismatch','DESIGNATION',...dates.filled.map(dayMonth),'P days in sheet (locked dates)','P days in Pulse-II (locked dates)','Difference','Corrections','Remark'].map(label=>({label}));
 const cellFills=[];
 const grid=rows.map((r,index)=>{
  const fills={};
  if(r.idIssue)fills[2]='id';else if(r.siteIssue)fills[2]='site';
  if(r.nameDiffers)fills[3]='name';
  r.cells.forEach((cell,i)=>{if(cell.state)fills[7+i]=cell.state;});
  cellFills[index]=fills;
  const blank=value=>value===null||value===undefined?'':String(value);
  return [String(r.row),r.sr,r.id,r.name,r.pulse?.found?(r.nameDiffers?r.pulse.name:'Same'):'Not in Pulse-II',NAME_KIND_WORDS[r.nameKind]||'',r.designation,...r.cells.map(cell=>cell.mark),blank(r.sheetP),blank(r.pulseP),blank(r.difference),String(r.corrections),r.remark];
 });
 const legend=legendKey.map(([,line])=>line);
 const first={name:'Attendance check',title,plainSerial:true,freezeColumns:5,fills:fillColours,cellFills,
  headerRows:[title+(logBook?' · compared with '+logBook+' trip cards only':'')+(fileName?' · file: '+fileName:'')+(checkedAt?' · checked '+checkedAt:''),...legend],headerFills:Object.fromEntries(legendKey.map(([fill],index)=>[index+1,fill])),columns:gridColumns,rows:grid};
 const list={name:'Corrections',title:site+' · Corrections required · '+period,plainSerial:true,
  columns:['Row in sheet','EMP. ID','Name in sheet','Name in Pulse-II','Designation','Date','Mismatch','Sheet says','Pulse-II says','Correction required','Trip cards / log books'].map(label=>({label})),
  rows:corrections.map(c=>[String(c.row),c.id,c.name,c.pulseName,c.designation,/^\d{4}-\d{2}-\d{2}$/.test(c.date)?dmy(c.date):c.date,c.label,c.sheetSays,c.pulseSays,c.correction,c.books])};
 const absent=[...result.notInSheet,...result.listedOnly];
 const others={name:'Not in sheet',title:site+' · In Pulse-II, not in the sheet · '+period,plainSerial:true,
  columns:['EMP. ID','Name in Pulse-II','Designation','Why listed','Duty dates at this site','Dates','Trip cards / log books'].map(label=>({label})),
  rows:absent.map(p=>[p.id,p.name,p.designation,p.kind==='duty'?'Has a duty at this site in Pulse-II':'Employee Master holds this person at this site',p.dates.length?String(p.dates.length):'',p.dates.map(dayMonth).join(', '),p.books]),
  highlightedRows:new Set(result.notInSheet.map((_,index)=>index))};
 const say=list=>list.length?list.map(dmy).join(', '):'None';
 const summaryRows=[
  ['Employees in the sheet',String(totals.people),''],
  ['Found in Pulse-II Employee Master',String(totals.known),''],
  ['Compared day by day (a driver or operator, or a duty in Pulse-II)',String(totals.judged),''],
  ['Not compared day by day (no trip card work: helpers, mechanics, supervisors, staff)',String(totals.notJudged),'Pulse-II holds attendance only from trip cards, log books and zero-trip entries.'],
  ['Employees with at least one correction',String(totals.peopleWithCorrections),''],
  ['Corrections in all',String(totals.corrections),'Listed one by one on the sheet "Corrections".'],
  ...Object.entries(CORRECTION_KINDS).map(([kind,label])=>['· '+label,String(counts[kind]||0),'']),
  ...(logBook?[['In this sheet, belongs to another log book (people)',String(result.otherBook.length),'Their trip cards are there, or they have none and the designation belongs there ('+result.otherBook.filter(p=>p.byDesignation).length+' by designation). Listed on the sheet "Another log book". Not counted as corrections of '+logBook+'.'],
   ['Compared with',logBook+' trip cards only','A sheet of one log book: the other people Employee Master holds at this site are not listed.']]
   :[['In Pulse-II Employee Master at this site, not in the sheet',String(result.listedOnly.length),'Listed on the sheet "Not in sheet".']]),
  ['Dates compared (locked in Pulse-II)',String(dates.judged.length),say(dates.judged)],
  ['Dates not locked in Pulse-II yet (not compared)',String(dates.pending.length),say(dates.pending)],
  ['Dates with no mark in the sheet (not compared)',String(dates.unfilled.length),say(dates.unfilled)],
  ['Dates the sheet has no column for',String(result.noColumn.length),say(result.noColumn.map(d=>d.date))],
  ...(dates.early.length?[['Dates before Pulse-II started (not compared)',String(dates.early.length),say(dates.early)]]:[]),
  ...(dates.later.length?[['Dates after today (not compared)',String(dates.later.length),say(dates.later)]]:[]),
 ];
 const summary={name:'Summary',title:site+' · Summary of the check · '+period,plainSerial:true,columns:['Check','Count','Note'].map(label=>({label})),rows:summaryRows};
 return {title,sheets:[first,list,others,summary]};
}
