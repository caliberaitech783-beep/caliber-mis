// Repair of ELB BD hours filled from Pulse (owner, 17 Nov 2026).
//
// The two-stage "working-only" machine entry fills an ELB's BD hours from Pulse at save. Until PR 413 a "-" or blank
// registration matched every Pulse request with the same blank, so every breakdown of the site was put on every such
// machine (Gauri Pauni, Sasti, Majri: about 8 h BD on nearly every machine, every shift). This works one saved card out
// again with the corrected match, over the same shift window the save used (`hoursSource.shiftStart` / `shiftEnd`),
// and says what would change. Nothing is written here; the route writes only on the owner's go-ahead.
import {summarizePulseHours} from './log-book-hours.mjs';
import {idleShiftHours} from '../../shared/breakdown-hours-source.mjs';
import {NON_WORKING_STATUSES} from './vlb-two-stage.mjs';

const text=value=>String(value??'').trim();
const num=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);
const same=(a,b)=>Math.abs((num(a)??0)-(num(b)??0))<0.0005;

// A card whose BD hours the save took from Pulse.
export const isPulseFilledElb=data=>data?.breakdownHoursSource==='pulse'&&data?.elbEntryMode==='working-only';

// The status the save gives a working-only card from its meters, trips and Pulse BD hours (saveFleetEntry).
export function fleetStatusFor({actualHours,trips,breakdownHours,scheduledHours}){
 const zero=actualHours===0&&trips===0,bd=Number(breakdownHours)||0;
 return zero?(bd>=scheduledHours?'breakdown':'not_in_use'):bd>0&&bd<scheduledHours?'working_partial_breakdown':'working';
}
// The reason the save writes when nobody typed one.
export const pulseReasonFor=(breakdowns,breakdownHours)=>(breakdowns||[]).map(item=>text(item.description)||text(item.reference)).filter(Boolean).join('; ').slice(0,2000)
 ||(Number(breakdownHours)>0?'Breakdown recorded in Pulse':'');

export function repairWindow(data){
 const start=Date.parse(data?.hoursSource?.shiftStart),end=Date.parse(data?.hoursSource?.shiftEnd);
 return Number.isFinite(start)&&Number.isFinite(end)&&end>start?{start,end}:null;
}

// One saved card worked out again. `rows`: Pulse's breakdown list; `asset`: its Equipment master record; `shift`: its
// Shift Master record. Returns {skip} when it cannot be worked out, {unchanged} when nothing differs, else
// {data, change} with the new card data (the old figures kept under `pulseRepair.previous`).
export function recomputePulseElb(data,{rows,asset,shift,now=Date.now(),at=new Date(now).toISOString(),by=''}){
 if(!isPulseFilledElb(data))return {skip:'Not an ELB whose BD hours came from Pulse.'};
 const window=repairWindow(data);
 if(!window)return {skip:'The card has no saved Pulse shift window.'};
 if(!asset)return {skip:'The machine is not in the Equipment master.'};
 const startClock=new Date(window.start).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false});
 let summary;
 try{summary=summarizePulseHours({rows,date:text(data.bookDate),site:text(data.location),asset,shift:{...(shift||{}),startTime:text(shift?.startTime||shift?.start)||startClock},
  shiftHours:Number(data.shiftHours),runningHours:null,portion:window,now});}
 catch(error){return {skip:error?.message||'Pulse hours could not be worked out.'};}
 const oldBd=num(data.breakdownHours)??0,bd=Number(summary.breakdownHours)||0;
 const scheduled=num(data.scheduledHours)??num(data.shiftHours)??0;
 const opening=num(data.openingHmr),closing=num(data.closingHmr),actualHours=opening!==null&&closing!==null?closing-opening:null,trips=num(data.fleetTrips)??0;
 // The status and reason change only where the save worked them out from Pulse, not where a person chose them.
 const statusFromPulse=text(data.shiftStatus)===fleetStatusFor({actualHours,trips,breakdownHours:oldBd,scheduledHours:scheduled});
 const shiftStatus=statusFromPulse?fleetStatusFor({actualHours,trips,breakdownHours:bd,scheduledHours:scheduled}):text(data.shiftStatus);
 const reasonFromPulse=text(data.statusReason)===pulseReasonFor(data.pulseBreakdowns,oldBd);
 const statusReason=reasonFromPulse?pulseReasonFor(summary.breakdowns,bd):text(data.statusReason);
 const nonWorking=NON_WORKING_STATUSES.includes(shiftStatus);
 const remaining=idleShiftHours(scheduled,nonWorking?0:data.totalWorkingHmr,bd);
 const idleHours=nonWorking?remaining:remaining!==null&&remaining>=0?remaining:null;
 const oldRefs=(data.pulseBreakdowns||[]).map(b=>text(b.reference)).filter(Boolean),newRefs=(summary.breakdowns||[]).map(b=>text(b.reference)).filter(Boolean);
 const change={breakdownHours:[oldBd,bd],shiftStatus:[text(data.shiftStatus),shiftStatus],idleHours:[num(data.idleHours),idleHours],references:[oldRefs,newRefs],statusReason:[text(data.statusReason),statusReason]};
 if(same(oldBd,bd)&&change.shiftStatus[0]===shiftStatus&&oldRefs.join(',')===newRefs.join(','))return {unchanged:true,change};
 const next={...data,breakdownHours:bd,hoursSource:summary,pulseBreakdowns:summary.breakdowns||[],shiftStatus,statusReason,idleHours,
  pulseRepair:{at,by,reason:'BD hours worked out again from Pulse after the machine match fix (PR 413).',
   previous:{breakdownHours:oldBd,shiftStatus:text(data.shiftStatus),statusReason:text(data.statusReason),idleHours:num(data.idleHours),references:oldRefs}}};
 return {data:next,change};
}
