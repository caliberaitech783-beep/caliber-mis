import {canonicalSiteName} from './site-location.mjs';
import {indiaDateTimeEpoch} from './report-date-range.mjs';
import {transferForAsset} from './equipment-transfer-history.mjs';

const day=86400000;
const hours=3600000;
export const localTimestamp=value=>new Date(value+19800000).toISOString().slice(0,19);
const clockTime=value=>/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value||'');

export function assignmentWindows(asset,transfers){
 const moves=transfers.filter(transfer=>transferForAsset(transfer,asset)&&(!transfer.status||transfer.status==="Completed")).flatMap(transfer=>{
  const {source,destination,transferDate,transferTime,sourceApprovedAt,transferEffectiveAt}=transfer;
  const date=indiaDateTimeEpoch(transferDate);
  if(!canonicalSiteName(source)||!canonicalSiteName(destination)||canonicalSiteName(source)===canonicalSiteName(destination)||!Number.isFinite(date))return [];
  const approval=indiaDateTimeEpoch(sourceApprovedAt);
  // Date-only imports have an unknown cutoff. Keep the rest of the history usable.
  const effective=indiaDateTimeEpoch(transferEffectiveAt);
  const exact=Number.isFinite(effective)?Math.floor(effective/1000)*1000
   :clockTime(transferTime)?indiaDateTimeEpoch(transferDate+'T'+transferTime)
   :approval>=date&&approval<date+day?Math.floor(approval/1000)*1000:null;
  return [{source,destination,start:exact??date,end:exact??date+day}];
 }).sort((a,b)=>a.start-b.start||a.end-b.end);
 if(!moves.some(move=>move.start===move.end))return [];
 const windows=[];
 let start=null,unknownStart=false;
 for(const move of moves){
  if(start===null||start<move.start)windows.push({site:move.source,start,end:move.start,unknownStart,unknownEnd:move.start!==move.end});
  start=Math.max(start??move.end,move.end);
  unknownStart=move.start!==move.end;
 }
 windows.push({site:moves.at(-1).destination,start,end:null,unknownStart});
 return windows;
}

export function overlapsAssignment(window,start,end){
 return (window.start===null||window.start<end)&&(window.end===null||window.end>start);
}

function bookShiftInterval(bookDate,shiftStart,shiftHours){
 const start=indiaDateTimeEpoch(bookDate+'T'+shiftStart);
 return {start,end:start+Number(shiftHours)*hours};
}

export function logBookAssignment(windows,location,bookDate,shiftStart,shiftHours){
 if(!windows.length)return null;
 const dayStart=indiaDateTimeEpoch(bookDate);
 const {start,end}=bookShiftInterval(bookDate,shiftStart,shiftHours);
 const eligible=windows.filter(window=>canonicalSiteName(window.site)===canonicalSiteName(location));
 const fail=message=>{throw Object.assign(new Error(message),{status:400})};
 if(!Number.isFinite(start)||!clockTime(shiftStart)){
  // Without a shift start, only permit a date safely inside one assignment.
  if(eligible.some(window=>(window.start===null||window.start<=dayStart)&&(window.end===null||window.end>=dayStart+2*day)))return null;
  fail('The Shift Master needs a start time to verify this entry against the transfer.');
 }
 const portions=eligible.filter(window=>overlapsAssignment(window,start,end));
 if(!portions.length)fail('This asset was not assigned to this site during the selected shift, or the transfer time is missing. Check the completed transfer.');
 if(portions.length!==1)fail('This asset returned to this site within the same shift. Select the applicable transfer period before saving.');
 const window=portions[0];
 if((window.start!==null&&window.start>start&&window.unknownStart)||(window.end!==null&&window.end<end&&window.unknownEnd))fail('The exact transfer time is missing for this shift. Check the completed transfer.');
 return {start:Math.max(start,window.start??start),end:Math.min(end,window.end??end),assignmentStart:window.start,assignmentEnd:window.end,partial:(window.start??start)>start||(window.end??end)<end};
}

export function activityTime(bookDate,shiftStart,time){
 const stamp=indiaDateTimeEpoch(bookDate+'T'+time);
 return stamp<indiaDateTimeEpoch(bookDate+'T'+shiftStart)?stamp+day:stamp;
}

export function applyTransferPortion(data,portion){
 if(!portion)return;
 const {start,end,assignmentStart,assignmentEnd,partial}=portion;
 const lower=partial?start:assignmentStart??-Infinity;
 const upper=partial?end:assignmentEnd??Infinity;
 const range=localTimestamp(start).replace('T',' ')+' to '+localTimestamp(end).replace('T',' ');
 const fail=label=>{throw Object.assign(new Error(label+' falls outside this site’s transfer period ('+range+' IST). Split the entry at the transfer time and save each site’s portion separately.'),{status:400})};
 const clock=value=>value?activityTime(data.bookDate,data.masterShiftStart,value):null;
 const check=(a,b,label)=>{
  if(a!==null&&(a<lower||a>=upper)||b!==null&&(b<=lower||b>upper)||a!==null&&b!==null&&b<a)fail(label);
 };
 data.trips.forEach((row,i)=>check(clock(row.loadingTime),clock(row.unloadingTime),'Trip row '+(i+1)));
 (data.jobDetails||[]).forEach((row,i)=>check(row.startTime?indiaDateTimeEpoch(row.startDate+'T'+row.startTime):null,row.endTime?indiaDateTimeEpoch(row.endDate+'T'+row.endTime):null,'Job row '+(i+1)));
 (data.breakdownDetails||[]).forEach((row,i)=>check(clock(row.startTime),clock(row.endTime),'Breakdown row '+(i+1)));
 if(!partial)return;
 data.transferPeriod={start:new Date(start).toISOString(),end:new Date(end).toISOString()};
 data.scheduledHours=(end-start)/hours;
 if(data.totalWorkingHmr>data.scheduledHours+0.0005)fail('Working hours');
 if(data.manualBreakdownHours>data.scheduledHours+0.0005)fail('Breakdown hours');
 data.idleHours=data.totalWorkingHmr==null?null:Math.round((data.scheduledHours-data.totalWorkingHmr)*1000)/1000;
}

export function transferPeriodLabel(asset,draft,shift){
 if(!asset?.transferHistory?.length||!draft.bookDate||!draft.location)return '';
 const windows=assignmentWindows(asset,asset.transferHistory);
 try{
  const portion=logBookAssignment(windows,draft.location,draft.bookDate,shift?.startTime||shift?.start,draft.shiftHours);
  if(!portion?.partial)return '';
  const display=value=>localTimestamp(value).replace('T',' ');
  return 'Enter this site’s activity from '+display(portion.start)+' to '+display(portion.end)+' IST. Use the actual handover readings and save the other portion at its site.';
 }catch(error){return error.message;}
}
