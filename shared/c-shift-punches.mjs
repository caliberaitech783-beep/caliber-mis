import {canonicalSiteName} from './site-location.mjs';
import {bookShiftCode} from './trip-card-rules.mjs';
export const adjacentDate=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const mins=t=>{const m=/^(\d{1,2}):(\d{2})/.exec(String(t||''));return m?+m[1]*60+ +m[2]:null;};
export function cShift(site,date,masters=[]){
 return masters.filter(s=>s&&canonicalSiteName(s.site)===canonicalSiteName(site)&&bookShiftCode(s.shiftName)==='S3'&&(!s.effectiveFrom||s.effectiveFrom<=date)&&(!s.effectiveTo||s.effectiveTo>=date)).sort((a,b)=>String(b.effectiveFrom||'').localeCompare(String(a.effectiveFrom||''))).map(s=>({start:mins(s.startTime),end:mins(s.endTime)})).find(s=>s.start!==null&&s.end!==null&&s.end<s.start);
}
export function cShiftNight(date,time,site,masters){
 const t=mins(time);if(t===null)return '';
 const prev=adjacentDate(date,-1),night=cShift(site,prev,masters);
 if(night&&t<=night.end+180&&t<night.start-180)return prev;
 const own=cShift(site,date,masters);return own&&t>=own.start-180?date:'';
}
// Reconcile calendar-day exports before limiting dates; HR corrections stay authoritative.
export function cShiftDays(input,{masters=[],site=''}={}){
 const days=input.map(d=>({...d})),removed=new Set(),index=new Map(),shifts=new Map();
 const key=(d,date=d.date)=>d.caliberCode+'|'+date+'|'+canonicalSiteName(d.site||site);
 for(const d of days){const k=key(d);if(!index.has(k))index.set(k,[]);index.get(k).push(d);}
 const shift=(location,date)=>{const k=canonicalSiteName(location)+'|'+date;if(!shifts.has(k))shifts.set(k,cShift(location,date,masters));return shifts.get(k);};
 for(const morning of days){
  if(morning.corrected||morning.presentByHr||morning.cShiftDate)continue;
  const location=morning.site||site,previous=adjacentDate(morning.date,-1),s=shift(location,previous);if(!s)continue;
  const early=t=>{const n=mins(t);return n!==null&&n<=s.end+180&&n<s.start-180;};
  const evening=(index.get(key(morning,previous))||[]).find(d=>d!==morning&&!removed.has(d)&&d.inTime&&mins(d.inTime)>=s.start-180);
  const times=[morning.inTime,morning.outTime].filter(Boolean),transferable=times.filter(early);
  if(morning.inTime&&morning.outTime&&!early(morning.outTime))continue;
  if(!transferable.length||(!evening&&morning.inTime))continue;
  if(evening){
   if(evening.corrected){
    if(!evening.outTime||evening.outTime>evening.inTime)continue;
    if(early(morning.inTime))morning.inTime='';if(early(morning.outTime))morning.outTime='';
    if(!morning.inTime&&!morning.outTime)removed.add(morning);
    continue;
   }
   if(evening.outTime&&!early(evening.outTime))continue;
   // A complete night already has an OUT: an IN-only morning may be a new A duty.
   if(evening.outTime&&!morning.outTime)continue;
   evening.outTime=[evening.outTime,...transferable].filter(Boolean).sort().at(-1);
   if(early(morning.inTime))morning.inTime='';if(early(morning.outTime))morning.outTime='';
   if(!morning.inTime&&!morning.outTime)removed.add(morning);
  }else {morning.date=previous;morning.cShiftDate=true;}
 }
 return days.filter(d=>!removed.has(d));
}
