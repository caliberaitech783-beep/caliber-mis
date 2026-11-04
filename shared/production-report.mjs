import {operationalDate} from './operational-start.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {bookShiftCode,selectedMasterShift} from './trip-card-rules.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';
import {assetBookKind} from './equipment-kind.mjs';
import {fleetDoorKey} from './scan-fleet-door.mjs';

const text=v=>String(v??'').trim();
const unique=values=>[...new Set(values.filter(Boolean))];
const round=n=>Math.round((n+Number.EPSILON)*1000)/1000;
const num=v=>v!==null&&v!==undefined&&text(v)!==''&&Number.isFinite(Number(v))?Number(v):null;
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export const capacityKey=v=>text(v).normalize('NFKC').toUpperCase().replace(/\s+/g,' ');
export const assetCapacityPair=a=>({make:text(a.assetMake||a.makeName||a.make),model:text(a.assetModel||a.modelName||a.model||a.modelNo)});
export const pairKey=p=>JSON.stringify([capacityKey(p.make),capacityKey(p.model)]);
export function validateCapacity(input){
 const location=text(input.location),jobType=text(input.jobType),make=text(input.make),model=text(input.model),capacity=num(input.capacity),averageDalaFactor=num(input.averageDalaFactor??input.capacity),effectiveFrom=input.effectiveFrom,reason=text(input.reason);
 if(!location||location.length>200)fail('Select a location from Region master.');
 if(!jobType||jobType.length>200)fail('Enter a job type.');
 if(!make||!model||make.length>200||model.length>200||/^\d+$/.test(make))fail('Select a resolved make and model from Equipment master.');
 if(capacity===null||capacity<=0||capacity>1000||round(capacity)!==capacity)fail('Capacity must be greater than zero, at most 1,000 CUM/trip, with up to three decimals.');
 if(averageDalaFactor===null||averageDalaFactor<=0||averageDalaFactor>1000||round(averageDalaFactor)!==averageDalaFactor)fail('Average Dala Factor must be greater than zero, at most 1,000, with up to three decimals.');
 if(!operationalDate(effectiveFrom))fail('Choose an effective date on or after 1 November 2026.');
 if(reason.length<5||reason.length>1000)fail('Enter an approval reference or reason (5–1,000 characters).');
 return {location,locationKey:canonicalSiteName(location),jobType,jobTypeKey:capacityKey(jobType),make,model,makeKey:capacityKey(make),modelKey:capacityKey(model),capacity,averageDalaFactor,effectiveFrom,reason};
}
export function applicableCapacity(versions,pair,date,scope={}){
 const matches=versions.filter(v=>pairKey(v)===pairKey(pair)&&v.effectiveFrom<=date),location=canonicalSiteName(scope.location),jobType=capacityKey(scope.jobType);
 if(!location&&!jobType)return matches.sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0]||null;
 const scoped=location&&jobType?matches.filter(v=>canonicalSiteName(v.location)===location&&capacityKey(v.jobType)===jobType):[];
 const legacy=matches.filter(v=>!text(v.location)&&!text(v.jobType));
 return [...(scoped.length?scoped:legacy)].sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0]||null;
}
export function productionFilters(q){
 if(typeof q.site!=='string'||!q.site.trim()||q.site.length>200||!operationalDate(q.date))fail('Select a site and a valid date on or after 1 November 2026.');
 if(!['shift','day'].includes(q.mode))fail('Select Shift-wise or Day-wise.');
 if(q.mode==='shift'&&!bookShiftCode(q.shift))fail('Select a shift.');
 if(q.schedule&&!['three','daynight'].includes(q.schedule))fail('Invalid shift schedule.');
 return {site:q.site.trim(),date:q.date,mode:q.mode,shift:q.mode==='shift'?bookShiftCode(q.shift):'',schedule:q.schedule||''};
}
export function productionShifts(shifts,site,date){return ['S1','S2','S3','D','N'].filter(code=>selectedMasterShift(shifts,site,code,date));}
const recordShift=r=>bookShiftCode(r.data?.bookShiftCode||r.data?.cardShift||r.data?.shiftName);
const door=a=>text(a.door||a.doorNo||equipmentDoorNumber(a));
const sameSite=(a,b)=>canonicalSiteName(a)===canonicalSiteName(b);
const active=b=>!b.deleted_at&&!b.archived_at;

// Inputs are a consistent database snapshot. No totals leave this function while
// any requested batch or contributing handover remains unprocessed.
export function buildProductionReport({filters,records=[],assets=[],shifts=[],batches=[],capacities=[]}){
 const f=productionFilters(filters),issues=[],warnings=[];
 const issue=(code,message,reference='')=>issues.push({code,message,reference});
 const configured=productionShifts(shifts,f.site,f.date),three=configured.filter(s=>s.startsWith('S')),dn=configured.filter(s=>['D','N'].includes(s));
 let selected=f.mode==='shift'?[f.shift]:configured;
 if(f.mode==='day'&&three.length&&dn.length){
  if(!f.schedule)issue('schedule','This site has both three-shift and Day/Night schedules. Select the applicable schedule.');
  selected=f.schedule==='daynight'?dn:three;
 }
 if(!selected.length||selected.some(s=>!configured.includes(s)))issue('shift-master','No unambiguous active Shift Master schedule matches this selection.');
 const relevant=batches.filter(b=>active(b)&&sameSite(b.site,f.site)&&String(b.report_date||b.book_date).slice(0,10)===f.date&&selected.includes(bookShiftCode(b.shift)));
 const selectedRecords=records.filter(r=>sameSite(r.site||r.data?.location,f.site)&&String(r.book_date||r.data?.bookDate).slice(0,10)===f.date&&selected.includes(recordShift(r))&&!r.deleted_at);
 const vehicles=selectedRecords.filter(r=>r.book_type==='vehicle'),equipment=selectedRecords.filter(r=>r.book_type==='equipment');
 const recordMap=new Map(records.map(r=>[String(r.id),r])),assetMap=new Map(assets.map(a=>[String(a.id),a]));
 const checkpoint=r=>{
  const memberships=(r.batches||[]).filter(active);
  if(memberships.length!==1||!memberships[0].closed_at)return false;
  const b=memberships[0];
  return sameSite(b.site,r.site||r.data.location)&&String(b.report_date||b.book_date).slice(0,10)===String(r.book_date||r.data.bookDate).slice(0,10)&&bookShiftCode(b.shift)===recordShift(r)&&Number(b.snapshotRevision)===Number(r.revision);
 };
 const status=selected.map(shift=>{
  const list=relevant.filter(b=>bookShiftCode(b.shift)===shift),cards=vehicles.filter(r=>recordShift(r)===shift);
  const state=list.length!==1?'Missing / duplicate batch':!list[0].closed_at?'Not processed':!cards.length?'No saved VLB cards':cards.some(r=>!checkpoint(r))?'Batch snapshot needs review':'Processed';
  if(state!=='Processed')issue('batch',`${shift}: ${state}. Save the cards and use Save & lock batch.`,list.map(b=>b.name).join('; '));
  return {shift,state,batch:list.map(b=>b.name).join('; '),cards:cards.length,revision:list[0]?.closure_revision??null};
 });
 if(!vehicles.length)issue('coverage','No saved VLB cards are available for this selection.');
 const blocked=()=>({ready:false,filters:f,shifts:selected,status,issues,warnings,doorRows:[],machineRows:[]});
 if(issues.length)return blocked();
 const rowGroups=new Map(),machineGroups=new Map(),capacityUsed=new Map();
 const createRow=(map,a)=>{
  const id=String(a.id);if(!map.has(id)){const pair=assetCapacityPair(a);map.set(id,{id,door:door(a),...pair,capacity:null,capacityValues:new Set(),cells:Object.fromEntries(selected.map(s=>[s,{drivers:new Set(),trips:0,quantity:0,hours:null,cards:[]}]))});}return map.get(id);
 };
 const atSite=assets.filter(a=>sameSite(a.currentLocation||a.site||a.location,f.site)&&!a.sourceMissing&&text(a.status).toLowerCase()!=='inactive');
 // Include fleet rows, but distinguish an absent card from an explicit zero-trip card.
 for(const a of atSite)if(assetBookKind(a)==='vehicle')createRow(rowGroups,a);else createRow(machineGroups,a);
 const duplicates=new Set(),machineIndex=new Map();
 for(const a of assets.filter(a=>assetBookKind(a)==='equipment'&&(atSite.includes(a)||equipment.some(r=>String(r.asset_id||r.data.assetId)===String(a.id))))){
  for(const alias of unique([door(a),a.equipmentName,...(Array.isArray(a.cardAliases)?a.cardAliases:[])].map(fleetDoorKey))){if(!machineIndex.has(alias))machineIndex.set(alias,[]);machineIndex.get(alias).push(a);}
 }
 const machineFor=t=>{
  if(t.equipmentId){const a=assetMap.get(String(t.equipmentId));if(a&&assetBookKind(a)==='equipment'&&(atSite.includes(a)||equipment.some(r=>String(r.asset_id||r.data.assetId)===String(a.id))))return a;return null;}
  const matches=machineIndex.get(fleetDoorKey(t.equipmentName))||[];return matches.length===1?matches[0]:null;
 };
 const driver=d=>d.employeeId?`${text(d.employeeName)||'Name missing'} (${text(d.caliberId)||d.employeeId})`:'Unresolved driver / operator';
 for(const r of [...vehicles,...equipment]){
  const d=r.data,s=recordShift(r),a=assetMap.get(String(r.asset_id||d.assetId)),identity=[r.book_type,r.asset_id||d.assetId,s].join(':');
  if(duplicates.has(identity))issue('duplicate','Multiple cards for the same asset and shift need review before totals can be generated.',r.book_no);duplicates.add(identity);
  if(!a){issue('asset','Equipment master identity is missing.',r.book_no);continue;}
  if(d.bookDate!==f.date||!sameSite(d.location,f.site)){issue('metadata','Saved card date/site conflicts with its record.',r.book_no);continue;}
  const row=createRow(r.book_type==='vehicle'?rowGroups:machineGroups,a),cell=row.cells[s];cell.drivers.add(driver(d));cell.cards.push(r.book_no);
  if(!d.employeeId)warnings.push({message:'Driver / operator ID is missing.',reference:r.book_no});
  if(r.book_type==='equipment'){
   const start=num(d.openingHmr),end=num(d.closingHmr),hours=start!==null&&end!==null&&start>=0&&end>=start?round(end-start):null;
   if(hours===null)issue('hmr','ELB opening and closing HMR need correction.',r.book_no);else cell.hours=hours;
   const scheduled=num(d.shiftHours),bd=num(d.breakdownHours),idle=num(d.idleHours);
   if(hours!==null&&scheduled!==null&&(hours>scheduled||bd!==null&&idle!==null&&hours+bd+idle>scheduled+0.01))warnings.push({message:'ELB HMR / breakdown / idle hours do not reconcile to scheduled hours. HMR difference is shown; source values were not changed.',reference:r.book_no});
   continue;
  }
  const pair=d.assetMake&&d.assetModel?assetCapacityPair(d):assetCapacityPair(a);row.make=pair.make;row.model=pair.model;
  for(const t of d.trips||[]){
   const capacity=applicableCapacity(capacities,pair,f.date,{location:f.site,jobType:t.jobType});
   if(!capacity){issue('capacity',`Approved capacity missing for ${f.site} · ${text(t.jobType)||'job type missing'} · ${pair.make||'unresolved make'} / ${pair.model||'unresolved model'} on ${f.date}.`,row.door);continue;}
   capacityUsed.set(String(capacity.id),capacity);const approvedCapacity=Number(capacity.capacity);row.capacityValues.add(approvedCapacity);row.capacity=row.capacityValues.size===1?approvedCapacity:null;
   const entered=num(t.tripCount);if(entered===null||entered<0||!Number.isInteger(entered)){issue('trips','Entered trip count is invalid.',r.book_no);continue;}
   const count=num(t.completedTrips);if(count===null||count<0||!Number.isInteger(count)){issue('trips','Completed trip count is invalid.',r.book_no);continue;}
   if(count>entered){issue('trips','Completed trips exceed entered trips.',r.book_no);continue;}
   if(t.unmatchedTrips>0)issue('handover','A loading/unloading entry has no matching completed trip. Resolve it before generating the report.',r.book_no);
   if(!count)continue;
   const parts=(t.handoverLinks||[]).filter(l=>l.role==='unloading');
   const contributions=parts.length?parts.map(l=>{const source=recordMap.get(String(l.counterpart.logBookId));if(!source||!checkpoint(source)){issue('handover-batch','The loading card for a completed handover is not in a processed batch.',r.book_no);return null;}return {trip:source.data.trips[l.counterpart.row-1],count:Number(l.tripCount)};}).filter(Boolean):[{trip:t,count}];
   if(round(contributions.reduce((n,c)=>n+c.count,0))!==count){issue('handover-count','Completed handover quantities do not reconcile.',r.book_no);continue;}
   cell.trips+=count;cell.quantity=round(cell.quantity+count*approvedCapacity);
   for(const part of contributions){const machine=machineFor(part.trip||{});if(!machine){issue('machine','Loading machine number is missing, ambiguous or outside this site. Correct the VLB equipment link.',`${r.book_no}: ${part.trip?.equipmentName||'blank'}`);continue;}const mc=createRow(machineGroups,machine).cells[s];mc.trips+=part.count;mc.quantity=round(mc.quantity+part.count*approvedCapacity);}
  }
 }
 for(const row of machineGroups.values())for(const s of selected){const c=row.cells[s];if(c.trips&&!c.cards.length)issue('elb',`Saved ELB is missing for loading machine ${row.door} in ${s}.`,row.door);}
 if(issues.length)return blocked();
 const finish=(map,isMachine)=>[...map.values()].sort((a,b)=>a.door.localeCompare(b.door,undefined,{numeric:true})).map((r,i)=>{
  const out={id:r.id,sr:i+1,door:r.door,make:r.make,model:r.model,capacity:r.capacity??null,totalTrips:0,totalQuantity:0,totalHours:0,coverage:''};let hasHours=false;
  for(const s of selected){const c=r.cells[s];out[s+'Driver']=[...c.drivers].join('; ')||'—';out[s+'Trips']=c.cards.length||c.trips?c.trips:null;out[s+'Quantity']=c.cards.length||c.trips?c.quantity:null;out[s+'Hours']=c.hours;out.totalTrips+=c.trips;out.totalQuantity=round(out.totalQuantity+c.quantity);if(c.hours!==null){out.totalHours=round(out.totalHours+c.hours);hasHours=true;}}
  if(!hasHours)out.totalHours=null;out.coverage=selected.filter(s=>!r.cells[s].cards.length).map(s=>`${s}: no saved ${isMachine?'ELB':'VLB'} card`).join('; ')||'Cards available';return out;
 });
 const doorRows=finish(rowGroups,false),machineRows=finish(machineGroups,true),totalTrips=doorRows.reduce((n,r)=>n+r.totalTrips,0),totalQuantity=round(doorRows.reduce((n,r)=>n+r.totalQuantity,0));
 if(machineRows.reduce((n,r)=>n+r.totalTrips,0)!==totalTrips||Math.abs(machineRows.reduce((n,r)=>n+r.totalQuantity,0)-totalQuantity)>0.01){issue('reconciliation','Door and machine totals do not match.');return blocked();}
 return {ready:true,filters:f,shifts:selected,status,issues,warnings,doorRows,machineRows,totalTrips,totalQuantity,capacityVersions:[...capacityUsed.values()].map(v=>({id:v.id,location:v.location||'',jobType:v.jobType||'',make:v.make,model:v.model,capacity:Number(v.capacity),effectiveFrom:v.effectiveFrom})),notes:['Quantity (CUM) = approved tipper capacity × completed trips. This is capacity-based volume, not a measured weighbridge quantity.','Trips and volume belong to the completion shift. Cross-shift loading cards must also belong to a processed batch.','Machine hours come from saved ELB HMR differences, once per machine and shift. They are not employee attendance or OT hours.','A dash means no card; zero means a saved card explicitly recorded no completed trips. Fleet coverage lists missing cards.','Processed means the existing Save & lock batch checkpoint. Reopening blocks fresh report generation until the batch is locked again.']};
}
