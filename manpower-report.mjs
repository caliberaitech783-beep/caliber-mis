import {canonicalSiteName} from './site-location.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';
import {employeeIdentity,matchesEmployeeReference,suggestedCaliberId} from './employee-identity.mjs';
import {bookShiftCode,selectedMasterShift} from './trip-card-rules.mjs';
import {operationalDate,OPERATIONAL_START} from './operational-start.mjs';

const text=v=>String(v??'').trim();
const key=v=>text(v).toUpperCase().replace(/[\s/-]/g,'');
const unique=values=>[...new Set(values.filter(v=>v!==''&&v!=null))];
const round=n=>Math.round(n*1000)/1000;
const number=v=>v==null||text(v)===''||!Number.isFinite(Number(v))?null:Number(v);
const sum=values=>values.length&&values.every(v=>v!==null)?round(values.reduce((a,b)=>a+b,0)):null;
const group=(rows,identity)=>{const out=new Map();for(const row of rows){const k=identity(row);if(!out.has(k))out.set(k,[]);out.get(k).push(row);}return [...out.values()];};
export const nextReportDate=(date,days=1)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
export function manpowerFilters(query={}){
 const {from,to}=query;
 if(!operationalDate(from)||!operationalDate(to)||to<from||Date.parse(to)-Date.parse(from)>30*86400000)throw Object.assign(new Error('Choose dates on or after 1 November 2026, covering at most 31 days.'),{status:400});
 const result={from,to};for(const name of ['site','shift','batch','employee','asset']){if(query[name]!=null&&(typeof query[name]!=='string'||query[name].length>200))throw Object.assign(new Error('Invalid report filter.'),{status:400});result[name]=text(query[name]);}
 return {...result,contextFrom:from===OPERATIONAL_START?from:nextReportDate(from,-1),contextTo:nextReportDate(to)};
}
function shiftWindow(shifts,site,date,code){
 const shift=selectedMasterShift(shifts,site,code,date);if(!shift)return null;
 const clock=value=>{const m=text(value).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);return m&&+m[1]<24&&+m[2]<60&&+(m[3]||0)<60?`${m[1].padStart(2,'0')}:${m[2]}:${m[3]||'00'}`:null;};
 const a=clock(shift.startTime||shift.start),b=clock(shift.endTime||shift.end);if(!a||!b||a===b)return null;
 const start=Date.parse(`${date}T${a}+05:30`),end=Date.parse(`${b<a?nextReportDate(date):date}T${b}+05:30`);
 return {start,end,hours:(end-start)/3600000,startLabel:`${date} ${a.slice(0,5)}`,endLabel:`${b<a?nextReportDate(date):date} ${b.slice(0,5)}`};
}
function identityIndex(employees){
 const byId=new Map(),aliases=new Map(),caliberMappings=new Map();
 for(const e of employees){const identity=employeeIdentity(e),employeeId=text(identity.employeeId||e.empId||e.employeeCode),caliberCode=text(identity.caliberCode),identityKey=key(suggestedCaliberId(employeeId)||employeeId||caliberCode);
  if(!caliberMappings.has(identityKey))caliberMappings.set(identityKey,new Set());if(caliberCode)caliberMappings.get(identityKey).add(key(caliberCode));
  const person={id:String(e.id),employeeId,caliberCode,name:text(e.name||e.employee||e.login),identityKey};byId.set(String(e.id),{...person,source:e});
  for(const token of unique([employeeId,caliberCode,e.empId,e.employeeCode].map(key))){if(!aliases.has(token))aliases.set(token,new Set());aliases.get(token).add(identityKey);}
 }
 return data=>{
  let person=byId.get(String(data.employeeId));
  if(!person&&data.caliberId){const matches=[...byId.values()].filter(p=>matchesEmployeeReference(p.source,data.caliberId));if(unique(matches.map(p=>p.identityKey)).length===1)person=matches[0];}
  if(!person?.identityKey||!person.name)return {error:'Employee ID is missing or cannot be resolved to an employee master.'};
  if(data.caliberId&&!matchesEmployeeReference(person.source,data.caliberId))return {error:'Saved Employee ID conflicts with the linked employee master.'};
  if(caliberMappings.get(person.identityKey)?.size>1||[person.employeeId,person.caliberCode].some(token=>(aliases.get(key(token))?.size||0)>1))return {error:'Employee / Caliber ID mapping is ambiguous.'};
  return person;
 };
}
const meter=(data,kind)=>{const a=number(data['opening'+kind]),b=number(data['closing'+kind]);return a!==null&&b!==null&&a>=0&&b>=a?round(b-a):null;};
const sourceLabel=r=>r.batchNames.join('; ')||`Saved ${r.kind==='vehicle'?'VLB':'ELB'} (no site batch)`;
const rowMatches=(r,f,{dates=true}={})=>(!dates||r.date>=f.from&&r.date<=f.to)&&(!f.site||canonicalSiteName(r.site)===canonicalSiteName(f.site))&&(!f.shift||r.shift===f.shift)&&(!f.batch||r.batchIds.includes(f.batch))&&(!f.employee||r.employeeKey===f.employee)&&(!f.asset||r.assetKey===f.asset);

export function buildManpowerReport({records=[],assets=[],employees=[],shifts=[],batches=[],filters}){
 const f=manpowerFilters(filters),exceptions=[],rows=[],resolveEmployee=identityIndex(employees),assetMap=new Map(assets.map(a=>[String(a.id),a]));
 const addIssue=(r,reason)=>{r.issues.push(reason);exceptions.push({id:`${r.id}:${r.issues.length}`,date:r.date,site:r.site,shift:r.shift,door:r.door,employeeId:r.employeeId||r.savedEmployeeId,employeeName:r.employeeName,book:r.book,batches:sourceLabel(r),reason,record:r});};
 const assetDoors=new Map();
 for(const asset of assets){const door=key(asset.door||asset.doorNo||equipmentDoorNumber(asset)),site=canonicalSiteName(asset.currentLocation||asset.site||asset.location);if(!door||!site)continue;const identity=site+'|'+door;if(!assetDoors.has(identity))assetDoors.set(identity,new Set());assetDoors.get(identity).add(String(asset.id));}
 const seenIds=new Set();
 for(const record of records){
  const d=record.data||{},date=record.book_date||d.bookDate,site=record.site||d.location;
  if(record.deleted_at||!operationalDate(date)||date<f.contextFrom||date>f.contextTo)continue;
  const r={id:String(record.id),book:record.book_no,date,site,kind:record.book_type,shift:bookShiftCode(d.bookShiftCode||d.cardShift||d.shiftName),door:text(d.door),savedEmployeeId:text(d.caliberId),employeeId:'',employeeName:text(d.employeeName),employeeKey:'',caliberCode:'',assetKey:'',category:'Unresolved category',group:'Unresolved group',make:'Unresolved make',model:'Unresolved model',batchIds:(record.batches||[]).map(b=>String(b.id)),batchNames:(record.batches||[]).map(b=>b.name),batchStatus:unique((record.batches||[]).map(b=>b.closed_at?'Closed':'Open')).join('; '),issues:[],data:d,performanceValid:true,eligible:true};
  if(!r.batchIds.length&&d.scanBatchId){r.batchIds=[String(d.scanBatchId)];r.batchNames=[record.scan_batch_name||String(d.scanBatchId)];r.batchStatus='Saved scan';}
  if(seenIds.has(r.id)){addIssue(r,'Repeated saved record omitted from totals.');continue;}seenIds.add(r.id);
  if(date!==d.bookDate||canonicalSiteName(site)!==canonicalSiteName(d.location)){r.eligible=false;addIssue(r,'Saved date/site metadata conflicts with the logbook; excluded from totals.');}
  const person=resolveEmployee(d);if(person.error)addIssue(r,person.error);else Object.assign(r,{employeeId:person.employeeId,employeeName:person.name,caliberCode:person.caliberCode,employeeKey:person.identityKey});
  const asset=assetMap.get(String(record.asset_id||d.assetId));
  if(!asset)addIssue(r,'Equipment master match is missing.');
  else{
   const door=text(asset.door||asset.doorNo||equipmentDoorNumber(asset));r.door=r.door||door;
   if(!door)addIssue(r,'Door / equipment identity is missing.');
   else if((assetDoors.get(canonicalSiteName(site)+'|'+key(door))?.size||0)>1)addIssue(r,'Door identity matches multiple equipment master records; asset count requires review.');
   else r.assetKey=canonicalSiteName(site)+'|'+key(door);
   for(const [field,value] of Object.entries({category:asset.category||asset.equipmentCategory,group:asset.group||asset.equipmentGroup||asset.itemName,make:asset.makeName||asset.make,model:asset.modelName||asset.model||asset.modelNo})){
    if(!text(value)){addIssue(r,`${field[0].toUpperCase()+field.slice(1)} is missing in Equipment master.`);continue;}
    r[field]=/^\d+$/.test(text(value))&&['make','model'].includes(field)?`Unresolved ${field} code ${value}`:text(value);
    if(r[field].startsWith('Unresolved '))addIssue(r,`${field[0].toUpperCase()+field.slice(1)} code ${value} has no name mapping.`);
   }
  }
  const savedShift=shifts.find(s=>String(s.id)===String(d.shiftId));
  const codes=unique([d.bookShiftCode,d.cardShift,d.shiftName,savedShift?.shiftCode||savedShift?.shiftName].map(bookShiftCode));
  if(codes.length>1){r.shift='';r.eligible=false;addIssue(r,'Saved shift labels conflict; excluded from duty totals.');}else r.shift=codes[0]||'';
  r.schedule=shiftWindow(shifts,site,date,r.shift);
  if(!r.schedule)addIssue(r,'Effective site shift schedule is missing or ambiguous; timing requires review.');
  else if(d.masterShiftStart&&text(d.masterShiftStart).slice(0,5)!==r.schedule.startLabel.slice(-5))addIssue(r,'Saved shift start differs from the effective Shift Master; timing requires review.');
  r.hours=meter(d,'Hmr');r.km=r.kind==='vehicle'?meter(d,'Kmr'):null;r.trips=r.kind==='vehicle'?number(d.completedTrips??d.totalTrips):null;
  if(r.hours===null||r.schedule&&r.hours>r.schedule.hours){r.performanceValid=false;addIssue(r,'Invalid or excessive HMR hours; performance totals unavailable.');}
  if(r.kind==='vehicle'&&(r.km===null||r.trips===null||r.trips<0)){r.performanceValid=false;addIssue(r,'Missing or invalid kilometre / completed-trip values; performance totals unavailable.');}
  rows.push(r);
 }
 // A second image or card number is not a second duty. Identical measurements
 // are conservative duplicate candidates; conflicting overlaps require review.
 const deduped=[],fingerprints=new Map(),scanIds=new Map();
 for(const r of rows){const d=r.data,fingerprint=JSON.stringify([canonicalSiteName(r.site),r.date,r.shift,r.assetKey||d.assetId,r.employeeKey||d.employeeId,number(d.openingHmr),number(d.closingHmr),number(d.openingKmr),number(d.closingKmr),r.trips,(d.trips||[]).map(t=>[text(t.equipmentId||t.equipmentName),number(t.tripCount),text(t.loadingTime),text(t.unloadingTime)])]);
  const prior=(d.scanCardId&&scanIds.get(String(d.scanCardId)))||fingerprints.get(fingerprint);
  if(prior){addIssue(r,'Possible repeated scan/card omitted from totals; compare the source cards.');if(d.scanCardId&&fingerprint!==prior.fingerprint){prior.performanceValid=false;addIssue(prior,'Conflicting saved copies of the same scan; performance totals unavailable.');}continue;}
  r.fingerprint=fingerprint;fingerprints.set(fingerprint,r);if(d.scanCardId)scanIds.set(String(d.scanCardId),r);deduped.push(r);
 }
 for(const sameAsset of group(deduped.filter(r=>r.assetKey&&r.shift),r=>JSON.stringify([r.date,canonicalSiteName(r.site),r.shift,r.assetKey]))){
  for(let i=0;i<sameAsset.length;i++)for(let j=i+1;j<sameAsset.length;j++){const a=sameAsset[i],b=sameAsset[j];if(a.hours>0&&b.hours>0&&Math.max(Number(a.data.openingHmr),Number(b.data.openingHmr))<Math.min(Number(a.data.closingHmr),Number(b.data.closingHmr))){for(const r of [a,b])if(r.performanceValid){r.performanceValid=false;addIssue(r,'Overlapping HMR intervals on this asset/shift; performance totals unavailable.');}}}
 }
 const duties=group(deduped.filter(r=>r.eligible&&r.employeeKey&&r.shift),r=>JSON.stringify([r.employeeKey,canonicalSiteName(r.site),r.date,r.shift])).map(cards=>{
  const r=cards[0],hours=sum(cards.map(c=>c.performanceValid?c.hours:null));
  const issue=hours!==null&&r.schedule&&hours>r.schedule.hours;
  if(issue)for(const card of cards)addIssue(card,'Combined card HMR exceeds this duty’s scheduled hours; review assignments.');
  return {key:JSON.stringify([r.employeeKey,canonicalSiteName(r.site),r.date,r.shift]),date:r.date,site:r.site,shift:r.shift,employeeKey:r.employeeKey,employeeId:r.employeeId,caliberCode:r.caliberCode,employeeName:r.employeeName,schedule:cards.some(c=>c.issues.some(s=>/shift start differs/.test(s)))?null:r.schedule,cards,hours:issue?null:hours,trips:sum(cards.filter(c=>c.kind==='vehicle').map(c=>c.performanceValid?c.trips:null)),km:sum(cards.filter(c=>c.kind==='vehicle').map(c=>c.performanceValid?c.km:null))};
 });
 const selected=deduped.filter(r=>rowMatches(r,f));
 const details=selected.map(r=>({id:r.id,date:r.date,site:r.site,shift:r.shift||'Unresolved',door:r.door,category:r.category,group:r.group,make:r.make,model:r.model,employeeId:r.employeeId||r.savedEmployeeId,caliberCode:r.caliberCode,employeeName:r.employeeName,assignment:!r.eligible?'Needs record review':r.employeeKey?'Matched employee ID':'Needs identity review',book:r.book,batches:sourceLabel(r),batchStatus:r.batchStatus||'Saved',remarks:unique([...r.issues,text(r.data.remark)]).join('; ')}));
 const summary=group(selected.filter(r=>r.eligible&&r.assetKey),r=>JSON.stringify([r.date,canonicalSiteName(r.site),r.shift,r.category,r.group,r.make,r.model])).map(cards=>{const r=cards[0];return {date:r.date,site:r.site,shift:r.shift,category:r.category,group:r.group,make:r.make,model:r.model,assets:unique(cards.map(c=>c.assetKey)).length,employees:unique(cards.map(c=>c.employeeKey)).length,unresolved:cards.filter(c=>!c.employeeKey).length,doors:unique(cards.map(c=>c.door)).join('; '),batches:unique(cards.flatMap(c=>c.batchNames)).join('; ')};});
 const performance=duties.filter(d=>d.cards.some(r=>rowMatches(r,f))).map(d=>({id:d.key,date:d.date,site:d.site,shift:d.shift,employeeId:d.employeeId,caliberCode:d.caliberCode,employeeName:d.employeeName,doors:unique(d.cards.map(r=>r.door)).join('; '),equipment:unique(d.cards.map(r=>`${r.door}: ${r.group} / ${r.make} / ${r.model}`)).join('; '),hours:d.hours,trips:d.trips,km:d.km,start:d.schedule?.startLabel||'',end:d.schedule?.endLabel||'',batches:unique(d.cards.flatMap(r=>r.batchNames)).join('; '),books:d.cards.map(r=>r.book).join('; '),remarks:unique(d.cards.flatMap(r=>r.issues)).join('; ')}));
 const ot=buildOt(duties,f);
 const visibleExceptions=exceptions.filter(e=>rowMatches(e.record,f)).map(({record,...e})=>e);
 const visibleBatches=batches.filter(b=>b.report_date>=f.from&&b.report_date<=f.to);
 return {filters:f,summary,details,performance,ot,exceptions:visibleExceptions,totals:{savedRecords:selected.length,assets:unique(selected.filter(r=>r.eligible).map(r=>r.assetKey)).length,employees:unique(selected.filter(r=>r.eligible).map(r=>r.employeeKey)).length,duties:performance.length,exceptions:visibleExceptions.length},options:{sites:unique([...rows.map(r=>r.site),...visibleBatches.map(b=>b.site)]).sort(),shifts:unique(rows.map(r=>r.shift)).sort(),assets:unique(rows.map(r=>r.assetKey)).map(value=>({value,label:rows.find(r=>r.assetKey===value).door})),employees:unique(rows.map(r=>r.employeeKey)).map(value=>{const r=rows.find(r=>r.employeeKey===value);return {value,label:`${r.employeeId} · ${r.employeeName}`};}),batches:unique([...visibleBatches.map(b=>String(b.id)),...rows.flatMap(r=>r.batchIds)]).map(value=>({value,label:visibleBatches.find(b=>String(b.id)===value)?.name||rows.find(r=>r.batchIds.includes(value))?.batchNames[0]||value}))},notes:['Saved VLB and ELB only. Pending scans and deleted records are excluded. Open batches contain saved records and may change.','Category counts use distinct equipment identities. Employee and duty counts are distinct within their group; category counts are not additive when an employee changes equipment.','Shift performance includes the complete selected duty, including other cards/vehicles in that shift. HMR hours measure machine performance, not attendance or payable OT.','OT checks all shifts and one adjoining day on each side of the date range. Filters select matching duties; linked duties remain visible. Times and gaps are from effective Shift Master schedules (IST); actual employee attendance times are unavailable.','Make/model classification uses the current synced Equipment master. Missing names and unresolved numeric codes are listed for review.']};
}

function buildOt(duties,filters){
 const events=[];
 for(const person of group(duties,d=>JSON.stringify([d.employeeKey,canonicalSiteName(d.site)]))){
  const byDay=group(person,d=>d.date).sort((a,b)=>a[0].date.localeCompare(b[0].date));
  const add=(set,reason,severity)=>{if(!set.some(d=>d.cards.some(r=>rowMatches(r,filters))))return;
   const ordered=[...set].sort((a,b)=>a.date.localeCompare(b.date)||a.shift.localeCompare(b.shift)),first=ordered[0];
   const gaps=ordered.slice(1).map((d,i)=>d.schedule&&ordered[i].schedule?round((d.schedule.start-ordered[i].schedule.end)/3600000):null);
   events.push({id:ordered.map(d=>d.key).join('|'),severity,reason,employeeId:first.employeeId,caliberCode:first.caliberCode,employeeName:first.employeeName,site:first.site,dates:unique(ordered.map(d=>d.date)).join('; '),shifts:ordered.map(d=>`${d.date} ${d.shift}`).join('; '),shiftHours:ordered.map(d=>`${d.date} ${d.shift}: ${d.hours??'Unavailable'}`).join('; '),combinedHours:sum(ordered.map(d=>d.hours)),schedule:ordered.map(d=>`${d.date} ${d.shift}: ${d.schedule?d.schedule.startLabel+' → '+d.schedule.endLabel:'Unavailable'}`).join('; '),gaps:gaps.map(g=>g===null?'Unavailable':`${g} h`).join('; '),batches:unique(ordered.flatMap(d=>d.cards.flatMap(r=>r.batchNames))).join('; '),books:unique(ordered.flatMap(d=>d.cards.map(r=>r.book))).join('; '),remarks:unique(ordered.flatMap(d=>d.cards.flatMap(r=>r.issues))).join('; ')});
  };
  for(const day of byDay){if(day.length<2)continue;const codes=new Set(day.map(d=>d.shift)),s=n=>day.find(d=>d.shift==='S'+n),adjacent=(a,b)=>a?.schedule&&b?.schedule&&a.schedule.end===b.schedule.start;
   if([1,2,3].every(n=>codes.has('S'+n)))add(day,'RED — All three shifts; red takes priority','red');
   else if(adjacent(s(1),s(2))||adjacent(s(2),s(3)))add(day,'RED — Back-to-back OT','red');
   else if(s(1)&&s(3)&&!s(2)&&s(1).schedule&&s(3).schedule&&s(3).schedule.start>s(1).schedule.end)add(day,'ORANGE — Shift 1 and Shift 3 with a shift gap','orange');
   else add(day,'REVIEW — Multiple duties; schedule or shift pattern needs confirmation','review');
  }
  for(const third of person.filter(d=>d.shift==='S3')){const first=person.find(d=>d.date===nextReportDate(third.date)&&d.shift==='S1');if(!first)continue;const adjacent=third.schedule&&first.schedule&&third.schedule.end===first.schedule.start;add([third,first],adjacent?'RED — Shift 3 followed by next day’s Shift 1':'REVIEW — Overnight duties; schedule continuity is unconfirmed',adjacent?'red':'review');}
 }
 return events.sort((a,b)=>a.dates.localeCompare(b.dates)||a.employeeId.localeCompare(b.employeeId));
}
