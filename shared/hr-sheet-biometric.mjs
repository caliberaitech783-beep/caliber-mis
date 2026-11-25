// Attendance Sheet Mismatch › HR sheet vs Biometric (owner, 25 Nov 2026): "mujhe excel file upload ka tab chahiye jo ki hr
// se manually banaya hai excel me attendance ke liye ... yahi file ko mismatch find karne jaruri hai", set beside the
// biometric that HR Pulse holds after the device upload. The same upload process as Site Sheet vs Trip Card.
//
// The HR sheet:  SR NO | EMP. ID | NAME | DESIGNATION | one column per date (P, A, WO, L, HD …), read by
//                parseAttendanceSheet (shared/attendance-sheet-check.mjs), the same layout as the site sheet.
// The biometric: one line per employee and date (shared/trip-biometric-check.mjs): the site machines' punches from HR
//                Pulse with HR's Manual Biometric corrections, the device files imported on Attendance Management, or a
//                device file uploaded here (a day with no site of its own is a day at the chosen site).
// Both sides meet on the number of the EMP. ID (CMPL7191, CMLL7191 and 7191 are one person) and the date.
//
// Everyone on the sheet is compared, staff, helpers and supervisors too: everyone punches. Owner's choices (25 Nov 2026):
//  - P with a full punch (IN and OUT, or a day HR marked present) is the same in both.
//  - P with only an IN or only an OUT is a miss punch; P with a punch only at another site is "punch at another site";
//    P with no punch is "no punch".
//  - A, WO, L, CO, H, "-" or blank with no punch is the same in both; with a punch at this site it is "punch, sheet not P".
//  - A mark the sheet does not know (X, ?) is not compared.
//  - Trip cards are only shown beside a day (driver or operator), never counted.
// Nothing is saved in Pulse-II: the sheet and the device file are read in the browser, only ID numbers are asked about.
import {canonicalSiteName} from './site-location.mjs';
import {CORRECTION_KINDS,dmy,lineNumber,markKind,nameDifference} from './attendance-sheet-check.mjs';
import {MAX_DAYS,correctionText,sourceLabelOf} from './trip-biometric-check.mjs';

export const HR_KINDS=[
 {key:'noPunch',label:'HR sheet P, no punch',tone:'red'},
 {key:'missPunch',label:'HR sheet P, miss punch (IN or OUT missing)',tone:'yellow'},
 {key:'away',label:'HR sheet P, punch at another site',tone:'purple'},
 {key:'punchNotP',label:'Punch, HR sheet not P',tone:'blue'},
];
export const HR_KIND_KEYS=HR_KINDS.map(k=>k.key);
export const hrKindLabel=key=>HR_KINDS.find(k=>k.key===key)?.label||'';
// The Excel's colours (ARGB): one per kind, grey for a mark not compared, orange for an ID or name to correct.
export const HR_FILLS={noPunch:'FFFF9E9E',missPunch:'FFFFE066',away:'FFD9B8FF',punchNotP:'FF9EC9FF',skip:'FFD9D9D9',id:'FFFFC78A'};
export const HR_LEGEND=[
 ['noPunch','RED on a date = the HR sheet says P, the biometric has no punch of that date.'],
 ['missPunch','YELLOW on a date = the HR sheet says P, the biometric has only the IN or only the OUT.'],
 ['away','PURPLE on a date = the HR sheet says P, the punch of that date is at another site.'],
 ['punchNotP','BLUE on a date = the HR sheet says A, WO, L, CO, H, - or blank, the biometric has a punch at this site.'],
 ['skip','GREY on a date = not compared: the mark is not understood.'],
 ['id','ORANGE on EMP. ID or NAME = the ID is not in Employee Master, cannot be read, is written twice, HR marks the person LEFT, the person is held at another site, or the name differs.'],
];
// The ID and name problems of a sheet line, in the words of Site Sheet vs Trip Card.
export const HR_ID_KINDS=['no-id','id-unreadable','id-not-found','id-twice','id-left','site','name-other','name-fuller','name-spelling'];

const text=v=>v===null||v===undefined?'':String(v).trim();
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const SHIFT={S1:'A',S2:'B',S3:'C',D:'Day',N:'Night'};
const shiftWord=code=>{const s=SHIFT[text(code)]||text(code);return /^[A-C]$/.test(s)?'Shift '+s:s;};
const uniq=list=>[...new Set(list.filter(Boolean))];

// The dates read for the sheet: its marked dates up to today, at most MAX_DAYS from the first.
export function hrSheetRange(sheet,today){
 const dates=[...(sheet?.filledDates||[])].filter(d=>!today||d<=today).sort();
 if(!dates.length)return null;
 const from=dates[0],limit=addDays(from,MAX_DAYS-1),last=dates.at(-1);
 return {from,to:last>limit?limit:last,cut:last>limit};
}

// What one day is: the sheet's mark beside the punch. '' = the same in both; 'skip' = not compared.
export function dayKind(mark,{here,away}={}){
 const kind=markKind(mark);
 if(kind==='unknown')return 'skip';
 if(kind==='present'){
  if(here){if(here.presentByHr||(here.inTime&&here.outTime))return '';return 'missPunch';}
  return away?'away':'noPunch';
 }
 return here?'punchNotP':'';
}

// sheet:  parseAttendanceSheet's result.
// site:   the site chosen.
// days:   biometric days (machineDays / importedDays / biometricDays merged); a day with no site is at this site.
// people: Employee Master's answer for the numbers ({number,found,name,designation,siteLabel,atSite,working,left}).
// lines:  Pulse-II trip card attendance of the dates (only shown beside a day).
// from, to: the dates compared (hrSheetRange).
export function hrSheetBiometricCheck({sheet,site,days=[],people=[],lines=[],from,to}){
 const siteKey=canonicalSiteName(site);
 const master=new Map(people.map(p=>[String(p.number),p]));
 const inRange=d=>d>=from&&d<=to;
 const atSite=d=>!d.site||canonicalSiteName(d.site)===siteKey;
 const here=new Map(),away=new Map();
 for(const d of days){if(!d?.caliberCode||!inRange(d.date))continue;(atSite(d)?here:away).set(d.caliberCode+'|'+d.date,d);}
 const cards=new Map();
 for(const l of lines){
  const number=lineNumber(l);if(!number||!l.date||!inRange(l.date)||canonicalSiteName(l.siteKey||l.site)!==siteKey)continue;
  const key=number+'|'+l.date;(cards.get(key)||cards.set(key,[]).get(key)).push(l);
 }
 const cardText=list=>list?.length?uniq(list.flatMap(l=>Array.isArray(l.logBooks)&&l.logBooks.length?l.logBooks:text(l.logBook||l.books).split(/\s*[+,;]\s*/))).join(' + ')+' · '+uniq(list.map(l=>shiftWord(l.shift))).join(' + '):'';
 const columns=sheet.dates.map((date,index)=>({date,index})).filter(c=>sheet.filledDates.includes(c.date)&&inRange(c.date)).sort((a,b)=>a.date.localeCompare(b.date));
 const compared=columns.map(c=>c.date);
 const rowsOf=new Map();
 for(const p of sheet.people)if(p.number)(rowsOf.get(p.number)||rowsOf.set(p.number,[]).get(p.number)).push(p.row);
 const issues=[],lines_=[];
 const rows=sheet.people.map(p=>{
  const pulse=p.number?master.get(p.number)||null:null,known=Boolean(pulse?.found);
  const twice=p.number&&rowsOf.get(p.number).length>1;
  const markedP=columns.some(c=>markKind(p.marks[c.index])==='present');
  const nameKind=known&&p.name&&pulse.name?nameDifference(p.name,pulse.name):'';
  const found=[];
  const add=(kind,sheetSays,pulseSays)=>found.push({kind,label:CORRECTION_KINDS[kind],row:p.row,id:p.id,name:p.name,pulseName:pulse?.name||'',designation:p.designation||pulse?.designation||'',sheetSays,pulseSays});
  if(!p.number)add('id-unreadable',p.id,'Not a Caliber ID');
  else if(!known)add('id-not-found',p.id,'Not in Employee Master');
  if(twice)add('id-twice','Rows '+rowsOf.get(p.number).join(', '),'');
  if(known&&!pulse.working&&markedP)add('id-left','P marked',pulse.left?'HR marks LEFT':"Not on HR's list");
  if(known&&pulse.working&&!pulse.atSite)add('site',site,pulse.siteLabel||'No site');
  if(nameKind)add('name-'+nameKind,p.name,pulse.name);
  issues.push(...found);
  const cells=columns.map(({date,index})=>{
   const mark=text(p.marks[index]),key=p.number+'|'+date,h=p.number?here.get(key):null,a=p.number?away.get(key):null;
   const kind=p.number?dayKind(mark,{here:h,away:a}):'skip',card=cardText(cards.get(key));
   const cell={date,mark,kind,inTime:h?.inTime||'',outTime:h?.outTime||'',punchSite:h?(h.site||site):a?.site||'',source:sourceLabelOf(h||a),hrCorrection:correctionText(h||a),card,punched:Boolean(h)};
   if(HR_KIND_KEYS.includes(kind))lines_.push({id:p.row+'|'+date,row:p.row,empId:p.id,number:p.number,name:p.name,pulseName:pulse?.name||'',designation:p.designation||pulse?.designation||'',...cell});
   return cell;
  });
  const count=k=>cells.filter(c=>c.kind===k).length;
  const sheetP=cells.filter(c=>markKind(c.mark)==='present').length,punched=cells.filter(c=>c.punched).length;
  return {row:p.row,sr:p.sr,id:p.id,number:p.number,name:p.name,pulseName:pulse?.name||'',designation:p.designation||pulse?.designation||'',nameKind,
   idIssue:found.length>0,issues:found.map(f=>f.label),cells,sheetP,punched,same:cells.filter(c=>markKind(c.mark)==='present'&&c.kind==='').length,
   ...Object.fromEntries(HR_KIND_KEYS.map(k=>[k,count(k)])),mismatches:HR_KIND_KEYS.reduce((s,k)=>s+count(k),0)};
 });
 // Lines that name nobody: a name or a mark with no EMP. ID.
 for(const n of sheet.noId||[])issues.push({kind:'no-id',label:CORRECTION_KINDS['no-id'],row:n.row,id:'',name:n.name,pulseName:'',designation:'',sheetSays:'No EMP. ID',pulseSays:''});
 // Punched at this site on a compared date, not on the sheet.
 const onSheet=new Set(sheet.people.map(p=>p.number).filter(Boolean)),dateSet=new Set(compared),notInSheet=new Map();
 for(const d of here.values()){
  if(onSheet.has(d.caliberCode)||!dateSet.has(d.date))continue;
  const m=master.get(d.caliberCode),held=notInSheet.get(d.caliberCode)||notInSheet.set(d.caliberCode,{number:d.caliberCode,id:'CMLL'+d.caliberCode,name:m?.name||'',designation:m?.designation||'',dates:[]}).get(d.caliberCode);
  held.dates.push(d.date);
 }
 const missing=[...notInSheet.values()].map(p=>({...p,dates:p.dates.sort(),days:p.dates.length,datesLabel:p.dates.sort().map(dmy).join(', ')}))
  .sort((a,b)=>b.days-a.days||a.number.localeCompare(b.number,undefined,{numeric:true}));
 // One line per date: what the sheet and the biometric say, and each kind.
 const byDate=compared.map(date=>{
  const cellsOf=rows.map(r=>r.cells.find(c=>c.date===date)).filter(Boolean);
  const out={id:date,date,shift:'all',sheetP:cellsOf.filter(c=>markKind(c.mark)==='present').length,punched:cellsOf.filter(c=>c.punched).length,
   same:cellsOf.filter(c=>markKind(c.mark)==='present'&&c.kind==='').length,...Object.fromEntries(HR_KIND_KEYS.map(k=>[k,cellsOf.filter(c=>c.kind===k).length]))};
  out.total=HR_KIND_KEYS.reduce((s,k)=>s+out[k],0);
  return out;
 });
 const counts=Object.fromEntries(HR_KIND_KEYS.map(k=>[k,lines_.filter(l=>l.kind===k).length]));
 const sum=key=>byDate.reduce((s,d)=>s+d[key],0);
 return {site,from,to,dates:{compared,skipped:sheet.filledDates.filter(d=>!dateSet.has(d))},rows,lines:lines_,byDate,issues,notInSheet:missing,counts,
  totals:{people:sheet.people.length,known:rows.filter(r=>master.get(r.number)?.found).length,sheetP:sum('sheetP'),punched:sum('punched'),same:sum('same'),
   mismatches:lines_.length,peopleWithMismatch:rows.filter(r=>r.mismatches).length,issues:issues.length,notInSheet:missing.length,
   skipped:rows.reduce((s,r)=>s+r.cells.filter(c=>c.kind==='skip').length,0)}};
}

// One person day by day (Step 4).
const DAY_WORDS={'':'Same in both',skip:'Not compared'};
export const hrPersonDays=row=>(row?.cells||[]).map(c=>({...c,id:row.row+'|'+c.date,result:DAY_WORDS[c.kind]??hrKindLabel(c.kind)}));

// ---- The Excel given back -------------------------------------------------------------------------------------------
// The HR sheet again, each day coloured by what the biometric says, then the mismatches, the ID problems, the people
// who punched and are not on the sheet, and the summary. No sheet colours its Sr. No. (it would read as a mismatch).
export function hrSheetBiometricWorkbook(result,{fileName='',checkedAt='',bioLabel=''}={}){
 const {site,rows,lines,issues,notInSheet,dates,totals,counts}=result;
 const period=dates.compared.length?dmy(dates.compared[0])+' to '+dmy(dates.compared.at(-1)):'no date to compare';
 const title=site+' · HR sheet vs biometric · '+period;
 const cellFills=[];
 const grid=rows.map((r,index)=>{
  const fills={};if(r.idIssue){fills[2]='id';if(r.nameKind)fills[3]='id';}
  r.cells.forEach((c,i)=>{if(c.kind)fills[6+i]=c.kind;});
  cellFills[index]=fills;
  return [String(r.row),r.sr,r.id,r.name,r.pulseName&&r.nameKind?r.pulseName:r.pulseName?'Same':'Not in Pulse-II',r.designation,...r.cells.map(c=>c.mark),String(r.sheetP),String(r.punched),String(r.same),String(r.mismatches),r.issues.join('; ')];
 });
 const first={name:'HR sheet checked',title,plainSerial:true,freezeColumns:4,fills:HR_FILLS,cellFills,
  headerRows:[title+(fileName?' · file: '+fileName:'')+(bioLabel?' · biometric: '+bioLabel:'')+(checkedAt?' · checked '+checkedAt:''),...HR_LEGEND.map(([,line])=>line)],
  headerFills:Object.fromEntries(HR_LEGEND.map(([fill],i)=>[i+1,fill])),
  columns:['Row in sheet','SR NO','EMP. ID','NAME','Name in Pulse-II','DESIGNATION',...dates.compared.map(d=>d.slice(8,10)+'-'+d.slice(5,7)),'P days in sheet','Days punched','P and punched','Mismatches','ID / name'].map(label=>({label})),rows:grid};
 const list={name:'Mismatches',title:site+' · Mismatches · '+period,plainSerial:true,fills:HR_FILLS,cellFills:lines.map(l=>({5:l.kind})),
  columns:['Date','Row in sheet','EMP. ID','Name','Designation','Mismatch','HR sheet','Punch IN','Punch OUT','Punch site','Biometric source','HR correction','Trip card'].map(label=>({label})),
  rows:lines.map(l=>[dmy(l.date),String(l.row),l.empId,l.name,l.designation,hrKindLabel(l.kind),l.mark||'(blank)',l.inTime,l.outTime,l.punchSite,l.source,l.hrCorrection,l.card])};
 const ids={name:'ID and name',title:site+' · EMP. ID and name to correct',plainSerial:true,
  columns:['Row in sheet','EMP. ID','Name in sheet','Name in Pulse-II','Designation','Problem','Sheet says','Pulse-II says'].map(label=>({label})),
  rows:issues.map(i=>[String(i.row),i.id,i.name,i.pulseName,i.designation,i.label,i.sheetSays,i.pulseSays])};
 const others={name:'Punched, not in sheet',title:site+' · Punched at this site, not in the HR sheet · '+period,plainSerial:true,
  columns:['EMP. ID','Name in Pulse-II','Designation','Days punched','Dates'].map(label=>({label})),
  rows:notInSheet.map(p=>[p.id,p.name,p.designation,String(p.days),p.datesLabel])};
 const summary={name:'Summary',title:site+' · Summary · '+period,plainSerial:true,columns:['Check','Count','Note'].map(label=>({label})),rows:[
  ['Employees in the HR sheet',String(totals.people),'Everyone is compared: staff, helpers and supervisors too.'],
  ['Found in Employee Master',String(totals.known),''],
  ['Dates compared',String(dates.compared.length),period],
  ['P days in the HR sheet',String(totals.sheetP),''],
  ['Days punched at this site',String(totals.punched),''],
  ['P and punched (same in both)',String(totals.same),''],
  ...HR_KINDS.map(k=>['· '+k.label,String(counts[k.key]),'']),
  ['EMP. ID or name to correct',String(totals.issues),'Listed on the sheet "ID and name".'],
  ['Punched at this site, not in the HR sheet (people)',String(totals.notInSheet),'Listed on the sheet "Punched, not in sheet".'],
  ['Marks not understood (not compared)',String(totals.skipped),''],
 ]};
 return {title,sheets:[first,list,ids,others,summary]};
}
