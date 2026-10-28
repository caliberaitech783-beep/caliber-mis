import {validTripTime} from '../vlb-trip-handover.mjs';
import {CARD_SHIFTS,machineDiscrepancies} from '../trip-card-rules.mjs';
const required=[['bookDate','Book date'],['location','Location'],['assetId','Door number'],['employeeId','Driver / operator'],['shiftId','Shift'],['shiftHours','Shift hours'],['openingHmr','Opening HMR'],['closingHmr','Closing HMR']];
export function scanFieldState(draft,key,issues){
 if(!issues[key])return '';
 const value=key.split('.').reduce((row,part)=>row?.[part],draft);
 return value==null||String(value).trim()===''||(Array.isArray(value)&&!value.length)?'missing':'invalid';
}
export function scanFieldIssues(draft={},kind='vehicle',raw={},options=null){
 const issues={};for(const key of draft.extractionReviewFields||[])issues[key]='Extracted from handwriting: check this field against the original card.';for(const key of draft.meterReviewFields||[])if(['openingKmr','closingKmr','openingHmr','closingHmr'].includes(key))issues[key]=draft.meterReviewMessages?.[key]||'Handwritten reading: compare this value with the reading table and confirm or correct it.';const fields=[...required,...(kind==='vehicle'?[['openingKmr','Opening KMR'],['closingKmr','Closing KMR'],['aFormNo','Trip Card / A Form number']]:[['jobCardNo','Job Card number']])];
 for(const [key,label] of fields)if(draft[key]==null||String(draft[key]).trim()==='')issues[key]=(key==='employeeId'?(kind==='vehicle'?'Driver':'Operator'):label)+' needs checking: enter the value from the scan.';
 if(draft.bookDate&&!issues.bookDate){const day=Date.parse(draft.bookDate+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(draft.bookDate)||!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==draft.bookDate)issues.bookDate='Enter a valid book date.';}
 if(draft.shiftHours&&!['8','12'].includes(String(draft.shiftHours)))issues.shiftHours='Select 8 or 12 hours.';
 for(const meter of ['Hmr',...(kind==='vehicle'?['Kmr']:[])]){for(const prefix of ['opening','closing']){const key=prefix+meter;if(!issues[key]&&(!Number.isFinite(Number(draft[key]))||Number(draft[key])<0))issues[key]='Enter a valid non-negative reading.';}if(!issues['opening'+meter]&&!issues['closing'+meter]&&Number(draft['closing'+meter])<Number(draft['opening'+meter]))issues['closing'+meter]='Closing reading must not be below opening reading.';}
 if(kind==='vehicle')for(const [i,row] of (draft.trips||[]).entries()){if(!String(row.equipmentName||'').trim())issues[`trips.${i}.equipmentName`]='Enter the loading equipment.';if(!Number.isSafeInteger(Number(row.tripCount))||Number(row.tripCount)<1)issues[`trips.${i}.tripCount`]='Enter a positive whole trip count.';if(draft.timeMode!=='without')for(const key of ['loadingTime','unloadingTime'])if(row[key]?!validTripTime(row[key]):!row.loadingTime&&!row.unloadingTime)issues[`trips.${i}.${key}`]='Check the time against the scan.';}
 if(draft.cardShift&&CARD_SHIFTS[draft.cardShift]&&Number(draft.shiftHours)!==CARD_SHIFTS[draft.cardShift].hours)issues.shiftHours='The marked shift requires '+CARD_SHIFTS[draft.cardShift].hours+' hours.';
 if(options){for(const [field,collection,label,read]of [['assetId','assets','Equipment Master',raw.door],['employeeId','employees','Employee Master',raw.employeeCode],['shiftId','shifts','Shift Master',draft.cardShift],['workOrderId','workOrders','Work Contract Master','']])if(!draft[field]){if(!options[collection]?.length)issues[field]=label+' is empty in this MIS database. Sync/import it before matching scans.';else if(read)issues[field]='Scan reads '+String(read).slice(0,80)+'; no unique '+label+' match was found. Check the reading or master record.';}}
 return issues;
}
