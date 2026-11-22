import {validateTripEquipment} from '../shared/trip-equipment-validation.mjs';
import {meterRuleIssues,shiftMeterIssues,kmrMeterReplaced,tripEquipmentRequired,ignoreScanLoadingWithoutEquipment} from '../shared/trip-card-rules.mjs';
import {responseReviewNeeded,recoveredTripNumberIssues} from '../shared/scan-response-recovery.mjs';
import {manualBreakdownHours} from '../shared/breakdown-hours-source.mjs';
import {validTripTime} from '../shared/vlb-trip-handover.mjs';
import {CARD_SHIFTS,machineDiscrepancies} from '../shared/trip-card-rules.mjs';
import {tripTimesOutOfOrder} from '../shared/shift-clock.mjs';
import {caliberCheckMessage,caliberNumber} from '../shared/caliber-id-check.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
// Owner, 21 Nov 2026: a trip whose unloading comes after the next trip's loading has a misread time (the scan read
// "10:07" as 16:07 on Gauri Pauni card 157). The card is held for review, with both times named as written on the draft.
export function tripOrderIssues(draft={}){
 const issues={},trips=draft.trips||[];
 for(const i of tripTimesOutOfOrder(draft))issues[`trips.${i}.unloadingTime`]=`Unloading ${String(trips[i].unloadingTime).trim()} comes after the next trip's loading ${String(trips[i+1].loadingTime).trim()}. A vehicle unloads before it loads again: check both times against the card.`;
 return issues;
}
// The line on a card whose driver or operator the scan did not fill (owner, 22 Nov 2026: the Caliber ID decides
// salary, so a number in doubt waits for a person). It says what the scan read, what Employee Master says about
// that number and what to do. The reason is worked out when the card is read (raw.caliberCheck); it is used only
// for the site it was judged at. A card read before that rule, or moved to another site, gets the short line.
export function caliberHoldMessage(raw={},kind='vehicle',location=''){
 const check=raw?.caliberCheck,read=caliberNumber(raw?.employeeCode)||String(raw?.employeeCode||'').trim().slice(0,40);
 const judgedHere=check&&(!location||canonicalSiteName(check.at)===canonicalSiteName(location));
 return (judgedHere&&caliberCheckMessage(check,kind))||(read?'Scan read '+read+'. No employee at this site has this number. Check the card.':'Caliber ID could not be read. Type the number from the card.');
}
const required=[['bookDate','Book date'],['location','Location'],['assetId','Door number'],['employeeId','Driver / operator'],['shiftId','Shift'],['shiftHours','Shift hours'],['openingHmr','Opening HMR'],['closingHmr','Closing HMR']];
export function scanFieldState(draft,key,issues){
 if(!issues[key])return '';
 const value=key.split('.').reduce((row,part)=>row?.[part],draft);
 return value==null||String(value).trim()===''||(Array.isArray(value)&&!value.length)?'missing':'invalid';
}
export function scanFieldIssues(draft={},kind='vehicle',raw={},options=null,lmv=false){
 if(kind==='vehicle')draft=ignoreScanLoadingWithoutEquipment(draft);
 const issues={...recoveredTripNumberIssues(raw,draft)};if(responseReviewNeeded(raw,draft))issues.responseRecoveryConfirmed='Check the flagged extraction issues against the original scan and confirm your corrections.';if(kind==='vehicle'&&!lmv&&raw.shiftRuleVersion===1&&!CARD_SHIFTS[draft.cardShift])issues.cardShift='Select the clearly ticked shift from the original card; I/II/III = 8 hours, Day/Night = 12 hours.';for(const key of draft.extractionReviewFields||[])if(!(['aFormNo','jobCardNo','workOrderId','bookNo'].includes(key)&&!String(draft[key]??'').trim()))issues[key]='Extracted from handwriting: check this field against the original card.';for(const key of draft.meterReviewFields||[])if(['openingKmr','closingKmr','openingHmr','closingHmr'].includes(key))issues[key]=draft.meterReviewMessages?.[key]||'Handwritten reading: compare this value with the reading table and confirm or correct it.';const fields=[...required,...(kind==='vehicle'?[['openingKmr','Opening KMR'],['closingKmr','Closing KMR']]:[])];
 for(const [key,label] of fields)if(draft[key]==null||String(draft[key]).trim()==='')issues[key]=(key==='employeeId'?(kind==='vehicle'?'Driver':'Operator'):label)+' needs checking: enter the value from the scan.';
 if(draft.bookDate&&!issues.bookDate){const day=Date.parse(draft.bookDate+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(draft.bookDate)||!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==draft.bookDate)issues.bookDate='Enter a valid book date.';}
 try{manualBreakdownHours(draft.manualBreakdownHours,draft.shiftHours);}catch(error){issues.manualBreakdownHours=error.message;}
 if(!lmv&&draft.shiftHours&&!['8','12'].includes(String(draft.shiftHours)))issues.shiftHours='Select 8 or 12 hours.';
 for(const meter of ['Hmr',...(kind==='vehicle'?['Kmr']:[])]){for(const prefix of ['opening','closing']){const key=prefix+meter;if(!issues[key]&&(!Number.isFinite(Number(draft[key]))||Number(draft[key])<0))issues[key]='Enter a valid non-negative reading.';}if(!issues['opening'+meter]&&!issues['closing'+meter]&&Number(draft['closing'+meter])<Number(draft['opening'+meter])&&!(meter==='Kmr'&&kmrMeterReplaced(draft,lmv?'lmv':kind)))issues['closing'+meter]='Closing reading must not be below opening reading.';}
 if(kind==='vehicle')for(const [i,row] of (draft.trips||[]).entries()){if(tripEquipmentRequired(row,draft.timeMode)&&!String(row.equipmentName||'').trim())issues[`trips.${i}.equipmentName`]='Enter the loading equipment.';if(!Number.isSafeInteger(Number(row.tripCount))||Number(row.tripCount)<1)issues[`trips.${i}.tripCount`]='Enter a positive whole trip count.';if(draft.timeMode!=='without')for(const key of ['loadingTime','unloadingTime'])if(row[key]?!validTripTime(row[key]):!row.loadingTime&&!row.unloadingTime)issues[`trips.${i}.${key}`]='Check the time against the scan.';}
 if(kind==='vehicle'&&!lmv&&draft.timeMode!=='without')for(const [key,message] of Object.entries(tripOrderIssues(draft)))issues[key]||=message;
 if(options){for(const [field,collection,label,read]of [['assetId','assets','Equipment Master',raw.door],['employeeId','employees','Employee Master',raw.employeeCode],['shiftId','shifts','Shift Master',draft.cardShift]])if(!draft[field]){if(!options[collection]?.length)issues[field]=label+' is empty in this MIS database. Sync/import it before matching scans.';else if(read)issues[field]='Scan reads '+String(read).slice(0,80)+'; no unique '+label+' match was found. Check the reading or master record.';}}
 if(!String(draft.employeeId??'').trim()&&!(options&&!options.employees?.length))issues.employeeId=caliberHoldMessage(raw,kind,draft.location);
 if(kind==='vehicle'&&options){
  const validation=validateTripEquipment(draft,options.assets||[]);
  Object.assign(issues,validation.issues);
  const summaryIssues=new Set(machineDiscrepancies(validation.draft.trips,validation.draft.scanMachineSummary));
  for(const [key,message] of Object.entries(validation.issues))if(key.startsWith('scanMachineSummary.'))summaryIssues.add(message);
  if(summaryIssues.size)issues.scanMachineSummary=[...summaryIssues].join(' ');
 }
 for(const key of Object.keys(meterRuleIssues(draft,kind)))delete issues[key];
 if(kind==='vehicle')Object.assign(issues,shiftMeterIssues(draft,lmv?'lmv':kind));
 if(lmv){
  delete issues.openingHmr;
  delete issues.closingHmr;
  if(!draft.shiftId)delete issues.shiftId;
  if(!draft.cardShift)delete issues.cardShift;
 }
 return issues;
}
