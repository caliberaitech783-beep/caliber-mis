import {canonicalSiteName} from '../../shared/site-location.mjs';
import {equipmentDoorNumber} from '../../shared/equipment-door.mjs';
import {employeeIdentity,matchesEmployeeReference,suggestedCaliberId} from '../../shared/employee-identity.mjs';
import {bookShiftCode,selectedMasterShift} from '../../shared/trip-card-rules.mjs';
import {operationalDate,OPERATIONAL_START} from '../../shared/operational-start.mjs';
import {normalizeEquipmentGroup} from '../../shared/equipment-group.mjs';
import {batchStage} from './vlb-two-stage.mjs';
import {fleetAssetKind,assetIdentity} from './fleet-reconciliation.mjs';

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
  const person={id:String(e.id),employeeId,caliberCode,name:text(e.name||e.employee||e.login),designation:text(e.currentDesignationName||e.designationName||e.designation),identityKey};byId.set(String(e.id),{...person,source:e});
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
// The three log books a duty can be saved in, in the order they are shown.
export const LOG_BOOKS=[['vehicle','VLB'],['equipment','ELB'],['lmv','LMV']];
const logBookCode=kind=>LOG_BOOKS.find(([id])=>id===kind)?.[1]||'ELB';
const flagTally=events=>Object.fromEntries(['red','orange','review'].map(severity=>[severity,events.filter(e=>e.severity===severity).length]));
const sourceLabel=r=>r.batchNames.join('; ')||`Saved ${logBookCode(r.kind)} (no site batch)`;
// Shift Attendance Equipment Wise names a duty after the machine's group in the Equipment master.
// Spelling differences ("Water Tanker" / "WATER TANKER") become one name; the master is never rewritten.
const NO_EQUIPMENT_GROUP='Group missing in master',NO_EQUIPMENT_ASSIGNED='No equipment assigned';
const equipmentName=value=>{const name=normalizeEquipmentGroup(value);return !name||name.startsWith('UNRESOLVED ')?NO_EQUIPMENT_GROUP:name.toLowerCase().replace(/[a-z]+/g,word=>/[aeiouy]/.test(word)?word[0].toUpperCase()+word.slice(1):word.toUpperCase());};
const makeModelName=s=>[/^Unresolved /.test(s.make)?'Make not named':text(s.make),/^Unresolved /.test(s.model)?'':text(s.model)].filter(Boolean).join(' ');
const assetClass=asset=>{
 const out={group:'Unresolved group',make:'Unresolved make',model:'Unresolved model'};if(!asset)return out;
 for(const [field,value] of Object.entries({group:asset.group||asset.equipmentGroup||asset.itemName,make:asset.makeName||asset.make,model:asset.modelName||asset.model||asset.modelNo}))if(text(value))out[field]=field!=='group'&&/^\d+$/.test(text(value))?`Unresolved ${field} code ${value}`:text(value);
 return out;
};
const shortDate=date=>`${date.slice(8,10)}-${date.slice(5,7)}-${date.slice(2,4)}`;
const FLAG_RANK={red:0,orange:1,review:2};
const rowMatches=(r,f,{dates=true}={})=>(!dates||r.date>=f.from&&r.date<=f.to)&&(!f.site||canonicalSiteName(r.site)===canonicalSiteName(f.site))&&(!f.shift||r.shift===f.shift)&&(!f.batch||r.batchIds.includes(f.batch))&&(!f.employee||r.employeeKey===f.employee)&&(!f.asset||r.assetKey===f.asset);

export function buildManpowerReport({records=[],attendance=[],assets=[],employees=[],shifts=[],batches=[],filters,now=Date.now()}){
 const f=manpowerFilters(filters),exceptions=[],rows=[],resolveEmployee=identityIndex(employees),assetMap=new Map(assets.map(a=>[String(a.id),a]));
 const addIssue=(r,reason)=>{r.issues.push(reason);exceptions.push({id:`${r.id}:${r.issues.length}`,date:r.date,site:r.site,shift:r.shift,door:r.door,employeeId:r.employeeId||r.savedEmployeeId,employeeName:r.employeeName,book:r.book,batches:sourceLabel(r),reason,record:r});};
 const assetDoors=new Map();
 for(const asset of assets){const door=key(asset.door||asset.doorNo||equipmentDoorNumber(asset)),site=canonicalSiteName(asset.currentLocation||asset.site||asset.location);if(!door||!site)continue;const identity=site+'|'+door;if(!assetDoors.has(identity))assetDoors.set(identity,new Set());assetDoors.get(identity).add(String(asset.id));}
 const seenIds=new Set();
 for(const record of records){
  const d=record.data||{},date=record.book_date||d.bookDate,site=record.site||d.location;
  if(record.deleted_at||!operationalDate(date)||date<f.contextFrom||date>f.contextTo)continue;
  const r={id:String(record.id),book:record.book_no,date,site,kind:record.book_type,shift:bookShiftCode(d.bookShiftCode||d.cardShift||d.shiftName),door:text(d.door),savedEmployeeId:text(d.caliberId),employeeId:'',employeeName:text(d.employeeName),employeeKey:'',caliberCode:'',designation:'',assetKey:'',category:'Unresolved category',group:'Unresolved group',make:'Unresolved make',model:'Unresolved model',batchIds:(record.batches||[]).map(b=>String(b.id)),batchNames:(record.batches||[]).map(b=>b.name),batchStatus:unique((record.batches||[]).map(b=>b.closed_at?'Closed':'Open')).join('; '),issues:[],data:d,performanceValid:true,eligible:true};
  if(!r.batchIds.length&&d.scanBatchId){r.batchIds=[String(d.scanBatchId)];r.batchNames=[record.scan_batch_name||String(d.scanBatchId)];r.batchStatus='Saved scan';}
  if(seenIds.has(r.id)){addIssue(r,'Repeated saved record omitted from totals.');continue;}seenIds.add(r.id);
  if(date!==d.bookDate||canonicalSiteName(site)!==canonicalSiteName(d.location)){r.eligible=false;addIssue(r,'Saved date/site metadata conflicts with the logbook; excluded from totals.');}
  const person=resolveEmployee(d);if(person.error)addIssue(r,person.error);else Object.assign(r,{employeeId:person.employeeId,employeeName:person.name,caliberCode:person.caliberCode,designation:person.designation,employeeKey:person.identityKey});
  const asset=assetMap.get(String(record.asset_id||d.assetId));
  if(asset)r.fleetKey=assetIdentity(asset);
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
  // HMR is optional on an LMV card, so a blank one is not a review item; its hours simply stay unavailable.
  const blankLmvHmr=r.kind==='lmv'&&number(d.openingHmr)===null&&number(d.closingHmr)===null;
  if(r.hours===null||r.schedule&&r.hours>r.schedule.hours){r.performanceValid=false;if(!blankLmvHmr)addIssue(r,'Invalid or excessive HMR hours; performance totals unavailable.');}
  if(r.kind==='vehicle'&&(r.km===null||r.trips===null||r.trips<0)){r.performanceValid=false;addIssue(r,'Missing or invalid kilometre / completed-trip values; performance totals unavailable.');}
  rows.push(r);
 }
 // One display name per site: the first properly written one (Shift Master, then batches, then cards).
 // A lower-case stored key such as "jayant ob" is shown only when no better spelling exists.
 const activeShift=s=>!s.sourceMissing&&text(s.status).toLowerCase()!=='inactive',sitesByKey=new Map();
 for(const r of [...shifts.filter(activeShift),...batches,...rows]){const name=text(r.site||r.siteName),siteKey=canonicalSiteName(name),held=sitesByKey.get(siteKey);if(siteKey&&(!held||held===held.toLowerCase()&&name!==name.toLowerCase()))sitesByKey.set(siteKey,name);}
 const siteName=value=>sitesByKey.get(canonicalSiteName(value))||value;
 for(const r of rows)r.site=siteName(r.site);
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
 const dutiesOf=(saved,review)=>group(saved.filter(r=>r.eligible&&r.employeeKey&&r.shift),r=>JSON.stringify([r.employeeKey,canonicalSiteName(r.site),r.date,r.shift])).map(cards=>{
  const r=cards[0],hours=sum(cards.map(c=>c.performanceValid?c.hours:null));
  const issue=hours!==null&&r.schedule&&hours>r.schedule.hours;
  if(issue&&review)for(const card of cards)addIssue(card,'Combined card HMR exceeds this duty’s scheduled hours; review assignments.');
  return {key:JSON.stringify([r.employeeKey,canonicalSiteName(r.site),r.date,r.shift]),date:r.date,site:r.site,shift:r.shift,employeeKey:r.employeeKey,employeeId:r.employeeId,caliberCode:r.caliberCode,designation:r.designation,employeeName:r.employeeName,schedule:cards.some(c=>c.issues.some(s=>/shift start differs/.test(s)))?null:r.schedule,cards,hours:issue?null:hours,trips:sum(cards.filter(c=>c.kind==='vehicle').map(c=>c.performanceValid?c.trips:null)),km:sum(cards.filter(c=>c.kind==='vehicle').map(c=>c.performanceValid?c.km:null))};
 });
 // OT reads all three log books. The manpower, performance and attendance tables stay VLB and ELB only.
 const core=deduped.filter(r=>r.kind!=='lmv'),otDuties=dutiesOf(deduped,true),duties=core.length===deduped.length?otDuties:dutiesOf(core,false);
 const selected=core.filter(r=>rowMatches(r,f));
 // siteKey, equipment and the three keys let the page count machines, employees and duties for any site, date, shift and category.
 // A card left out of totals carries no key, so the page's counts agree with the totals below.
 const details=selected.map(r=>({id:r.id,date:r.date,site:r.site,siteKey:canonicalSiteName(r.site),equipment:equipmentName(r.group),assetKey:r.eligible?r.assetKey:'',employeeKey:r.eligible?r.employeeKey:'',dutyKey:r.eligible&&r.employeeKey&&r.shift?JSON.stringify([r.employeeKey,canonicalSiteName(r.site),r.date,r.shift]):'',shift:r.shift||'Unresolved',door:r.door,category:r.category,group:r.group,make:r.make,model:r.model,employeeId:r.employeeId||r.savedEmployeeId,caliberCode:r.caliberCode,employeeName:r.employeeName,assignment:!r.eligible?'Needs record review':r.employeeKey?'Matched employee ID':'Needs identity review',book:r.book,batches:sourceLabel(r),batchStatus:r.batchStatus||'Saved',remarks:unique([...r.issues,text(r.data.remark)]).join('; ')}));
 const summary=group(selected.filter(r=>r.eligible&&r.assetKey),r=>JSON.stringify([r.date,canonicalSiteName(r.site),r.shift,r.category,r.group,r.make,r.model])).map(cards=>{const r=cards[0];return {date:r.date,site:r.site,siteKey:canonicalSiteName(r.site),equipment:equipmentName(r.group),shift:r.shift,category:r.category,group:r.group,make:r.make,model:r.model,assets:unique(cards.map(c=>c.assetKey)).length,employees:unique(cards.map(c=>c.employeeKey)).length,unresolved:cards.filter(c=>!c.employeeKey).length,doors:unique(cards.map(c=>c.door)).join('; '),batches:unique(cards.flatMap(c=>c.batchNames)).join('; ')};});
 const performance=duties.filter(d=>d.cards.some(r=>rowMatches(r,f))).map(d=>({id:d.key,date:d.date,site:d.site,shift:d.shift,employeeId:d.employeeId,caliberCode:d.caliberCode,employeeName:d.employeeName,doors:unique(d.cards.map(r=>r.door)).join('; '),equipment:unique(d.cards.map(r=>`${r.door}: ${r.group} / ${r.make} / ${r.model}`)).join('; '),hours:d.hours,trips:d.trips,km:d.km,start:d.schedule?.startLabel||'',end:d.schedule?.endLabel||'',batches:unique(d.cards.flatMap(r=>r.batchNames)).join('; '),books:d.cards.map(r=>r.book).join('; '),remarks:unique(d.cards.flatMap(r=>r.issues)).join('; ')}));
 const otMarks=new Map(),ot=buildOt(otDuties,f,otMarks).map(e=>({...e,site:siteName(e.site)}));
 // OT & Multiple Duties, duty by duty: one line per driver, site, date and shift from all three log books, flagged or not,
 // carrying the strongest colour of the cases it is part of. A duty on two machines sits on the one with the most HMR hours.
 const otDutyLines=otDuties.filter(d=>d.cards.some(r=>rowMatches(r,f))).map(d=>{
  const mark=otMarks.get(d.key);let main=d.cards[0];for(const c of d.cards)if((c.hours||0)>(main.hours||0))main=c;
  const others=mark?unique([...mark.others].sort((x,y)=>x.date.localeCompare(y.date)||x.shift.localeCompare(y.shift)).map(o=>o.date===d.date?o.shift:o.shift+' on '+shortDate(o.date))):[];
  const logBooks=LOG_BOOKS.map(([,code])=>code).filter(code=>d.cards.some(r=>logBookCode(r.kind)===code));
  return {id:d.key,date:d.date,shift:d.shift,site:siteName(d.site),siteKey:canonicalSiteName(d.site),employeeKey:d.employeeKey,employeeId:d.employeeId,caliberCode:d.caliberCode,employeeName:d.employeeName,category:d.designation||'Category not in Employee master',
   equipment:equipmentName(main.group),doors:unique(d.cards.map(r=>r.door)).join('; '),makeModel:unique(d.cards.map(makeModelName)).join('; '),logBooks,logBook:logBooks.join(' + '),
   flag:mark?.severity||'normal',flagLabel:mark?unique(mark.reasons).join('; '):'Normal duty',others:others.length?'Also worked '+others.join(', '):'',hours:d.hours,trips:d.trips,books:d.cards.map(r=>r.book).join('; ')};
 }).sort((x,y)=>x.date.localeCompare(y.date)||x.site.localeCompare(y.site)||x.shift.localeCompare(y.shift)||x.employeeName.localeCompare(y.employeeName));
 const visibleExceptions=exceptions.filter(e=>rowMatches(e.record,f)).map(({record,...e})=>({...e,site:siteName(e.site),siteKey:canonicalSiteName(e.site),logBook:logBookCode(record.kind)}));
 const visibleBatches=batches.filter(b=>b.report_date>=f.from&&b.report_date<=f.to);
 const attendanceSources=[];
 for(const r of core.filter(r=>r.eligible&&r.shift)){
  const trips=r.kind==='vehicle'?r.trips:null;
  const hasTrips=trips>0||r.kind==='equipment'&&number(r.data.fleetTrips)>0;
  // A VLB card saved with 0 trips; an ELB card is measured in hours, so it is never a zero-trip duty.
  const zeroCard=r.kind==='vehicle'&&trips===0;
  if(r.employeeKey)attendanceSources.push({...r,trips,hasTrips,zeroCard,card:true});
  const split=r.data.operatorSplit;
  if(split?.secondOperatorId){
   const person=resolveEmployee({employeeId:split.secondOperatorId,caliberId:split.secondOperatorCaliberId});
   if(!person.error)attendanceSources.push({...r,employeeKey:person.identityKey,employeeId:person.employeeId,employeeName:person.name,caliberCode:person.caliberCode,trips:null,hasTrips,zeroCard,card:true});
  }
 }
 for(const entry of attendance){
  const person=resolveEmployee({employeeId:entry.employee_id});
  if(person.error)continue;
  const asset=assetMap.get(String(entry.asset_id));
  const door=asset?text(asset.door||asset.doorNo||equipmentDoorNumber(asset)):'';
  const site=sitesByKey.get(entry.site)||entry.site;
  attendanceSources.push({...entry,site,door,assetKey:door?entry.site+'|'+key(door):'',batchIds:[],employeeKey:person.identityKey,employeeId:person.employeeId,employeeName:person.name,caliberCode:person.caliberCode,trips:0,...assetClass(asset),noMachine:!asset});
 }
 const attendanceDuties=group(attendanceSources,r=>JSON.stringify([r.employeeKey,r.date,r.shift])).filter(sources=>sources.some(r=>rowMatches(r,f)));
 const shiftAttendance=attendanceDuties
  .map(sources=>{
   const r=sources[0],cards=sources.filter(s=>s.card),zero=sources.filter(s=>!s.card);
   const trips=cards.filter(c=>c.trips!==null).map(c=>c.trips);
   return {id:JSON.stringify([r.employeeKey,r.date,r.shift]),date:r.date,shift:r.shift,site:unique(sources.map(s=>s.site)).join('; '),
    employeeId:r.employeeId,employeeName:r.employeeName,caliberCode:r.caliberCode,
    status:cards.some(c=>c.hasTrips)?'Present — with trips':zero.length?'Present — 0 trips':'Present',
    trips:trips.length?sum(trips):cards.length?null:0,doors:unique(sources.map(s=>s.door)).join('; '),
    reason:unique(zero.map(s=>s.reason)).join('; '),remarks:unique(zero.map(s=>s.remarks)).join('; ')};
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.shift.localeCompare(b.shift)||a.employeeName.localeCompare(b.employeeName));
 // Shift Attendance Equipment Wise: one row per driver, date, shift, site and equipment group.
 // A driver who worked two equipment groups in one shift is listed on both ("equipment-wise duties"). The one
 // actual duty per driver, date and shift sits on the machine with the most HMR hours, or on the card saved
 // first when hours are missing or equal.
 const siteOf=s=>canonicalSiteName(s.site),equipmentOf=s=>s.card||!s.noMachine?equipmentName(s.group):NO_EQUIPMENT_ASSIGNED;
 const attendanceEquipment=attendanceDuties.flatMap(sources=>{
  const r=sources[0],cards=sources.filter(s=>s.card),zero=sources.filter(s=>!s.card);
  // A zero-trip entry names the equipment only when no card was saved; next to a card it adds its reason, not a second machine.
  const lines=group(cards.length?cards:zero,s=>JSON.stringify([siteOf(s),equipmentOf(s)])).map(list=>({list,siteKey:siteOf(list[0]),site:sitesByKey.get(siteOf(list[0]))||list[0].site,equipment:equipmentOf(list[0]),doors:unique(list.map(s=>s.door)).join('; '),hours:list.reduce((total,s)=>total+(s.card&&s.hours>0?s.hours:0),0)}));
  let main=lines[0];for(const line of lines)if(line.hours>main.hours)main=line;
  const withTrips=cards.some(c=>c.hasTrips),zeroTrips=!withTrips&&!cards.some(c=>c.kind==='equipment')&&(zero.length>0||cards.some(c=>c.zeroCard));
  const status=withTrips?'Present — with trips':zeroTrips?'Present — 0 trips':'Present';
  const twoSites=unique(lines.map(l=>l.siteKey)).length>1,where=line=>`${line.doors||'no door number'} (${line.equipment}${twoSites?', '+line.site:''})`;
  const reason=unique(zero.map(s=>s.reason)).join('; '),remarks=unique(zero.map(s=>s.remarks)).join('; ');
  return lines.map(line=>{
   const mark=otMarks.get(JSON.stringify([r.employeeKey,line.siteKey,r.date,r.shift])),trips=line.list.filter(s=>s.card&&s.trips!==null).map(s=>s.trips);
   const others=mark?unique([...mark.others].sort((a,b)=>a.date.localeCompare(b.date)||a.shift.localeCompare(b.shift)).map(o=>o.date===r.date?o.shift:`${o.shift} on ${shortDate(o.date)}`)):[];
   const machines=line===main?lines.filter(l=>l!==line).map(l=>'Also worked on '+where(l)).join('; '):'Second machine in this shift; actual duty counted on '+where(main);
   return {id:JSON.stringify([r.employeeKey,r.date,r.shift,line.siteKey,line.equipment]),date:r.date,shift:r.shift,site:line.site,siteKey:line.siteKey,employeeKey:r.employeeKey,employeeId:r.employeeId,caliberCode:r.caliberCode,employeeName:r.employeeName,
    equipment:line.equipment,doors:line.doors,makeModel:unique(line.list.map(s=>s.noMachine?'':makeModelName(s))).join('; '),status,trips:trips.length?sum(trips):line.list.some(s=>s.card)?null:0,
    actual:line===main,actualLabel:line===main?'Yes':'No — second machine',
    flag:mark?.severity||(zeroTrips?'zero':'normal'),flagLabel:mark?unique(mark.reasons).join('; '):zeroTrips?'BLUE — Present with 0 trips':'Normal duty',
    note:[others.length?'Also worked '+others.join(', '):'',machines].filter(Boolean).join(' · '),reason,remarks};
  });
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.site.localeCompare(b.site)||a.shift.localeCompare(b.shift)||a.employeeName.localeCompare(b.employeeName)||Number(b.actual)-Number(a.actual));
 // Every known site is listed, including those with no flagged driver, so an
 // empty card means "checked, nothing found" rather than "not loaded".
 const knownSites=[...sitesByKey].filter(([siteKey])=>siteKey&&(!f.site||siteKey===canonicalSiteName(f.site)));
 // Manpower by Category Reconciliation: the machines the Equipment master places at each site today (the same fleet as the
 // Fleet reconciliation screen, without LMVs), and what each machine's saved VLB and ELB cards show per date and shift.
 // "Active" is a VLB card with a trip, or an ELB card with running hours or trips; a VLB whose kilometres add up to 0 is marked.
 const fleetSeen=new Set(),fleet=[],knownKeys=new Set(knownSites.map(([siteKey])=>siteKey));
 for(const a of assets){const siteKey=canonicalSiteName(a.currentLocation||a.site||a.location);if(a.sourceMissing||!knownKeys.has(siteKey)||fleetAssetKind(a)==='lmv')continue;
  const fleetKey=assetIdentity(a);if(fleetSeen.has(siteKey+'|'+fleetKey))continue;fleetSeen.add(siteKey+'|'+fleetKey);const named=assetClass(a);
  fleet.push({siteKey,key:fleetKey,door:text(a.door||a.doorNo||equipmentDoorNumber(a)),equipment:equipmentName(named.group),makeModel:makeModelName(named)});}
 const fleetWork=group(core.filter(r=>r.shift&&rowMatches(r,f)),r=>JSON.stringify([canonicalSiteName(r.site),r.date,r.shift,r.fleetKey||'card:'+r.id])).map(cards=>{
  const r=cards[0],siteKey=canonicalSiteName(r.site),vehicle=cards.filter(c=>c.kind==='vehicle');
  const total=(list,field)=>{const values=list.map(c=>c[field]).filter(v=>v!==null&&v!==undefined);return values.length?round(values.reduce((a,b)=>a+b,0)):null;};
  const trips=total(vehicle,'trips'),km=total(vehicle,'km');
  return {siteKey,date:r.date,shift:r.shift,key:r.fleetKey||'',inFleet:Boolean(r.fleetKey&&fleetSeen.has(siteKey+'|'+r.fleetKey)),door:unique(cards.map(c=>c.door)).join('; '),equipment:equipmentName(r.group),makeModel:makeModelName(r),
   logBook:unique(cards.map(c=>logBookCode(c.kind))).join(' + '),trips,km,hours:total(cards,'hours'),active:trips>0||cards.some(c=>c.kind==='equipment'&&(c.hours>0||number(c.data.fleetTrips)>0)),zeroKm:vehicle.length>0&&km===0,
   employees:unique(cards.map(c=>c.employeeName)).join('; '),books:cards.map(c=>c.book).join('; ')};
 });
 const attendanceSites=[...new Map([...knownSites,...attendanceEquipment.map(r=>[r.siteKey,r.site])])].map(([siteKey,site])=>({siteKey,site})).sort((a,b)=>a.site.localeCompare(b.site));
 // The batch behind every site, date and shift: not created, still open (VLB, LMV or ELB stage) or closed.
 // A shift is expected once it has ended (Shift Master times), so the running shift is not reported as missing.
 // A site lists the shifts its Shift Master holds on that date; without any, Shift 1 to 3.
 const batchesOf=new Map();for(const b of visibleBatches){const k=JSON.stringify([canonicalSiteName(b.site),b.report_date,bookShiftCode(b.shift)||text(b.shift)]);if(!batchesOf.has(k))batchesOf.set(k,[]);batchesOf.get(k).push(b);}
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now)),days=[];
 for(let day=f.from;day<=f.to;day=nextReportDate(day))days.push(day);
 const attendanceShifts=attendanceSites.flatMap(({siteKey,site})=>days.flatMap(date=>{
  const master=unique(shifts.filter(s=>activeShift(s)&&canonicalSiteName(s.site||s.siteName)===siteKey&&(!s.effectiveFrom||s.effectiveFrom<=date)&&(!s.effectiveTo||date<=s.effectiveTo)).map(s=>bookShiftCode(s.shiftCode)||bookShiftCode(s.shiftName||s.name||s.shift)));
  const held=[...batchesOf.keys()].map(k=>JSON.parse(k)).filter(([key,day])=>key===siteKey&&day===date).map(([,,code])=>code);
  return unique([...(master.length?master:['S1','S2','S3']),...held]).sort().filter(code=>!f.shift||code===f.shift).map(code=>{
   const list=batchesOf.get(JSON.stringify([siteKey,date,code]))||[],open=list.find(b=>!b.closed_at),window=shiftWindow(shifts,site,date,code);
   const state=open?batchStage(open):list.length?'closed':(window?window.end<=now:date<today)?'none':'not_due';
   return {siteKey,date,shift:code,state,batch:(open||list[0])?.name||''};
  });
 }));
 const otSites=knownSites.map(([siteKey,site])=>{const events=ot.filter(e=>e.siteKey===siteKey);return {site,siteKey,...flagTally(events),books:Object.fromEntries(LOG_BOOKS.map(([,code])=>[code,flagTally(events.filter(e=>e.logBooks.includes(code)))]))};}).sort((a,b)=>a.site.localeCompare(b.site));
 const optionRows=[...rows,...attendanceSources];
 return {filters:f,summary,details,performance,shiftAttendance,attendanceEquipment,attendanceSites,attendanceShifts,ot,otDuties:otDutyLines,otSites,fleet,fleetWork,exceptions:visibleExceptions,totals:{savedRecords:selected.length,assets:unique(selected.filter(r=>r.eligible).map(r=>r.assetKey)).length,employees:unique(selected.filter(r=>r.eligible).map(r=>r.employeeKey)).length,duties:performance.length,exceptions:visibleExceptions.filter(e=>e.logBook!=='LMV').length},options:{sites:unique([...optionRows.map(r=>r.site),...visibleBatches.map(b=>b.site)].map(siteName)).sort(),shifts:unique(optionRows.map(r=>r.shift)).sort(),assets:unique(optionRows.map(r=>r.assetKey)).map(value=>({value,label:optionRows.find(r=>r.assetKey===value).door})),employees:unique(optionRows.map(r=>r.employeeKey)).map(value=>{const r=optionRows.find(r=>r.employeeKey===value);return {value,label:`${r.employeeId} · ${r.employeeName}`};}),batches:unique([...visibleBatches.map(b=>String(b.id)),...rows.flatMap(r=>r.batchIds)]).map(value=>({value,label:visibleBatches.find(b=>String(b.id)===value)?.name||rows.find(r=>r.batchIds.includes(value))?.batchNames[0]||value}))},notes:['Saved VLB and ELB only; the OT view also reads saved LMV log books. Pending scans and deleted records are excluded. Open batches contain saved records and may change.','Category counts use distinct equipment identities. Employee and duty counts are distinct within their group; category counts are not additive when an employee changes equipment.','Shift performance includes the complete selected duty, including other cards/vehicles in that shift. HMR hours measure machine performance, not attendance or payable OT.','OT checks all shifts and one adjoining day on each side of the date range. Filters select matching duties; linked duties remain visible. Times and gaps are from effective Shift Master schedules (IST); actual employee attendance times are unavailable. A duty can appear in both a same-day and an overnight event, so event hours must not be added together. Driver category is the current designation in the Employee master. Earlier repeats count the same driver at the same site across all three log books, up to 90 days before the selected dates. Each flagged duty is listed under every log book (VLB, ELB, LMV) it was saved in, so a driver who worked on two log books is counted in both and the three rows can add up to more than the total.','OT duty counts and percentages: a duty is one driver in one shift on one date, from saved VLB, ELB and LMV cards. Every duty that is part of a red, orange or brown case carries that colour, so a driver who worked Shift 1 and Shift 2 is counted under both shifts and the duty counts are higher than the case counts. Red OT % is red duties divided by all duties in the same selection; Orange OT % likewise. Equipment category is the equipment group in the Equipment master of the machine worked; a driver on two machines in one shift is counted on the one with the most HMR hours.','Manpower by Category Reconciliation: Available is the machines the Equipment master places at the site today, as on the Fleet reconciliation screen, without LMVs; the list for an earlier date is not kept, so a machine moved since then is counted at its present site. Card saved is a machine with a saved VLB or ELB card in that shift. Active production is a VLB card with at least one trip, or an ELB card with running hours or trips. Zero trips is a card saved without that. Zero km is a VLB whose kilometres for the shift add up to 0; it can also be a zero-trip machine. No card is Available minus Card saved. A card of a machine that the master places at another site is counted apart as Not in fleet list. Totals over several shifts are machine-shifts: one machine in three shifts counts three times.','Make/model classification uses the current synced Equipment master. Missing names and unresolved numeric codes are listed for review.','Shift Attendance Equipment Wise: actual duties count each driver once per date and shift, whatever number of machines were driven; equipment-wise duties count the driver once on every equipment group worked in that shift. The actual duty sits on the machine with the most HMR hours, or on the card saved first when hours are missing or equal. Equipment names are the group in the current Equipment master, with spelling differences merged. Red, orange and brown follow the OT & Multiple Duties rules; blue is a driver present with 0 trips (zero-trip attendance, or a VLB card saved with 0 trips), never an equipment operator with a saved card. A row has one colour, in the order red, orange, brown, blue.','Batch behind each shift: a box is red while no batch has been created for that site, date and shift, and outlined orange while the batch is created but not closed (VLB open, LMV open or ELB open). A shift counts as missing its batch only after it has ended by the Shift Master times, so the running shift is not red. A site is expected to run the shifts its Shift Master holds on that date.','Driver history: OT in the month and the year counts red, orange and brown cases at that site from the later of 1 January and 1 November 2026. Duties in the history are actual duties on saved VLB and ELB cards; a zero-trip presence without a card is not included.']};
}

// `marks` receives, for every duty in a flagged pattern, its strongest colour, the written reasons and the other shifts worked.
function buildOt(duties,filters,marks=new Map()){
 const events=[];
 for(const person of group(duties,d=>JSON.stringify([d.employeeKey,canonicalSiteName(d.site)]))){
  const byDay=group(person,d=>d.date).sort((a,b)=>a[0].date.localeCompare(b[0].date));
  const add=(set,reason,severity)=>{
   for(const duty of set){
    const others=set.filter(d=>d!==duty).map(d=>({date:d.date,shift:d.shift})),mark=marks.get(duty.key);
    if(!mark||FLAG_RANK[severity]<FLAG_RANK[mark.severity])marks.set(duty.key,{severity,reasons:[reason],others});
    else if(mark.severity===severity){mark.reasons.push(reason);mark.others.push(...others);}
   }
   if(!set.some(d=>d.cards.some(r=>rowMatches(r,filters))))return;
   // A case belongs once to the date and shift of its first duty (`startDate`, `startShift`): the date-by-shift table places it there.
   const ordered=[...set].sort((a,b)=>a.date.localeCompare(b.date)||a.shift.localeCompare(b.shift)),first=ordered[0];
   const gaps=ordered.slice(1).map((d,i)=>d.schedule&&ordered[i].schedule?round((d.schedule.start-ordered[i].schedule.end)/3600000):null);
   const logBooks=LOG_BOOKS.map(([,code])=>code).filter(code=>ordered.some(d=>d.cards.some(r=>logBookCode(r.kind)===code)));
   events.push({id:ordered.map(d=>d.key).join('|'),severity,reason,logBooks,logBook:logBooks.join(' + '),employeeKey:first.employeeKey,siteKey:canonicalSiteName(first.site),dutyDates:unique(ordered.map(d=>d.date)),startDate:first.date,startShift:first.shift,category:first.designation||'Category not in Employee master',equipment:unique(ordered.flatMap(d=>d.cards.map(r=>`${r.group} / ${r.make}`))).join('; '),employeeId:first.employeeId,caliberCode:first.caliberCode,employeeName:first.employeeName,site:first.site,dates:unique(ordered.map(d=>d.date)).join('; '),shifts:ordered.map(d=>`${d.date} ${d.shift}`).join('; '),shiftHours:ordered.map(d=>`${d.date} ${d.shift}: ${d.hours??'Unavailable'}`).join('; '),combinedHours:sum(ordered.map(d=>d.hours)),schedule:ordered.map(d=>`${d.date} ${d.shift}: ${d.schedule?d.schedule.startLabel+' → '+d.schedule.endLabel:'Unavailable'}`).join('; '),gaps:gaps.map(g=>g===null?'Unavailable':`${g} h`).join('; '),batches:unique(ordered.flatMap(d=>d.cards.flatMap(r=>r.batchNames))).join('; '),books:unique(ordered.flatMap(d=>d.cards.map(r=>r.book))).join('; '),remarks:unique(ordered.flatMap(d=>d.cards.flatMap(r=>r.issues))).join('; ')});
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

// Earlier repeats are looked up only on request. The look-back is bounded so a
// click cannot read the whole logbook history.
export const OT_HISTORY_DAYS=90;
export function otHistoryWindows(from,days=7){
 if(!operationalDate(from)||from<=OPERATIONAL_START)return [];
 const last=nextReportDate(from,-1),earliest=nextReportDate(from,-OT_HISTORY_DAYS),first=earliest<OPERATIONAL_START?OPERATIONAL_START:earliest,windows=[];
 for(let start=first;start<=last;start=nextReportDate(start,days)){const end=nextReportDate(start,days-1);windows.push({from:start,to:end>last?last:end});}
 return windows;
}
// An event that reaches into the selected dates belongs to the current report, not to history.
export function otHistorySummary(events,from){
 const past=[...new Map(events.map(e=>[e.id,e])).values()].filter(e=>e.dutyDates.every(date=>date<from));
 return group(past,e=>e.employeeKey+'|'+e.siteKey).map(list=>{const dates=severity=>list.filter(e=>e.severity===severity).map(e=>e.dutyDates[0]).sort();
  return {employeeKey:list[0].employeeKey,siteKey:list[0].siteKey,red:dates('red').length,orange:dates('orange').length,review:dates('review').length,redDates:dates('red'),orangeDates:dates('orange')};});
}

// Month and year OT counts per driver. The year and month are the calendar ones of the report's
// To date, never before the first day of records and never after today. Read one month at a time.
export function otYearWindows(to,today=to){
 if(!operationalDate(to)||!operationalDate(today))return null;
 const year=to.slice(0,4),month=to.slice(0,7),floor=date=>date<OPERATIONAL_START?OPERATIONAL_START:date,cap=date=>date>today?today:date;
 const monthEnd=m=>{const [y,n]=m.split('-').map(Number);return new Date(Date.UTC(y,n,0)).toISOString().slice(0,10);};
 const nextMonth=m=>{const [y,n]=m.split('-').map(Number);return n===12?`${y+1}-01`:`${y}-${String(n+1).padStart(2,'0')}`;};
 const yearFrom=floor(year+'-01-01'),yearTo=cap(year+'-12-31'),monthFrom=floor(month+'-01'),monthTo=cap(monthEnd(month)),windows=[];
 for(let m=yearFrom.slice(0,7);m<=yearTo.slice(0,7);m=nextMonth(m)){const from=floor(m+'-01'),end=cap(monthEnd(m));if(from<=end)windows.push({from,to:end});}
 return {year,month,yearFrom,yearTo,monthFrom,monthTo,windows};
}
// An event belongs to the day of its first duty, so an overnight pair is counted once, in the month it started.
export function otDriverTally(events,range,duties=[]){
 const within=(e,from,to)=>e.dutyDates[0]>=from&&e.dutyDates[0]<=to,tally=list=>({...flagTally(list),total:list.length});
 const year=[...new Map(events.map(e=>[e.id,e])).values()].filter(e=>within(e,range.yearFrom,range.yearTo));
 const drivers=new Map(group(year,e=>e.employeeKey+'|'+e.siteKey).map(list=>[list[0].employeeKey+'|'+list[0].siteKey,{employeeKey:list[0].employeeKey,siteKey:list[0].siteKey,month:tally(list.filter(e=>within(e,range.monthFrom,range.monthTo))),year:tally(list),
  events:[...list].sort((a,b)=>b.dutyDates[0].localeCompare(a.dutyDates[0])).map(e=>({id:e.id,date:e.dutyDates[0],dates:e.dates,severity:e.severity,reason:e.reason,shifts:e.shifts,logBook:e.logBook,equipment:e.equipment,combinedHours:e.combinedHours,books:e.books})),duties:{}}]));
 // Actual duties worked (one per driver, date and shift) month by month, for every driver of the site, flagged or not.
 for(const d of duties){
  if(d.date<range.yearFrom||d.date>range.yearTo)continue;
  const id=d.employeeKey+'|'+d.siteKey,month=d.date.slice(0,7);
  if(!drivers.has(id))drivers.set(id,{employeeKey:d.employeeKey,siteKey:d.siteKey,month:tally([]),year:tally([]),events:[],duties:{}});
  const held=drivers.get(id).duties;held[month]=(held[month]||0)+1;
 }
 return [...drivers.values()];
}
