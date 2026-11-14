import {idleShiftHours} from '../../shared/breakdown-hours-source.mjs';
import {validShiftHours} from '../../shared/site-shift-hours.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
const round=n=>Math.round(n*1000)/1000;
const epoch=v=>{if(!v)return NaN;const s=String(v).trim();return Date.parse(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(s)?s.replace(' ','T')+'+05:30':s)};
const identity=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export function summarizePulseHours({rows,date,site,asset,shift,shiftHours,runningHours,portion,now=Date.now()}){
 const time=String(shift?.startTime||shift?.start||'');if(!/^\d{2}:\d{2}(?::\d{2})?$/.test(time))throw new Error('Shift Master start time is missing.');
 const shiftStart=epoch(date+' '+time),start=portion?.start??shiftStart,end=portion?.end??(shiftStart+Number(shiftHours)*3600000);if(!Number.isFinite(start)||!validShiftHours(shiftHours,{...shift,site}))throw new Error('Select a valid date and shift.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(shiftStart).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})!==date)throw new Error('Enter a valid book date.');
 const equipmentName=String(asset.category||'').trim().toLowerCase()==='vehicle'?null:asset.equipmentName;
 const doors=[asset.door,asset.doorNo,equipmentName,asset.registration,asset.reg].filter(Boolean).map(identity);const ranges=[],references=[],breakdowns=[];
 for(const r of rows){if(r.archivedAt||r.vehicleIdle===true||canonicalSiteName(r.site)!==canonicalSiteName(site))continue;
 const chassisMatch=Boolean(r.chassis&&[asset.chassisNo,asset.chassis].filter(Boolean).some(v=>identity(v)===identity(r.chassis)));if(!chassisMatch&&![r.door,r.equipment,r.reg].filter(Boolean).map(identity).some(v=>doors.includes(v)))continue;
 const a=epoch(r.start),rawEnd=epoch(r.closedAt);if(!Number.isFinite(a))throw new Error('A matching Pulse request has no valid start time.');
 if(r.closedAt&&!Number.isFinite(rawEnd)&&r.closedAt!=='—')throw new Error('A matching Pulse request has an invalid close time.');
 const b=Number.isFinite(rawEnd)?rawEnd:now;if(b<a)throw new Error('Pulse request closes before it starts.');const lo=Math.max(a,start),hi=Math.min(b,end,now);if(hi>lo){ranges.push([lo,hi]);references.push(r.ref);breakdowns.push({reference:String(r.ref||''),description:String(r.complaint||r.description||r.reason||'Breakdown recorded in Pulse'),start:new Date(a).toISOString(),end:Number.isFinite(rawEnd)?new Date(rawEnd).toISOString():null,ongoing:!Number.isFinite(rawEnd),status:String(r.status||(!Number.isFinite(rawEnd)?'Ongoing':'Restored')),shiftStart:new Date(lo).toISOString(),shiftEnd:new Date(hi).toISOString(),hours:round((hi-lo)/3600000)})}}
 ranges.sort((a,b)=>a[0]-b[0]);const merged=[];for(const r of ranges){const prev=merged.at(-1);if(prev&&r[0]<=prev[1])prev[1]=Math.max(prev[1],r[1]);else merged.push([...r])}
 const breakdownHours=round(merged.reduce((s,[a,b])=>s+b-a,0)/3600000),availabilityHours=runningHours==null?null:round(Number(runningHours)),idleHours=idleShiftHours((end-start)/3600000,runningHours,breakdownHours);
 return {breakdownHours,availabilityHours,runningHours,idleHours,source:'https://pulse.cmll.in',fetchedAt:new Date(now).toISOString(),references,breakdowns,shiftStart:new Date(start).toISOString(),shiftEnd:new Date(end).toISOString(),warnings:Number(runningHours)>Number(shiftHours)?['Working hours exceed the selected shift; check meter readings and shift.']:[]};
}
