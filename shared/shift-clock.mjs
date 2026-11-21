// Shift clock (owner, 17 Nov 2026). Drivers write trip times on a 12-hour clock: on a Shift C card (21:00 to 05:00)
// "12:50" means 00:50 and "2:30" means 02:30; on a Shift B card (13:00 to 21:00) "2:30" means 14:30. The shift of a
// card is fixed, so every written time is read on that shift's clock: of the two clock times a written hour can mean
// (h and h + 12), the one inside the shift is kept. The shift runs from the card's Shift Master start for its shift
// hours, with SLACK_BEFORE minutes before it and SLACK_AFTER minutes after it for a trip that starts early or runs
// over. A time that fits neither way stays as written and is marked outside the shift: it is never counted as a delay.
import {CARD_SHIFTS,normalizeCardShift} from './trip-card-rules.mjs';

export const SLACK_BEFORE=60;
export const SLACK_AFTER=120;
const DAY=1440;
const CLOCK=/^(\d{1,2})\s*[:.]\s*(\d{1,2})(?::(\d{2}))?$/;
const pad=n=>String(n).padStart(2,'0');
const startMinutes=value=>{const m=String(value||'').trim().match(/^(\d{1,2}):(\d{2})/);return m&&Number(m[1])<24&&Number(m[2])<60?Number(m[1])*60+Number(m[2]):null;};
const label=minutes=>pad(Math.floor(minutes/60)%24)+':'+pad(minutes%60);

// The clock window of a card: its saved Shift Master start, else the start of its marked shift (I/II/III). Day and
// Night cards with no saved start have no window, and their times are left as written.
export function shiftWindowOf(card){
 if(!card||typeof card!=='object')return null;
 const shift=normalizeCardShift(card.cardShift)||normalizeCardShift(card.bookShiftCode)||normalizeCardShift(card.shiftName);
 const start=startMinutes(card.masterShiftStart)??startMinutes(CARD_SHIFTS[shift]?.start);
 if(start===null)return null;
 const saved=Number(card.shiftHours),hours=saved>0&&saved<=12?saved:CARD_SHIFTS[shift]?.hours||8;
 return {start,hours,label:label(start)+'–'+label((start+hours*60)%DAY)};
}

// One written time read on the shift's clock. `time` is the clock time to use, `written` is the time as written when it
// differs (else ''), and `outside` says the time fits the shift neither way.
export function readOnShiftClock(value,window){
 const original=typeof value==='string'?value.trim():'';
 const m=original.match(CLOCK);
 if(!window||!m||Number(m[1])>23||Number(m[2])>59)return {time:value,written:'',outside:false};
 const hour=Number(m[1]),minute=Number(m[2]),seconds=m[3]?':'+m[3]:'';
 const asWritten=pad(hour)+':'+pad(minute)+seconds;
 // A time written on the 24-hour clock may still be 12 hours out (13:37 on a Shift C card is 01:37), so every hour has two readings.
 const options=[hour%12,hour%12+12];
 const offset=h=>(h*60+minute-window.start+DAY)%DAY,length=window.hours*60;
 const inShift=options.filter(h=>offset(h)<=length);
 const inSlack=options.filter(h=>offset(h)<=length+SLACK_AFTER||offset(h)>=DAY-SLACK_BEFORE);
 // A time plainly on the 24-hour clock (00:xx or 13:00 onwards) that fits the shift with its slack is kept: on a
 // 12-hour Day shift (08:00 to 20:00) "20:30" is half an hour over, not 08:30.
 const explicit=(hour===0||hour>=13)&&inSlack.includes(hour);
 const pick=explicit?hour:inShift.length===1?inShift[0]:inShift.length>1?(inShift.includes(hour)?hour:inShift[0]):inSlack.length===1?inSlack[0]:inSlack.length>1?(inSlack.includes(hour)?hour:inSlack[0]):null;
 if(pick===null)return {time:asWritten,written:'',outside:true};
 const time=pad(pick)+':'+pad(minute)+seconds;
 return {time,written:pick===hour?'':original,outside:false};
}

// A Vehicle Log Book card with its trip times read on the shift's clock. Each trip row whose time was read differently
// keeps the written time in writtenLoadingTime / writtenUnloadingTime; a row with a time outside the shift gets
// outsideShift. Cards without times, other log books and cards with no shift window come back unchanged.
export function cardOnShiftClock(card){
 if(!card||card.timeMode==='without'||!Array.isArray(card.trips)||!card.trips.length)return card;
 const window=shiftWindowOf(card);if(!window)return card;
 let changed=false;
 const trips=card.trips.map(trip=>{
  if(!trip||typeof trip!=='object')return trip;
  const next={...trip};let outside=false,touched=false;
  for(const [field,keep] of [['loadingTime','writtenLoadingTime'],['unloadingTime','writtenUnloadingTime']]){
   if(!trip[field])continue;
   const read=readOnShiftClock(trip[field],window);
   if(read.outside)outside=true;
   if(read.time!==trip[field]){next[field]=read.time;touched=true;}
   if(read.written&&!trip[keep])next[keep]=read.written;
  }
  if(outside!==Boolean(trip.outsideShift)){if(outside)next.outsideShift=true;else delete next.outsideShift;touched=true;}
  if(touched)changed=true;
  return touched?next:trip;
 });
 return changed?{...card,trips,shiftWindow:window.label}:card;
}

// Times out of order (owner, 21 Nov 2026). A vehicle cannot load its next trip before it has unloaded this one, so when a
// row's unloading time comes after the next row's loading time (both counted forward from this row's loading time), one
// of the times was misread or wrongly written. Gauri Pauni 20-11-26 Shift C card 157: the scan read unloading "10:07" as
// 16:07, the Shift C clock made that 04:07, and a 20-minute trip showed as 380 minutes in the Trip Timing 30+ list.
const clockMinute=value=>{const m=String(value??'').trim().match(/^(\d{1,2})\s*[:.]\s*(\d{2})/);return m&&Number(m[1])<24&&Number(m[2])<60?Number(m[1])*60+Number(m[2]):null;};
const forward=(from,to)=>{const a=clockMinute(from),b=clockMinute(to);return a===null||b===null?null:(b-a+DAY)%DAY;};
export function unloadsAfterNextLoading(trip,next){
 if(!trip||!next||!trip.loadingTime||!trip.unloadingTime||!next.loadingTime)return false;
 const taken=forward(trip.loadingTime,trip.unloadingTime),toNext=forward(trip.loadingTime,next.loadingTime);
 return taken!==null&&toNext!==null&&toNext<taken;
}
// The rows of a card (index i) whose unloading comes after row i + 1's loading, judged on the card's shift clock so that
// a 12-hour "10:21" and a 24-hour "22:07" on a Shift C card are compared as the same evening.
export function tripTimesOutOfOrder(card){
 if(!card||card.timeMode==='without'||!Array.isArray(card.trips))return [];
 const trips=(cardOnShiftClock(card)||card).trips||[],out=[];
 for(let i=0;i<trips.length-1;i++)if(unloadsAfterNextLoading(trips[i],trips[i+1]))out.push(i);
 return out;
}

// Remark for one trip row: what was read differently, or that a time is outside the shift.
export function shiftClockNote(trip,shiftName,windowLabel){
 if(!trip)return '';
 const notes=[],shift=String(shiftName||'').trim()||'the shift',hours=windowLabel?' ('+windowLabel+')':'';
 for(const [field,keep] of [['loadingTime','writtenLoadingTime'],['unloadingTime','writtenUnloadingTime']])if(trip[keep]&&trip[keep]!==trip[field])notes.push(`Written ${trip[keep]} on the card, read as ${String(trip[field]).slice(0,5)} on the ${shift} clock`);
 if(trip.outsideShift)notes.push(`Time outside ${shift} hours${hours}: check the card, not judged`);
 return notes.join(' · ');
}
