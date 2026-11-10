import {isJayantSecondShift,validShiftHours} from './site-shift-hours.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {bookShiftCode} from './trip-card-rules.mjs';
export const MANUAL_SHIFTS=[{value:'day',label:'Day'},{value:'night',label:'Night'}];
export const isManualShift=value=>MANUAL_SHIFTS.some(row=>row.value===value);
export function manualShiftHours(input={}){
 const hours=Number(input.shiftHours);
 if(!Number.isFinite(hours)||hours<=0||hours>24||!validShiftHours(hours,input))throw Object.assign(new Error(isJayantSecondShift(input)?'Jayant OC second shift requires 9 hours (12:00 PM to 9:00 PM).':'Select an 8-hour or 12-hour shift.'),{status:400});
 return hours;
}
export function manualShiftWindow(input={},base={},shifts=[]){
 const hours=manualShiftHours({...base,...input}),choice=MANUAL_SHIFTS.find(row=>row.value===input.manualShift);
 let selected=base;
 if(['day','night'].includes(input.manualShift)){
  const code=input.manualShift==='day'?'D':'N';
  const matches=shifts.filter(row=>canonicalSiteName(row.site||row.siteName)===canonicalSiteName(input.location)&&!row.sourceMissing&&String(row.status||'').toLowerCase()!=='inactive'&&(!row.effectiveFrom||row.effectiveFrom<=input.bookDate)&&(!row.effectiveTo||row.effectiveTo>=input.bookDate)&&[row.shiftCode,row.shiftName,row.name].some(value=>bookShiftCode(value)===code));
  if(matches.length)selected=matches.sort((a,b)=>String(b.effectiveFrom||'').localeCompare(String(a.effectiveFrom||'')))[0];
 }
 const start=String(selected.startTime||selected.start||'').slice(0,5),label=choice?.label||selected.shiftName||selected.name;
 if(!/^\d{2}:\d{2}$/.test(start))throw Object.assign(new Error('Select a Shift Master entry with a valid start time.'),{status:400});
 const [h,m]=start.split(':').map(Number),end=(Math.round((h*60+m)+hours*60))%1440;
 return {...selected,manualShift:input.manualShift,name:label,shiftName:label,startTime:start,endTime:String(Math.floor(end/60)).padStart(2,'0')+':'+String(end%60).padStart(2,'0')};
}
