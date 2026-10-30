import {canonicalSiteName} from './site-location.mjs';
import {bookShiftCode} from './trip-card-rules.mjs';
import {displaySiteName} from './region-scope.mjs';

const invalid=message=>{throw Object.assign(new Error(message),{status:400})};
export function vlbBatchSelection(input={}){
 const site=canonicalSiteName(String(input.site||'').trim());
 const date=String(input.date||'');
 const shift=bookShiftCode(input.shift);
 if(!site||site.length>200)invalid('Select a site name.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)invalid('Select a valid report date.');
 if(!shift)invalid('Select a shift.');
 return {site,date,shift};
}
export function vlbBatchPrefix(input){
 const {site,date,shift}=vlbBatchSelection(input),[year,month,day]=date.split('-'),n=Number(day);
 const suffix=n>=11&&n<=13?'TH':({1:'ST',2:'ND',3:'RD'}[n%10]||'TH');
 const siteSegment=displaySiteName(site).toUpperCase().replace(/[\/\\\x00-\x1f\x7f]/g,'-');
 return `CMLL/${siteSegment}/${n}${suffix} -${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Number(month)-1]}-${year.slice(-2)}/${shift}`;
}
export const vlbBatchName=(selection,sequence)=>`${vlbBatchPrefix(selection)}/B${String(sequence).padStart(2,'0')}`;
export const vlbRecordShift=data=>bookShiftCode(data.bookShiftCode)||bookShiftCode(data.cardShift)||bookShiftCode(data.shiftName);
export const vlbRecordSource=record=>record.data?.scanCardId?'VLB Scan':'VLB Manual';
