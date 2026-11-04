import {canonicalSiteName} from '../../shared/site-location.mjs';
import {assetBookKind} from '../../shared/equipment-kind.mjs';
import {equipmentDoorNumber} from '../../shared/equipment-door.mjs';
import {shiftDurationMinutes} from '../../shared/shift-master.mjs';
import {bookShiftCode} from '../../shared/trip-card-rules.mjs';

const text=v=>String(v??'').trim();
const identity=v=>text(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
const serial=v=>{const key=identity(v);return ['NA','NIL','NONE','UNKNOWN','NOTAVAILABLE','NOTAPPLICABLE','NULL','0'].includes(key)?'':key;};
const epoch=v=>{const s=text(v);return Date.parse(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(s)?s.replace(' ','T')+'+05:30':s)};
export const IDLE_REASONS=['Driver unavailable','Operator unavailable','No work allocated','Standby','Fuel unavailable','Maintenance','Other'];
export const fleetShift=v=>bookShiftCode(v)||({A:'S1',B:'S2',C:'S3','SHIFT A':'S1','SHIFT B':'S2','SHIFT C':'S3','SHIFT DAY':'D','SHIFT NIGHT':'N'})[text(v).toUpperCase()]||'';
export const assetIdentity=a=>serial(a.chassis||a.chassisNo)?'chassis:'+serial(a.chassis||a.chassisNo):'id:'+text(a.id);
export function validFleetDate(date){return /^\d{4}-\d{2}-\d{2}$/.test(date||'')&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date&&date>='2026-11-01';}
export function shiftForDate(shifts,site,date,code){
 const matches=shifts.filter(s=>canonicalSiteName(s.site||s.siteName)===canonicalSiteName(site)&&fleetShift(s.shiftCode||s.shiftName||s.name||s.shift)===code&&(!s.effectiveFrom||s.effectiveFrom<=date)&&(!s.effectiveTo||s.effectiveTo>=date)&&text(s.status).toLowerCase()!=='inactive').sort((a,b)=>text(b.effectiveFrom).localeCompare(text(a.effectiveFrom)));
 if(!matches.length)throw Object.assign(Error('No active Shift Master configuration for this site, date and shift.'),{status:400});
 const s=matches[0],minutes=shiftDurationMinutes(s),start=epoch(date+' '+text(s.startTime||s.start));
 if(!minutes||!Number.isFinite(start))throw Object.assign(Error('Shift Master has invalid start/end times.'),{status:400});
 if(matches.filter(v=>text(v.effectiveFrom)===text(s.effectiveFrom)).some(v=>text(v.startTime||v.start)!==text(s.startTime||s.start)||text(v.endTime||v.end)!==text(s.endTime||s.end)))throw Object.assign(Error('Conflicting Shift Master definitions. Correct the shift before reconciling.'),{status:409});
 return {start,end:start+minutes*60000,label:s.shiftName||s.name||code};
}
export function reconcileFleet({assets,books,breakdowns,reasons=[],date,site,shift,window,kind='',now=Date.now()}){
 const grouped=new Map(),warnings=[];
 for(const asset of assets){if(canonicalSiteName(asset.currentLocation||asset.site||asset.location)!==canonicalSiteName(site)||kind&&assetBookKind(asset)!==kind)continue;const key=assetIdentity(asset);const current=grouped.get(key);if(current){current.aliases.push(text(asset.id));warnings.push('Duplicate master records grouped for '+(asset.door||asset.id));}else grouped.set(key,{...asset,aliases:[text(asset.id)]});}
 const unmatched=[];
 const rows=[...grouped.values()].map(asset=>{
  const type=assetBookKind(asset),door=text(asset.door||asset.doorNo||equipmentDoorNumber(asset));
  const entries=books.filter(b=>b.book_type===type&&canonicalSiteName(b.site||b.data?.location)===canonicalSiteName(site)&&fleetShift(b.data?.cardShift||b.data?.batchShift||b.data?.bookShiftCode||b.data?.shiftName)===shift&&asset.aliases.includes(text(b.asset_id||b.data?.assetId)));
  const cards=entries.map(b=>({id:text(b.id),reference:b.book_no,status:b.data?.shiftStatus||'working',reason:b.data?.statusReason||b.data?.remark||''}));
  const operated=entries.some(b=>!['breakdown','maintenance','no_operator','not_in_use'].includes(b.data?.shiftStatus)&&(type==='vehicle'||Number(b.data?.totalWorkingHmr)>0||Number(b.data?.runningHours)>0||Number(b.data?.totalTrips)>0||Number(b.data?.fleetTrips)>0));
  const aliases=[asset.door,asset.doorNo,asset.registration,asset.reg,door,...(/\d/.test(text(asset.equipmentName))?[asset.equipmentName]:[])].map(identity).filter(Boolean),chassis=serial(asset.chassis||asset.chassisNo);
  const bd=[];
  for(const request of breakdowns){if(request.archivedAt||request.vehicleIdle===true||canonicalSiteName(request.site)!==canonicalSiteName(site))continue;const requestChassis=serial(request.chassis);const match=chassis&&requestChassis?chassis===requestChassis:[request.door,request.equipment,request.reg].some(v=>identity(v)&&aliases.includes(identity(v)));if(!match)continue;
   const start=epoch(request.start),hasEnd=request.closedAt&&request.closedAt!=='—',end=hasEnd?epoch(request.closedAt):now;
   if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw Object.assign(Error('Invalid dates in Pulse breakdown '+text(request.ref)+'. Reconciliation cannot classify this asset.'),{status:502});
   if(Math.max(start,window.start)<Math.min(end,window.end,now))bd.push({reference:text(request.ref),start:request.start,end:hasEnd?request.closedAt:null,reason:text(request.description||request.reason||request.category||request.breakdownReason)});
  }
  const savedReason=reasons.find(r=>text(r.asset_key)===assetIdentity(asset));
  const nonWorking=entries.find(b=>['maintenance','no_operator','not_in_use'].includes(b.data?.shiftStatus));
  const reason=savedReason?.reason||(nonWorking?({maintenance:'Maintenance',no_operator:type==='vehicle'?'Driver unavailable':'Operator unavailable',not_in_use:'Not in use'})[nonWorking.data.shiftStatus]:'');
  const remarks=savedReason?.remarks||nonWorking?.data?.statusReason||'';
  const status=operated?(bd.length?'Operated + Breakdown':'Operated only'):bd.length?'Breakdown only':reason?'Idle / Not operated':'Reason pending';
  return {assetId:text(asset.id),assetKey:assetIdentity(asset),site,date,shift,door,kind:type,name:text(asset.equipmentName||asset.equipment||asset.name||asset.group),model:text(asset.modelName||asset.model||asset.modelNo),cards,breakdowns:bd,operated,breakdown:bd.length>0,status,reason,remarks};
 });
 for(const b of books){if(canonicalSiteName(b.site||b.data?.location)!==canonicalSiteName(site)||fleetShift(b.data?.cardShift||b.data?.batchShift||b.data?.bookShiftCode||b.data?.shiftName)!==shift||kind&&b.book_type!==kind)continue;if(![...grouped.values()].some(a=>a.aliases.includes(text(b.asset_id||b.data?.assetId))))unmatched.push({reference:b.book_no,door:b.data?.door||'',kind:b.book_type});}
 const summary=type=>{const items=rows.filter(r=>r.kind===type),count=status=>items.filter(r=>r.status===status).length;return {total:items.length,operatedOnly:count('Operated only'),operatedBreakdown:count('Operated + Breakdown'),breakdownOnly:count('Breakdown only'),idle:count('Idle / Not operated'),pending:count('Reason pending'),operated:items.filter(r=>r.operated).length,breakdown:items.filter(r=>r.breakdown).length};};
 return {rows:rows.sort((a,b)=>a.kind.localeCompare(b.kind)||a.door.localeCompare(b.door,undefined,{numeric:true})),summary:{vehicle:summary('vehicle'),equipment:summary('equipment')},unmatched,warnings:[...new Set(warnings)]};
}
