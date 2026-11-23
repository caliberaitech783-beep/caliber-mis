// Trip Card vs Bio-punch (owner, 24 Nov 2026): Reports > Manpower & OT, beside Site Sheet vs Trip Card. The difference
// between the trip cards of a site and the biometric punches Pulse-II already holds (machine direct from HR Pulse and
// the device files imported on Attendance Management), for a log book (VLB / ELB / LMV), a batch and From / To.
// The screen is src/trip-card-biopunch.jsx. Kept apart from the screen so it runs in a test without a browser.
//
// Pulse-II is read once for the dates; the log book, the batch and any dates inside the ones read change the view at
// once. Every trip card attendance is judged against the punches (shared/trip-card-attendance.mjs): the OK ones are
// counted, the ones that need attention listed. The other way (a punch with no trip card) comes from the check
// Attendance Sheet Mismatch already runs (shared/trip-biometric-check.mjs).
import {tripBiometricCheck,tripBiometricWorkbook,MAX_DAYS} from '../shared/trip-biometric-check.mjs';
import {batchChoices,cardAttendances,cardSheets,cardSummary,judgeCards,logBookCounts,punchDays,selectCards,SOURCES} from '../shared/trip-card-attendance.mjs';
import {lineNumber,dmy} from '../shared/attendance-sheet-check.mjs';
import {sheetFromFile,personDays,dateRows,dateTotals,pulseSheet,dateSheet,differenceSheet,DAY_DIFFERENCES} from '../shared/three-way-attendance.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {OPERATIONAL_START} from '../shared/operational-start.mjs';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
import {formatDisplayDateTime} from '../shared/date-time-format.mjs';
import {sheetApi,todayIst} from './attendance-sheet-run.mjs';

export {MAX_DAYS};
const DAY=86400000;
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
export const spanDays=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/DAY)+1;
// The dates first offered: the 1st of this month (not before 1 Nov 2026) to yesterday.
export function defaultRange(today=todayIst()){
 const to=addDays(today,-1)<OPERATIONAL_START?today:addDays(today,-1);
 const first=to.slice(0,8)+'01';
 return {from:first<OPERATIONAL_START?OPERATIONAL_START:first,to};
}
export function rangeProblem(from,to,today=todayIst()){
 if(!from||!to)return 'Select From and To.';
 if(to<from)return 'To is before From.';
 if(from<OPERATIONAL_START)return 'Pulse-II holds attendance from '+dmy(OPERATIONAL_START)+'.';
 if(to>today)return 'To cannot be after today.';
 if(spanDays(from,to)>MAX_DAYS)return `Select up to ${MAX_DAYS} days.`;
 return '';
}

// Reads Pulse-II once: trip card attendance, the punches and Employee Master. Returns {site, from, to, attendance, biometric, master}.
// sheet: your attendance Excel (parseAttendanceSheet) or null; its people are asked too.
export async function readBioPunchData({site,from,to,session,sheet=null,read=sheetApi}){
 const sheetNumbers=(sheet?.people||[]).map(p=>p.number).filter(Boolean);
 const attendance=await read('/api/reports/manpower/attendance?'+new URLSearchParams({from,to,view:'attendance'}),session);
 const lines=[...(attendance.otDuties||[]),...(attendance.attendanceEquipment||[])];
 const siteKey=canonicalSiteName(site);
 const onCards=[...new Set(lines.filter(l=>canonicalSiteName(l.siteKey||l.site)===siteKey).map(lineNumber).filter(Boolean))];
 const biometric=await read('/api/reports/manpower/attendance-sheet/biometric',session,{method:'POST',body:JSON.stringify({site,from,to,source:'both',numbers:[...new Set([...onCards,...sheetNumbers])].slice(0,5000)})});
 if(!biometric.machine?.connected&&biometric.machine?.asked&&!biometric.imported?.asked)throw Error(biometric.machine.error||'The machine punches could not be read.');
 const numbers=[...new Set([...sheetNumbers,...(biometric.days||[]).map(d=>d.caliberCode),...lines.map(lineNumber).filter(Boolean)])];
 const master=numbers.length?await read('/api/reports/manpower/attendance-sheet/people',session,{method:'POST',body:JSON.stringify({site,ids:numbers.slice(0,5000)})}):{site,people:[]};
 return {site:master.site||site,from,to,attendance,biometric,master};
}

// What the screen shows for a selection inside the dates read.
// sheet: your attendance Excel (parseAttendanceSheet) or null: then every card is also judged against it, and the
// date-wise table and the person-days set your sheet, the trip card and the bio-punch side by side.
export function bioPunchView({data,sheet=null,from='',to='',logBook='',batch='',today=todayIst()}){
 const lo=from&&from>data.from?from:data.from,hi=to&&to<data.to?to:data.to;
 const {attendance,biometric,master,site}=data;
 const lines=[...(attendance.otDuties||[]),...(attendance.attendanceEquipment||[])];
 const days=(biometric.days||[]).filter(d=>d.date>=lo&&d.date<=hi);
 const result=tripBiometricCheck({days,lines,lockedDays:attendance.lockedDays||[],people:master.people||[],site,from:lo,to:hi});
 const cards=cardAttendances(lines,{site,from:lo,to:hi});
 const mine=sheet?sheetFromFile(sheet):null,punches=punchDays(days,site),chosen=selectCards(cards,{logBook,batch});
 const judged=judgeCards(chosen,{punches,sheet:mine});
 const summary=cardSummary(judged);
 const siteKey=canonicalSiteName(site),locked=new Set((attendance.lockedDays||[]).filter(k=>canonicalSiteName(k.slice(0,k.lastIndexOf('|')))===siteKey).map(k=>k.slice(k.lastIndexOf('|')+1)));
 const dates=[];for(let d=lo;d<=hi&&d<=today;d=addDays(d,1))dates.push(d);
 const pending=dates.filter(d=>!locked.has(d));
 // The other way: punched here on a locked date, no trip card, log book or zero-trip entry. It has no card, so no log
 // book or batch: it is listed under All log books only.
 const punchOnly=logBook||batch?[]:result.findings.filter(f=>f.type==='no-trip-card');
 const otherWay={shift:result.findings.filter(f=>f.type==='shift-mismatch').length};
 const lockedSet=new Set(dates.filter(d=>locked.has(d)));
 const personLines=personDays({cards:chosen,sheet:mine,punches,people:master.people||[],dates,locked:lockedSet,all:!logBook&&!batch});
 const days_=dateRows({lines:personLines,cards:chosen,sheet:mine,dates,locked:lockedSet});
 return {site,from:lo,to:hi,logBook,batch,result,cards,judged,summary,punchOnly,otherWay,dates,pending,lockedDates:dates.length-pending.length,
  logBooks:logBookCounts(cards),batches:batchChoices(cards,logBook),biometric,sheet:mine,sheetFile:sheet,lines:personLines,dateRows:days_,dateTotal:dateTotals(days_),locked:lockedSet};
}

// The summary table, in the order of the Site Sheet vs Trip Card counts: what was compared, how the attendance came in,
// then each difference.
export function bioPunchSummary(view){
 const {summary:s,result:r}=view,all=!view.logBook&&!view.batch;
 const choice=[view.logBook||'All log books',view.batch?'batch '+view.batch:''].filter(Boolean).join(' · ');
 return [
  {id:'dates',label:'Dates selected',value:view.dates.length,note:dmy(view.from)+' to '+dmy(view.to)},
  {id:'locked',label:'Dates compared (locked in Pulse-II)',value:view.lockedDates,note:'Only locked days carry trip card attendance.'},
  {id:'pending',label:'Dates not locked in Pulse-II yet',value:view.pending.length,note:view.pending.map(dmy).join(', ')},
  {id:'cards',label:'Trip card attendances ('+choice+')',value:s.total,note:s.people+' people · one per person per shift'},
  ...SOURCES.filter(x=>x.key!=='scanned+manual'||s.sources[x.key]).map(x=>({id:'src-'+x.key,label:x.label,value:s.sources[x.key],note:x.key==='zero-trip'?'Present with 0 trips, saved without a trip card.':''})),
  {id:'withBio',label:'Attendance with biometric (IN and OUT at this site)',value:s.fullPunch,note:'Trip card and bio-punch agree.',tone:'ok'},
  ...(view.sheet?[
   {id:'sheetPeople',label:'Employees in your sheet',value:view.sheet.people.size,note:view.sheetFile?.sheetName?'Sheet "'+view.sheetFile.sheetName+'"':''},
   {id:'sheetP',label:'Your sheet P (drivers and operators, person-days)',value:view.dateTotal.sheetP,note:'Dates of your sheet inside '+dmy(view.from)+' to '+dmy(view.to)+'.'},
   {id:'agree3',label:'All three agree (your sheet P, trip card, bio-punch IN and OUT)',value:view.dateTotal.agree,note:'Person-days.',tone:'ok'},
   ...DAY_DIFFERENCES.filter(d=>d.key.startsWith('sheet')||d.key==='cardNotP'||d.key==='cardNotInSheet').map(d=>({id:'d-'+d.key,label:d.label,value:d.needsAll&&!all?'—':view.dateTotal[d.key],note:'Person-days'+(d.needsAll&&!all?' · has no card, so no log book: see All log books.':'.'),tone:'bad'})),
  ]:[]),
  {id:'ok',label:'OK · need no attention',value:s.ok,note:'',tone:'ok'},
  {id:'attention',label:'Need attention',value:s.attention,note:s.peopleAttention+' people',tone:'bad'},
  {id:'no-punch',label:'Trip card, no bio-punch',value:s.issues['no-punch'],tone:'bad'},
  {id:'miss-punch',label:'Trip card, miss punch (IN or OUT missing)',value:s.issues['miss-punch'],tone:'bad'},
  {id:'punch-other-site',label:'Trip card here, bio-punch at another site',value:s.issues['punch-other-site'],tone:'bad'},
  {id:'no-trip-card',label:'Bio-punch, no trip card',value:all?r.counts['no-trip-card']:'—',note:all?'Punched here on a locked date; no trip card, log book or zero-trip entry.':'Has no card, so no log book: see All log books.',tone:'bad'},
  {id:'shift-mismatch',label:'Bio-punch in another shift than the trip card',value:r.counts['shift-mismatch'],note:'All log books.'},
  {id:'people',label:'Drivers and operators compared',value:r.totals.people,note:'Employee Master designation is a driver or operator, or the person is on a trip card here.'},
  {id:'otherStaff',label:'Other staff on the biometric (not compared)',value:r.otherStaff,note:'Helpers, supervisors, mechanics and staff keep no trip card.'},
  {id:'notInMaster',label:'Biometric numbers not in Employee Master',value:r.notInMaster.length,note:r.notInMaster.slice(0,30).join(', ')},
 ].map(x=>({note:'',tone:'',...x}));
}

export function bioPunchWorkbook(view,{build=buildXlsxSheetsWorkbook,checkedAt=formatDisplayDateTime(new Date())}={}){
 const choice=[view.logBook||'All log books',view.batch?'batch '+view.batch:''].filter(Boolean).join(' · ');
 const title=view.site+' · Trip card vs bio-punch · '+choice+' · '+dmy(view.from)+' to '+dmy(view.to);
 const summary={name:'Summary',title,plainSerial:true,headerRows:[title+' · checked '+checkedAt,'Biometric: machine direct (HR Pulse) and imported on Attendance Management.'],
  columns:['Check','Count','Note'].map(label=>({label})),rows:bioPunchSummary(view).map(x=>[x.label,String(x.value),x.note])};
 const other=tripBiometricWorkbook(view.result,{fileName:'biometric: machine direct + imported',checkedAt});
 const three=view.site+' · '+(view.sheet?'your sheet vs trip card vs bio-punch':'trip card vs bio-punch')+' · '+choice+' · '+dmy(view.from)+' to '+dmy(view.to);
 const sheets=[summary,dateSheet(view.dateRows,{sheet:view.sheet,title:three+' · date-wise'}),
  pulseSheet({lines:view.lines,sheet:view.sheet,dates:view.dates,locked:view.locked,title:view.site+' · the sheet Pulse-II would have written · '+choice+' · '+dmy(view.from)+' to '+dmy(view.to)}),
  differenceSheet(view.lines,{title:three+' · every person-day that differs',sheet:view.sheet}),
  ...cardSheets(view.judged,{title:view.site+' · '+choice,withBio:true,withSheet:Boolean(view.sheet)}),
  {...other.sheets[0],name:'Every difference'},other.sheets[1]];
 const slug=value=>String(value).replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'');
 const tag=slug([view.logBook,view.batch].filter(Boolean).join('-'));
 return {title,blob:build(title,sheets),name:`Trip-card-vs-bio-punch-${slug(view.site)}${tag?'-'+tag:''}-${view.from}-to-${view.to}.xlsx`};
}
