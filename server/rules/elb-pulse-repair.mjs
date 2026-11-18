// Repair of BD hours filled from Pulse (owner, 17-18 Nov 2026).
//
// Three saves fill a card's BD hours from Pulse: the two-stage "working-only" machine entry (ELB), the ELB / VLB / LMV
// form save and the scanned-card save (shared/breakdown-hours-source.mjs applyBreakdownHours). Until PR 413 all three
// used a match where a "-" or blank registration matched every Pulse request with the same blank, so every breakdown of
// the site was put on every such machine. This works one saved card out again with the corrected match, over the same
// shift window the save used (`hoursSource.shiftStart` / `shiftEnd`), and says what would change. Nothing is written
// here; the route writes only on the owner's go-ahead.
import {summarizePulseHours} from './log-book-hours.mjs';
import {idleShiftHours} from '../../shared/breakdown-hours-source.mjs';
import {NON_WORKING_STATUSES} from './vlb-two-stage.mjs';

const text=value=>String(value??'').trim();
const num=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);
const same=(a,b)=>Math.abs((num(a)??0)-(num(b)??0))<0.0005;
const sameOrBothEmpty=(a,b)=>num(a)===null&&num(b)===null||num(a)!==null&&num(b)!==null&&same(a,b);

// A card whose BD hours a save took from Pulse (any of the three saves).
export const isPulseFilledCard=data=>data?.breakdownHoursSource==='pulse';
// The two-stage machine entry, which also works the machine's status out from those BD hours.
export const isPulseFilledElb=data=>isPulseFilledCard(data)&&data?.elbEntryMode==='working-only';

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

// One saved card worked out again. `rows`: Pulse's breakdown list (the card's own site's rows are enough); `asset`: its
// Equipment master record; `shift`: its Shift Master record; `knownReferences`: every request reference Pulse's list
// still holds (all sites), so a card whose old requests have left the list is skipped, never emptied.
// Returns {skip} when it cannot be worked out, {unchanged} when nothing differs, else {data, patch, change}; `patch`
// holds only the fields that are written (merged into the card, nothing else touched).
export function recomputePulseElb(data,{rows,asset,shift,knownReferences=null,now=Date.now(),at=new Date(now).toISOString(),by=''}){
 if(!isPulseFilledCard(data))return {skip:'BD hours were typed, not taken from Pulse.'};
 const window=repairWindow(data);
 if(!window)return {skip:'The card has no saved Pulse shift window.'};
 if(!asset)return {skip:'The machine is not in the Equipment master.'};
 const oldRefs=(data.pulseBreakdowns||data.hoursSource?.breakdowns||[]).map(b=>text(b.reference)).filter(Boolean);
 if(knownReferences&&oldRefs.length&&!oldRefs.some(ref=>knownReferences.has(ref)))return {skip:'Pulse\'s list no longer holds this card\'s requests; left as saved.'};
 const startClock=new Date(window.start).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false});
 let summary;
 try{summary=summarizePulseHours({rows,date:text(data.bookDate),site:text(data.location),asset,shift:{...(shift||{}),startTime:text(shift?.startTime||shift?.start)||startClock},
  shiftHours:Number(data.shiftHours),runningHours:num(data.hoursSource?.runningHours),portion:window,now});}
 catch(error){return {skip:error?.message||'Pulse hours could not be worked out.'};}
 const oldBd=num(data.breakdownHours)??0,bd=Number(summary.breakdownHours)||0;
 const scheduled=num(data.scheduledHours)??num(data.shiftHours)??0;
 let shiftStatus=text(data.shiftStatus),statusReason=text(data.statusReason),idleHours=num(data.idleHours);
 if(isPulseFilledElb(data)){
  const opening=num(data.openingHmr),closing=num(data.closingHmr),actualHours=opening!==null&&closing!==null?closing-opening:null,trips=num(data.fleetTrips)??0;
  // The status and reason change only where the save worked them out from Pulse, not where a person chose them.
  if(text(data.shiftStatus)===fleetStatusFor({actualHours,trips,breakdownHours:oldBd,scheduledHours:scheduled}))shiftStatus=fleetStatusFor({actualHours,trips,breakdownHours:bd,scheduledHours:scheduled});
  if(text(data.statusReason)===pulseReasonFor(data.pulseBreakdowns,oldBd))statusReason=pulseReasonFor(summary.breakdowns,bd);
  const nonWorking=NON_WORKING_STATUSES.includes(shiftStatus);
  const remaining=idleShiftHours(scheduled,nonWorking?0:data.totalWorkingHmr,bd);
  idleHours=nonWorking?remaining:remaining!==null&&remaining>=0?remaining:null;
 }else if(sameOrBothEmpty(data.idleHours,idleShiftHours(scheduled,data.totalWorkingHmr,oldBd))){
  // Form and scanned cards: a person chose the status; the save worked idle hours out as shift - working - BD.
  idleHours=idleShiftHours(scheduled,data.totalWorkingHmr,bd);
 }
 const newRefs=(summary.breakdowns||[]).map(b=>text(b.reference)).filter(Boolean);
 const change={breakdownHours:[oldBd,bd],shiftStatus:[text(data.shiftStatus),shiftStatus],idleHours:[num(data.idleHours),idleHours],references:[oldRefs,newRefs],statusReason:[text(data.statusReason),statusReason]};
 if(same(oldBd,bd)&&change.shiftStatus[0]===shiftStatus&&oldRefs.join(',')===newRefs.join(','))return {unchanged:true,change};
 const patch={breakdownHours:bd,hoursSource:summary,pulseBreakdowns:summary.breakdowns||[],idleHours,
  ...(data.shiftStatus!==undefined||shiftStatus?{shiftStatus}:{}),...(data.statusReason!==undefined||statusReason?{statusReason}:{}),
  pulseRepair:{at,by,reason:'BD hours worked out again from Pulse after the machine match fix (PR 413).',
   previous:{breakdownHours:oldBd,shiftStatus:text(data.shiftStatus),statusReason:text(data.statusReason),idleHours:num(data.idleHours),references:oldRefs}}};
 return {data:{...data,...patch},patch,change};
}
