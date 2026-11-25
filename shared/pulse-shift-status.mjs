// What Pulse-1 (pulse.cmll.in) holds for one machine in one shift (owner, 25 Nov 2026: "if any vehicle or equipment is in
// maintenance or idle it should fetch from pulse.cmll.in"). Read from Pulse-II's copy of Pulse's breakdown list, so the
// batch page never waits on Pulse.
// - Breakdown / maintenance: the hours of the shift covered by a request that is not an idle request, overlaps merged
//   (the same matching as a card's BD hours, server/rules/log-book-hours.mjs).
// - Idle: a request marked vehicle idle whose idle time (from its idle approval, else its request, else its start) falls in
//   the shift, with its idle reason (as Fleet reconciliation reads it). The time before the idle approval counts as breakdown.
import {canonicalSiteName} from './site-location.mjs';
import {pulseMachineKey,pulseMachineKeys} from './pulse-machine-key.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';

const text=value=>String(value??'').trim();
const round=n=>Math.round(n*100)/100;
// Pulse times are India time without a zone.
export const pulseTime=value=>{const s=text(value);if(!s||s==='—')return NaN;return Date.parse(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(s)?s.replace(' ','T')+'+05:30':s);};

// The shift as times: report date + Shift Master start, for its hours.
export function shiftWindow(date,startTime,hours){
 const m=text(startTime).match(/^(\d{1,2}):(\d{2})/);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text(date))||!m||!(Number(hours)>0))return null;
 const start=pulseTime(date+' '+m[1].padStart(2,'0')+':'+m[2]);
 return Number.isFinite(start)?{start,end:start+Number(hours)*3600000,hours:Number(hours)}:null;
}

// The machine keys Pulse requests are matched on (door, registration, equipment name for non-vehicles; chassis apart).
export function pulseKeysOf(asset={}){
 const equipmentName=text(asset.category).toLowerCase()==='vehicle'?null:asset.equipmentName;
 return {doors:pulseMachineKeys([asset.door,asset.doorNo,equipmentDoorNumber(asset),equipmentName,asset.registration,asset.reg]),chassis:pulseMachineKeys([asset.chassisNo,asset.chassis])};
}

// The site's requests, keyed once, so a site of 150 machines does not walk the whole list 150 times.
export function sitePulseRequests(rows=[],site){
 const key=canonicalSiteName(site);
 return (Array.isArray(rows)?rows:[]).filter(r=>r&&!r.archivedAt&&canonicalSiteName(r.site)===key)
  .map(request=>({request,chassis:pulseMachineKey(request.chassis),keys:pulseMachineKeys([request.door,request.equipment,request.reg])}));
}

export function pulseShiftStatus(asset,requests,window,now=Date.now()){
 if(!asset||!window)return null;
 const {doors,chassis}=pulseKeysOf(asset),ranges=[],references=[],reasons=[];let idle=null;
 const end=Math.min(window.end,now);
 const add=(a,b,request)=>{const lo=Math.max(a,window.start),hi=Math.min(b,end);if(hi>lo){ranges.push([lo,hi]);const ref=text(request.ref);if(ref&&!references.includes(ref))references.push(ref);const why=text(request.description||request.reason||request.category||request.breakdownReason);if(why&&!reasons.includes(why))reasons.push(why);}};
 for(const {request,chassis:requestChassis,keys} of requests){
  const match=chassis.length&&requestChassis?chassis.includes(requestChassis):keys.some(k=>doors.includes(k));
  if(!match)continue;
  const start=pulseTime(request.start),closed=pulseTime(request.closedAt),stop=Number.isFinite(closed)?closed:now;
  if(!Number.isFinite(start)||stop<start)continue;
  if(request.vehicleIdle===true){
   const idleFrom=[request.idealApprovedAt,request.idealRequestedAt].map(pulseTime).find(Number.isFinite)??start;
   if(Math.max(start,idleFrom,window.start)<Math.min(stop,end))idle??={reason:text(request.idleReason)||'Standby',remarks:text(request.description||request.reason),reference:text(request.ref)};
   add(start,Math.min(idleFrom,stop),request);
  }else add(start,stop,request);
 }
 ranges.sort((a,b)=>a[0]-b[0]);
 const merged=[];for(const r of ranges){const last=merged.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else merged.push([...r]);}
 const breakdownHours=round(merged.reduce((sum,[a,b])=>sum+b-a,0)/3600000);
 // A shift still running counts as whole when the breakdown has lasted from its start until now.
 const wholeShift=breakdownHours>0&&(breakdownHours>=window.hours-0.01||(now<window.end&&merged.length===1&&merged[0][0]<=window.start&&merged[0][1]>=end));
 return {breakdownHours,shiftHours:window.hours,wholeShift,references,reason:reasons.join('; ').slice(0,500),idle};
}
