import {bookShiftCode} from './trip-card-rules.mjs';
import {canonicalSiteName} from './site-location.mjs';

const clockMinutes=value=>{const match=String(value||'').match(/^(\d{1,2}):(\d{2})/);if(!match||Number(match[1])>23||Number(match[2])>59)return null;return Number(match[1])*60+Number(match[2]);};

export const manualTimeValue=value=>String(value||'').slice(0,5);

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
