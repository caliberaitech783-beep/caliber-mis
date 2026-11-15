// Pulse breakdowns for the Loading Equipment-wise Report: Pulse's breakdown list, read when the report opens, cut down
// to the breakdowns that touch the chosen dates at the sites the person may see. The report draws them black on the
// machine's shift time-line and takes their minutes out of idle time (owner, 15 Nov 2026).
// A breakdown ends when Pulse closes it, or when Pulse moves the machine to idle (standby); one with neither is still open.
import {canonicalSiteName} from '../../shared/site-location.mjs';

const text=value=>String(value??'').trim();
// Pulse writes "2026-11-07 08:10" in India time, or a full timestamp.
const epoch=value=>{const s=text(value);if(!s||s==='—')return NaN;return Date.parse(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(s)?s.replace(' ','T')+'+05:30':s);};

export function reportBreakdowns(rows,{from,to,siteAllowed=()=>true}){
 // The dates run in India time, with a day either side for the night shift that crosses midnight.
 const lo=Date.parse(from+'T00:00:00+05:30')-86400000,hi=Date.parse(to+'T00:00:00+05:30')+2*86400000;
 const out=[];
 for(const r of Array.isArray(rows)?rows:[]){
  if(r?.archivedAt||!siteAllowed(r.site))continue;
  const start=epoch(r.start);if(!Number.isFinite(start))continue;
  const endValue=r.vehicleIdle===true?(r.idealApprovedAt||r.idealRequestedAt):r.closedAt,end=epoch(endValue);
  if(start>=hi||Number.isFinite(end)&&end<=lo||Number.isFinite(end)&&end<start)continue;
  out.push({ref:text(r.ref),site:text(r.site),siteKey:canonicalSiteName(r.site),door:text(r.door),equipment:text(r.equipment),reg:text(r.reg),chassis:text(r.chassis),
   start:new Date(start).toISOString(),end:Number.isFinite(end)?new Date(end).toISOString():null,
   status:text(r.status)||(Number.isFinite(end)?'Restored':'Ongoing'),reason:text(r.description||r.reason||r.complaint||r.category||r.breakdownReason)});
 }
 return out;
}

// Pulse must not hold the report up: after `waitMs` the report opens with the breakdowns its ELB cards carry.
export async function readReportBreakdowns(read,{from,to,siteAllowed,waitMs=8000}){
 let timer;
 try{
  const rows=await Promise.race([read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Pulse did not answer in time.')),waitMs);})]);
  if(!Array.isArray(rows))throw new Error('Pulse returned an invalid breakdown list.');
  return {pulseBreakdowns:reportBreakdowns(rows,{from,to,siteAllowed}),pulseBreakdownsError:''};
 }catch(error){return {pulseBreakdowns:null,pulseBreakdownsError:error?.message||'Pulse could not be read.'};}
 finally{clearTimeout(timer);}
}
