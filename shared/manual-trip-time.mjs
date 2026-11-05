import {bookShiftCode} from './trip-card-rules.mjs';
import {canonicalSiteName} from './site-location.mjs';

const clockMinutes=value=>{const match=String(value||'').match(/^(\d{1,2}):(\d{2})/);if(!match||Number(match[1])>23||Number(match[2])>59)return null;return Number(match[1])*60+Number(match[2]);};

export const manualTimeValue=value=>String(value||'').slice(0,5);

export function fixedMinuteInput(value){
 const digits=String(value||'').replace(/\D/g,'').slice(0,4);
 if(!digits)return '';
 return digits.length<=2?digits+':':digits.slice(0,2)+':'+digits.slice(2);
}

export function shiftTimeInputValue(value){
 const time=manualTimeValue(value),minutes=clockMinutes(time);
 if(minutes===null)return time;
 const hour=Math.floor(minutes/60)%12||12;
 return String(hour).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
}

export function resolveShiftTime(value,shift){
 const match=String(value||'').trim().match(/^(\d{1,2}):(\d{2})$/);
 if(!match||Number(match[1])>23||Number(match[2])>59)return String(value||'');
 const hour=Number(match[1]),minute=Number(match[2]);
 if(hour>12){const result=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');return timeWithinShift(result,shift)?result:String(value||'');}
 const candidates=[hour%12,(hour%12)+12].map(candidate=>String(candidate).padStart(2,'0')+':'+String(minute).padStart(2,'0'));
 return candidates.find(candidate=>timeWithinShift(candidate,shift))||String(value||'');
}

export function timeWithinShift(value,shift){
 const time=clockMinutes(value),start=clockMinutes(shift?.startTime||shift?.start),end=clockMinutes(shift?.endTime||shift?.end);
 if(time===null||start===null||end===null)return false;
 const duration=(end-start+1440)%1440,offset=(time-start+1440)%1440;
 return duration===0||offset<=duration;
}

export function batchShift(shifts,batch){
 const code=bookShiftCode(batch?.shift);
 return (shifts||[]).find(shift=>canonicalSiteName(shift.site)===canonicalSiteName(batch?.site)&&(bookShiftCode(shift.shiftCode)||bookShiftCode(shift.name))===code&&(!shift.effectiveFrom||shift.effectiveFrom<=batch.report_date)&&(!shift.effectiveTo||shift.effectiveTo>=batch.report_date));
}
