import {scanFieldIssues} from './scan-field-review.mjs';
import {machineDiscrepancies} from '../trip-card-rules.mjs';
import {scanTripTimeInputs} from './scan-time-input.mjs';
import {withScannedDoor} from './scan-door-field.mjs';

export function manualScanIssues(input={},kind='vehicle',raw={},options=null){
 const draft={...withScannedDoor(input,raw),trips:scanTripTimeInputs(input.trips)};
 // A generic "check extracted handwriting" marker does not mean a value needs
 // typing. Keep actual missing/invalid values and specific conflicts visible.
 const issues=scanFieldIssues({...draft,extractionReviewFields:[],meterReviewFields:[]},kind,raw,options);
 if(!String(draft.doorText||'').trim())issues.doorText='Enter the door number from the card.';
 for(const key of draft.meterReviewFields||[])if(draft.meterReviewMessages?.[key])issues[key]=draft.meterReviewMessages[key];
 if(options)for(const [key,collection,label]of [['assetId','assets','Linked equipment'],['employeeId','employees','Driver / operator'],['shiftId','shifts','Shift'],['workOrderId','workOrders','Work Order']]){
  if(draft[key]&&Array.isArray(options[collection])&&!options[collection].some(row=>String(row.id)===String(draft[key])))issues[key]=label+' is not available in the current master list.';
 }
 if(kind==='vehicle'){
  const summary=draft.scanMachineSummary||[];
  if(!summary.length||summary.some(r=>!String(r.equipmentName||'').trim()||!Number.isSafeInteger(Number(r.tripCount))||Number(r.tripCount)<1))issues.scanMachineSummary='Check the printed machine summary.';
  if(machineDiscrepancies(draft.trips||[],summary).length){issues.scanMachineSummary='Detail trips conflict with the printed summary.';for(const [i]of draft.trips.entries())issues[`trips.${i}.equipmentName`]='Check the machine assignment against the summary.';}
  if((draft.extractionReviewFields||[]).includes('trips'))for(const reason of raw.tripGridIssues||[]){
   const number=reason.match(/^Trip (\d+):/),i=number?draft.trips.findIndex((r,index)=>(r.rowNumber||index+1)===Number(number[1])):-1;
   if(i>=0){if(draft.trips[i].equipmentSource==='previous-trip-row'&&/ambiguous or unreadable machine/.test(reason))continue;const key=/unloading/i.test(reason)?'unloadingTime':/loading/i.test(reason)?'loadingTime':'equipmentName';issues[`trips.${i}.${key}`]=reason;}
  }
 }
 return issues;
}

// Visibility is separate from the complete draft sent to the existing save API.
// Retain visible fields during edits/autosave so inputs do not vanish mid-entry.
export function retainManualFields(previous,key,issues){
 const fields=previous?.key===key?new Set(previous.fields):new Set();
 for(const name of Object.keys(issues))fields.add(name);
 return {key,fields};
}
