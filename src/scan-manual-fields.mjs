import {meterRuleIssues,shiftMeterIssues} from '../shared/trip-card-rules.mjs';
import {matchCardMachine,normalizeScanEquipmentRows,scanEquipmentMatchIssues} from '../shared/scan-machine-rules.mjs';
import {isBlankHandoverIssue} from './scan-handover-review.mjs';
import {scanFieldIssues} from './scan-field-review.mjs';
import {machineDiscrepancies,machineTripTotal,tripEquipmentRequired,ignoreScanLoadingWithoutEquipment} from '../shared/trip-card-rules.mjs';
import {scanTripTimeInputs} from './scan-time-input.mjs';
import {withScannedDoor} from './scan-door-field.mjs';

export function manualScanIssues(input={},kind='vehicle',raw={},options=null,lmv=false){
 if(kind==='vehicle')input=ignoreScanLoadingWithoutEquipment(input);
 const draft=normalizeScanEquipmentRows({...withScannedDoor(input,raw,kind),...(raw?.machineNotation?.version===1?{machineNotationRuleVersion:1}:{}),trips:scanTripTimeInputs(input.trips)},options?.assets||[]);
 // A generic "check extracted handwriting" marker does not mean a value needs
 // typing. Keep actual missing/invalid values and specific conflicts visible.
 const issues=scanFieldIssues({...draft,extractionReviewFields:[],meterReviewFields:[]},kind,raw,options,lmv);
 if(!String(draft.doorText||'').trim())issues.doorText='Enter the door number from the card.';
 if(kind==='vehicle'&&raw.provider==='gemini'&&Array.isArray(options?.assets)&&draft.doorText&&draft.assetId){
  const {match,status}=matchCardMachine(options.assets,draft.doorText,draft.location,kind);
  if(status!=='matched'||String(match.id)!==String(draft.assetId))issues.doorText||='The door number must uniquely match the linked vehicle in Equipment Master for this site.';
 }
 for(const key of draft.meterReviewFields||[])if(draft.meterReviewMessages?.[key])issues[key]=draft.meterReviewMessages[key];
 if(options)for(const [key,collection,label]of [['assetId','assets','Linked equipment'],['employeeId','employees','Driver / operator'],['shiftId','shifts','Shift']]){
  if(draft[key]&&Array.isArray(options[collection])&&!options[collection].some(row=>String(row.id)===String(draft[key])))issues[key]=label+' is not available in the current master list.';
 }
 if(kind==='vehicle'){
  if(options)Object.assign(issues,scanEquipmentMatchIssues(draft,options.assets||[]));
  const summary=draft.scanMachineSummary||[];
  if(!summary.length&&machineTripTotal(draft.trips||[])>0||summary.some(r=>!String(r.equipmentName||'').trim()||!Number.isSafeInteger(Number(r.tripCount))||Number(r.tripCount)<1))issues.scanMachineSummary='Check the printed machine summary.';
  if(machineDiscrepancies(draft.trips||[],summary).length){issues.scanMachineSummary='Detail trips conflict with the printed summary.';for(const [i,row]of draft.trips.entries())if(tripEquipmentRequired(row,draft.timeMode))issues[`trips.${i}.equipmentName`]='Check the machine assignment against the summary.';}
  if((draft.extractionReviewFields||[]).includes('trips'))for(const reason of raw.tripGridIssues||[]){
   const number=reason.match(/^Trip (\d+):/),i=number?draft.trips.findIndex((r,index)=>(r.rowNumber||index+1)===Number(number[1])):-1;
   if(i>=0){if(draft.trips[i].equipmentSource==='previous-trip-row'&&/ambiguous or unreadable machine/.test(reason))continue;const key=/unloading/i.test(reason)?'unloadingTime':/loading/i.test(reason)?'loadingTime':'equipmentName';if(key==='equipmentName'&&!tripEquipmentRequired(draft.trips[i],draft.timeMode)||isBlankHandoverIssue(draft.trips[i],i,key,raw,reason))continue;issues[`trips.${i}.${key}`]=reason;}
  }
 }
 for(const key of Object.keys(meterRuleIssues(draft,kind)))delete issues[key];
 if(kind==='vehicle')Object.assign(issues,shiftMeterIssues(draft,lmv?'lmv':kind));
 if(lmv){
  delete issues.openingHmr;
  delete issues.closingHmr;
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

