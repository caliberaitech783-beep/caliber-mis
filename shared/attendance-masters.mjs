// VTC Master and OD Master (owner, 28 Nov 2026: "I need the VTC master for Driver and Operator ... it should have all
// details of driver/operator who has done the vtc or doing vtc in that month ... his attendance should mark as present
// for those days. it should fetch directly in his attendance muster", then "Yes, build both" for VTC and OD).
//
// One record is one person on one VTC course or one OD, From date to To date, at a site of the login. Every day of it
// that has arrived (up to today, India) is present: the record writes one entry per day into mis_shift_attendance with
// the reason VTC_TRAINING_REASON or OD_REASON in TRAINING_SHIFT (shared/vtc-training.mjs), so Attendance Batch-wise /
// Month-wise, the HR feed (HR Pulse's muster) and the sheet checks count it as they count VTC Training. A VTC still
// running may end after today; each later day is written on its own date (server/routes/attendance-masters.mjs).
// A day on which the person also has a card counts once, as that duty (server/rules/manpower-report.mjs).
import {VTC_TRAINING_REASON,OD_REASON,indiaToday} from './vtc-training.mjs';

export const MASTER_KINDS={
 vtc:{key:'vtc',title:'VTC Master',short:'VTC',reason:VTC_TRAINING_REASON,mark:'P',colour:'Purple'},
 od:{key:'od',title:'OD Master',short:'OD',reason:OD_REASON,mark:'OD',colour:'Teal'},
};
export const masterKindOf=reason=>Object.values(MASTER_KINDS).find(kind=>kind.reason===String(reason??'').trim())||null;
export const VTC_COURSES=['HEMM operator (Dumper)','HEMM operator (Shovel / Excavator)','HEMM operator (Dozer / Grader)','Drill operator','Heavy vehicle driver','Light vehicle driver','Refresher','Other'];
export const VTC_STATUSES=['Ongoing','Completed','Left midway'];
export const OD_TYPES=['Office / HO work','Medical exam (PME)','Court / police','DGMS / statutory','Work at another site','Meeting / other training','Other'];
export const OD_DAY_PARTS=['Full day','Half day (first half)','Half day (second half)'];
export const MASTER_START='2026-11-01';
// A VTC course runs at most 92 days, an OD 31; either may be entered up to 60 days ahead (a planned course or OD).
export const MASTER_MAX_DAYS={vtc:92,od:31};
export const MASTER_AHEAD_DAYS=60;
export const MASTER_MAX_PEOPLE=100;

const ISO=/^\d{4}-\d{2}-\d{2}$/;
const text=value=>String(value??'').trim();
export const realDate=d=>ISO.test(String(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
export const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const daySpan=(from,to)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000)+1;
export function daysBetween(from,to){const days=[];for(let d=from;d<=to;d=addDays(d,1))days.push(d);return days;}
const pick=(value,list)=>list.includes(text(value))?text(value):'';
const field=(value,max=200)=>text(value).slice(0,max);

// The record as sent by the screen, checked: {error} or {kind,from,to,details}. details holds the master's own fields.
export function checkMasterEntry(kind,body={},{today=indiaToday()}={}){
 const info=MASTER_KINDS[kind];
 if(!info)return {error:'Choose VTC or OD.'};
 const from=text(body.fromDate),to=text(body.toDate);
 if(!realDate(from)||!realDate(to))return {error:'Select the From and To dates.'};
 if(to<from)return {error:'To date cannot be before From date.'};
 if(from<MASTER_START)return {error:'Operations start on 1 November 2026. Earlier dates are locked for all users.'};
 if(to>addDays(today,MASTER_AHEAD_DAYS))return {error:`Dates can be entered up to ${MASTER_AHEAD_DAYS} days ahead.`};
 if(daySpan(from,to)>MASTER_MAX_DAYS[kind])return {error:`${info.short} can cover up to ${MASTER_MAX_DAYS[kind]} days.`};
 let details;
 if(kind==='vtc'){
  const course=pick(body.course,VTC_COURSES),status=pick(body.status,VTC_STATUSES)||'Ongoing';
  details={course,courseOther:course==='Other'?field(body.courseOther):'',institute:field(body.institute),trainer:field(body.trainer),
   certificate:field(body.certificate,100),status,remarks:field(body.remarks,1000)};
  if(!course)return {error:'Choose the VTC course.'};
  if(course==='Other'&&!details.courseOther)return {error:'Write the name of the course.'};
  if(!details.institute)return {error:'Write the institute or place of the VTC.'};
  if(status==='Completed'&&to>today)return {error:'A course that ends after today cannot be Completed yet. Keep it Ongoing.'};
  if(status==='Left midway'&&to>today)return {error:'For Left midway, set To date to the last day the person attended.'};
 }else{
  const type=pick(body.odType,OD_TYPES),dayPart=pick(body.dayPart,OD_DAY_PARTS)||'Full day';
  details={odType:type,typeOther:type==='Other'?field(body.typeOther):'',dayPart,place:field(body.place),sentBy:field(body.sentBy),reason:field(body.reason,1000)};
  if(!type)return {error:'Choose the OD type.'};
  if(type==='Other'&&!details.typeOther)return {error:'Write what the OD is for.'};
  if(!details.place)return {error:'Write the place of the OD.'};
  if(details.reason.length<5)return {error:'Write the reason for the OD.'};
  if(dayPart!=='Full day'&&from!==to)return {error:'A half-day OD is one day: set To date the same as From date.'};
 }
 return {kind,from,to,details};
}

// What the attendance entry of a day says (mis_shift_attendance remarks): the master, its course or type and place.
export function masterRemarks(kind,details={}){
 if(kind==='vtc')return ['VTC Master',details.course==='Other'?details.courseOther:details.course,details.institute,details.status].filter(Boolean).join(' · ').slice(0,2000);
 return ['OD Master',details.odType==='Other'?details.typeOther:details.odType,details.dayPart!=='Full day'?details.dayPart:'',details.place,details.reason].filter(Boolean).join(' · ').slice(0,2000);
}
// The days of a record that count present by today: From to the earlier of To and today.
export function arrivedDays(record,today=indiaToday()){
 const last=record.to<today?record.to:today;
 return record.from>last?[]:daysBetween(record.from,last);
}
// Whether two records of one person share a day.
export const overlaps=(a,b)=>a.from<=b.to&&b.from<=a.to;

// The month (YYYY-MM) as a range.
export function monthRange(month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month)))return null;
 const from=month+'-01',next=month.slice(5)==='12'?(Number(month.slice(0,4))+1)+'-01-01':month.slice(0,5)+String(Number(month.slice(5))+1).padStart(2,'0')+'-01';
 return {from,to:addDays(next,-1)};
}
// A record's place in a month: its days there, the days present so far, and the days still to come.
export function monthView(record,month,today=indiaToday()){
 const range=monthRange(month);if(!range)return {days:[],present:0,coming:0};
 const from=record.from>range.from?record.from:range.from,to=record.to<range.to?record.to:range.to;
 const days=from>to?[]:daysBetween(from,to);
 const present=days.filter(d=>d<=today).length;
 return {days,present,coming:days.length-present};
}
// The status shown on a line: a VTC as saved, Ongoing turning Completed by itself once To date has passed; an OD
// Planned, Running or Done.
export function masterStatus(record,today=indiaToday()){
 if(record.kind==='vtc'){const saved=record.details?.status||'Ongoing';return saved==='Ongoing'&&record.to<today?'Completed':saved==='Ongoing'&&record.from>today?'Planned':saved;}
 return record.from>today?'Planned':record.to<today?'Done':'Running';
}
// Step 1 of a month: one line per site with the people, the ongoing / completed (VTC) or full / half day (OD), drivers,
// operators and the present days so far; and the All sites line.
export function siteSummary(records,month,{today=indiaToday(),isDriver=()=>false}={}){
 const sites=new Map();
 const blank=(key,site)=>({key,site,people:new Set(),entries:0,ongoing:0,completed:0,half:0,drivers:new Set(),operators:new Set(),present:0,coming:0});
 const all=blank('*','All sites');all.total=true;
 for(const record of records){
  const view=monthView(record,month,today);if(!view.days.length)continue;
  const line=sites.get(record.siteKey)||sites.set(record.siteKey,blank(record.siteKey,record.site)).get(record.siteKey);
  for(const one of [line,all]){
   one.people.add(record.employeeId);one.entries++;one.present+=view.present;one.coming+=view.coming;
   const status=masterStatus(record,today);
   if(['Ongoing','Running','Planned'].includes(status))one.ongoing++;else one.completed++;
   if(record.kind==='od'&&record.details?.dayPart&&record.details.dayPart!=='Full day')one.half++;
   (isDriver(record)?one.drivers:one.operators).add(record.employeeId);
  }
 }
 const done=line=>({...line,people:line.people.size,drivers:line.drivers.size,operators:line.operators.size});
 return {sites:[...sites.values()].map(done).sort((a,b)=>a.site.localeCompare(b.site)),total:done(all)};
}
