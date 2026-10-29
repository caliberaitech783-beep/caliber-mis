import {identifyCardMachine,normalizeScanEquipmentRows,compactScanEquipmentReferences} from './scan-machine-rules.mjs';
import {matchesEmployeeReference} from './employee-identity.mjs';
import {employeeAtLocation} from './log-book-access.mjs';
import {linkedScanEquipment} from './scan-fleet-door.mjs';
import {resolveTripGrid} from './trip-row-vision.mjs';
import {matchScannedSite,hasDchLocation,tripCardLocation} from './scan-site-match.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {assetBookKind} from './log-book.mjs';
import {CARD_SHIFTS,normalizeCardShift,markedShiftEvidence,matchingWorkOrders,selectedMasterShift,tripClockForShift,latestWorkOrder} from './trip-card-rules.mjs';
const key=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const one=(rows,predicate)=>{const found=rows.filter(predicate);return found.length===1?found[0]:null};
export const scanEquipmentMasters=masters=>masters.filter(r=>r.master_name==='Equipment master'&&assetBookKind(r.record_data)==='equipment').map(r=>({...r.record_data,id:String(r.id),kind:'equipment',site:r.record_data.currentLocation||r.record_data.site||r.record_data.location||''}));
export function extractCard(text,kind,masters=[],hints={}){
 text=String(text||'');const pick=pattern=>{const m=text.match(new RegExp('(?:^|\\n|\\b)(?:'+pattern+')[ \t]*(?:[:=#][ \t]*|[ \t]+)([^\\n]+)','i'));return m?.[1]?.split(/\b(?:CALIBER\s*ID|FORM\s*A|TRIP\s+CARD|DRIVER\s*NAME|DOOR\s*NO\.?)\b/i)[0]?.trim()||'';};
 const numeric=pattern=>{const raw=pick(pattern).replaceAll(',','');return /^\d+(?:\.\d+)?$/.test(raw)?raw:''};
 const rawDate=(hints.handwritingCandidates?.bookDate?.conflict||(hints.provider==='paddleocr'&&hints.handwritingCandidates?.bookDate&&!hints.handwrittenFields?.bookDate))?'':hints.handwrittenFields?.bookDate||pick('book date|date'),m=rawDate.match(/^(\d{1,2})[-/.\s]+(\d{1,2})[-/.\s]+(\d{4}|\d{2})\b/);
 const parsed=/^\d{4}-\d{2}-\d{2}$/.test(rawDate)?rawDate:m?`${m[3].length===2?'20'+m[3]:m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:'';
 const validDate=parsed&&Number.isFinite(Date.parse(parsed+'T00:00:00Z'))&&new Date(parsed+'T00:00:00Z').toISOString().slice(0,10)===parsed,bookDate=validDate?parsed:'';
 const raw={door:pick('door(?:\\s*(?:no\\.?|number))?|vehicle(?:\\s*(?:no\\.?|number))?|equipment(?:\\s*(?:no\\.?|number))?'),location:pick('location|site'),employee:pick('driver(?: name)?|operator(?: name)?'),employeeCode:hints.employeeCode||pick('caliber id|c\\.?\\s*id|employee id|emp(?:loyee)? code'),shift:pick('shift'),workOrder:pick('wo\\.?\\s*cont\\.?|work order(?: no\\.?)?|contract'),cardNo:pick('form a|a form(?: no\\.?)?')||pick('trip card(?: no\\.?)?|job card(?: no\\.?)?|card(?: no\\.?)?|a form(?: no\\.?)?|form a')};
 raw.employeeCode=String(raw.employeeCode||'').trim().toUpperCase();
 if(!raw.employeeCode&&/^(?:(?:CMPL|CMLL)[\s/-]*)?\d+$/i.test(raw.employee||''))raw.employeeCode=String(raw.employee).trim().toUpperCase();
 if(hints.cardNumber)raw.cardNo=String(hints.cardNumber);
 if(/\b(?:S\.?\s*N|INT|JNT)\b/i.test(raw.cardNo)||!/^[-A-Z0-9/]{1,40}$/i.test(raw.cardNo))raw.cardNo='';
 for(const field of ['door','location'])if(hints.handwrittenFields?.[field])raw[field]=hints.handwrittenFields[field];
 const locationReadings=[raw.location,hints.handwritingCandidates?.location?.text,hints.handwritingCandidates?.location?.alternateText].filter(Boolean);
 const matchedSite=matchScannedSite(locationReadings,masters.map(r=>r.record_data.currentLocation||r.record_data.site||r.record_data.location||''));
 const locationNeedsReview=!matchedSite&&(hasDchLocation(locationReadings)||Boolean(hints.handwritingCandidates?.location&&!hints.handwritingCandidates.location.value));
 if(matchedSite)raw.location=matchedSite;
 const assets=masters.filter(r=>r.master_name==='Equipment master'&&assetBookKind(r.record_data)===kind);
 const doorAssets=locationNeedsReview?[]:raw.location?assets.filter(r=>{const site=r.record_data.currentLocation||r.record_data.site||r.record_data.location;return !site||canonicalSiteName(site)===canonicalSiteName(raw.location)}):assets;
 const linked=linkedScanEquipment(doorAssets.map(r=>({...r.record_data,id:r.id,kind,site:r.record_data.currentLocation||r.record_data.site||r.record_data.location||''})),raw.door,'',kind);const asset=linked?doorAssets.find(r=>r.id===linked.id):null;
 const assetSite=asset?.record_data.currentLocation||asset?.record_data.site||asset?.record_data.location||'';const knownSite=masters.map(r=>r.record_data.currentLocation||r.record_data.site||r.record_data.location||'').find(s=>raw.location&&canonicalSiteName(s)===canonicalSiteName(raw.location));const location=locationNeedsReview?'':raw.location?(assetSite&&canonicalSiteName(assetSite)===canonicalSiteName(raw.location)?assetSite:knownSite||raw.location):assetSite;
 const employees=masters.filter(r=>['C-Dir Employee master','ERP Employee master','Employee master'].includes(r.master_name)&&employeeAtLocation(r.record_data,location));
 const matchingEmployee=r=>raw.employeeCode?matchesEmployeeReference(r.record_data,raw.employeeCode):raw.employee&&key(r.record_data.name||r.record_data.employee)===key(raw.employee);
 const imported=employees.filter(r=>r.master_name==='Employee master'),importMatches=imported.filter(matchingEmployee);
 const employee=importMatches.length===1?importMatches[0]:importMatches.length?null:one(employees.filter(r=>r.master_name!=='Employee master'),matchingEmployee);
 const shiftEvidence=markedShiftEvidence(text),textShift=shiftEvidence.value,hintShift=normalizeCardShift(hints.cardShift),shiftUnclear=shiftEvidence.status==='unclear'||(hints.shiftSelectionStatus&&hints.shiftSelectionStatus!=='clear')||Boolean(hintShift&&textShift&&hintShift!==textShift),cardShift=shiftUnclear?'':hintShift||textShift,mapped=selectedMasterShift(masters.filter(r=>r.master_name==='Shift Master').map(r=>({...r.record_data,id:r.id})),location,cardShift,bookDate);
 const shift=mapped?mapped:!cardShift&&raw.shift?one(masters,r=>r.master_name==='Shift Master'&&canonicalSiteName(r.record_data.site||r.record_data.siteName)===canonicalSiteName(location)&&key(r.record_data.shiftName||r.record_data.name||r.record_data.shift)===key(raw.shift)):null;
 const orders=masters.filter(r=>['Work Order master','Work order master','Work Order Master','WO master'].includes(r.master_name)).map(r=>({...r.record_data,id:r.id}));const eligible=matchingWorkOrders(orders,location,bookDate),wo=raw.workOrder?one(eligible,r=>key(r.workOrderNo)===key(raw.workOrder)):latestWorkOrder(orders,location,bookDate);
 const [detailText,summaryText='']=text.split(/MACHINE[ -]*WISE\s+SUMMARY/i);const trips=[];
 for(const originalLine of detailText.split('\n')){const line=compactScanEquipmentReferences(originalLine).replace(/(\b\d{1,2}\s+)([A-Z]{1,5})\s+(\d+)(?=\s+\d{1,2}[ \t]*[:.][ \t]*\d{1,2})/gi,'$1$2$3');let found=false;for(const m of line.matchAll(/(?:^|\s)(\d{1,2})\s+([A-Z]*-?\d+)\s+(\d{1,2}[ \t]*[:.][ \t]*\d{1,2})\s+(\d{1,2}[ \t]*[:.][ \t]*\d{1,2})(?=\s|$)/gi)){const clock=s=>tripClockForShift(s,cardShift,mapped||shift?.record_data);trips.push({rowNumber:Number(m[1]),equipmentName:String(m[2]).trim().toUpperCase(),loadingTime:clock(m[3]),unloadingTime:clock(m[4]),tripCount:1});found=true;}if(!found){const after=line.match(/^\s*(\d{1,2})\s+(\d{1,2}[ \t]*[:.][ \t]*\d{1,2})\s+(\d{1,2}[ \t]*[:.][ \t]*\d{1,2})\s+([A-Z]{1,5})\s*-?\s*(\d+)(?:\s+(\d+))?\s*$/i);if(after){trips.push({rowNumber:Number(after[1]),equipmentName:(after[4]+after[5]).toUpperCase(),loadingTime:tripClockForShift(after[2],cardShift,mapped||shift?.record_data),unloadingTime:tripClockForShift(after[3],cardShift,mapped||shift?.record_data),tripCount:after[6]?Number(after[6]):1});found=true;}}if(!found){const m=line.match(/^\s*([A-Z][A-Z0-9-]{1,24})\s+(\d{1,2}[ \t]*[:.][ \t]*\d{1,2})\s+(\d{1,2}[ \t]*[:.][ \t]*\d{1,2})\s+(\d+)\s*$/i);if(m)trips.push({equipmentName:String(m[1]).trim().toUpperCase(),loadingTime:tripClockForShift(m[2],cardShift,mapped||shift?.record_data),unloadingTime:tripClockForShift(m[3],cardShift,mapped||shift?.record_data),tripCount:Number(m[4])})}}
 const hasTimes=detailText.split('\n').some(line=>/^\s*\d{1,2}\s/.test(line)&&/\b\d{1,2}[ \t]*[:.][ \t]*\d{1,2}\b/.test(line));
 if(!trips.length){for(const line of detailText.split('\n')){const m=compactScanEquipmentReferences(line).match(/^\s*(\d{1,2})\s+([A-Z]{1,5})\s*(?:-\s*)?(\d+)\s*(\d+)?\s*$/i);if(m)trips.push({rowNumber:Number(m[1]),equipmentName:(m[2]+m[3]).toUpperCase(),loadingTime:'',unloadingTime:'',tripCount:m[4]?Number(m[4]):1});}}
 const timeMode=trips.some(r=>r.loadingTime||r.unloadingTime)?'with':hasTimes?'with':'without';
 trips.sort((a,b)=>(a.rowNumber||0)-(b.rowNumber||0));
 const scanMachineSummary=[];for(const summaryLine of summaryText.split(/SUPERVISOR|DRIVER SIGN|KM per Trip/i)[0].split('\n'))for(const m of compactScanEquipmentReferences(summaryLine).replace(/(\b[1-6]\s+)([A-Z]{1,5})\s+(\d+)(?=\s+\d+)/gi,'$1$2$3').matchAll(/(?:^|\s)([1-6])\s+([A-Z]*-?\d+)\s+(\d+)(?=\s|$)/gi))scanMachineSummary.push({equipmentName:String(m[2]).trim().toUpperCase(),tripCount:Number(m[3])});
 const tableMeter=type=>{const line=detailText.match(new RegExp('(?:^|\\n)\\s*'+type+'\\s*(?:\\([^)]*\\))?\\s*[:|]?\\s*(\\d+(?:[.,]\\d+)?)\\s+[|]?\\s*(\\d+(?:[.,]\\d+)?)','i'));return line?[line[1].replace(',','.'),line[2].replace(',','.')]:['','']};const km=tableMeter('KMR'),hm=tableMeter('(?:HMR|HMT)');
 const out={raw:{...raw,provider:hints.provider||'local',model:hints.model||'TrOCR small handwritten',handwritingCandidates:hints.handwritingCandidates||{},extractionWarning:hints.extractionWarning||'',cardShift,shiftDetection:hints.shiftDetection||'OCR marked text',meterReadings:hints.meterReadings||{},dateSource:validDate?'scan':'scan-unreadable'},draft:{doorText:raw.door||'',meterReviewFields:Object.keys(hints.meterReadings||{}),docType:kind==='vehicle'?'VLB':'ELB',bookDate,bookDateSource:validDate?'scan':'scan-unreadable',location,assetId:asset?String(asset.id):'',employeeId:employee?String(employee.id):'',shiftId:shift?String(shift.id):'',cardShift,workOrderId:wo?String(wo.id):'',shiftHours:CARD_SHIFTS[cardShift]?.hours||(/^12\s*(?:hours?|hrs?)?$/i.test(pick('shift hours?|shift hrs?'))?12:/^8\s*(?:hours?|hrs?)?$/i.test(pick('shift hours?|shift hrs?'))?8:''),openingKmr:hints.meterReadings?.openingKmr?.value||km[0]||numeric('opening (?:reading[ (]*)?(?:kmr|km)\\)?|opening kmr'),closingKmr:hints.meterReadings?.closingKmr?.value||km[1]||numeric('closing (?:reading[ (]*)?(?:kmr|km)\\)?|closing kmr'),openingHmr:hints.meterReadings?.openingHmr?.value||hm[0]||numeric('opening (?:reading[ (]*)?(?:hmr|hour|hours)\\)?|opening hmr'),closingHmr:hints.meterReadings?.closingHmr?.value||hm[1]||numeric('closing (?:reading[ (]*)?(?:hmr|hour|hours)\\)?|closing hmr'),aFormNo:kind==='vehicle'?raw.cardNo:'',jobCardNo:kind==='equipment'?raw.cardNo:'',remark:pick('remarks?'),timeMode,trips,scanMachineSummary}};
 for(const key of ['openingKmr','closingKmr','openingHmr','closingHmr'])if(hints.handwritingCandidates?.[key]&&!hints.handwritingCandidates[key].value)out.draft[key]='';
 out.draft.extractionReviewFields=[];for(const [source,target]of [['bookDate','bookDate'],['door','assetId'],['employeeCode','employeeId'],['location','location']])if(hints.handwrittenFields?.[source])out.draft.extractionReviewFields.push(target);
 if(hints.cardNumber&&hints.provider==='paddleocr')out.draft.extractionReviewFields.push(kind==='vehicle'?'aFormNo':'jobCardNo');
 if(hints.tripGrid){const grid=resolveTripGrid(hints.tripGrid,cardShift);out.draft.trips=grid.trips;out.draft.scanMachineSummary=grid.scanMachineSummary;out.draft.timeMode=grid.timeMode;out.raw.tripGrid=hints.tripGrid;out.raw.tripGridIssues=grid.issues;out.draft.extractionReviewFields.push('trips','scanMachineSummary');}
 out.draft.meterReviewMessages=Object.fromEntries(Object.entries(hints.handwritingCandidates||{}).filter(([k,c])=>c.conflict).map(([k,c])=>[k,'Handwriting passes disagree: '+(c.alternatives||[]).join(' / ')+'. Check the original scan.']));
 out.raw.locationReadings=locationReadings;
 if(locationNeedsReview){out.raw.locationMatchIssue='Location needs checking: confirm East/West and the matching Location Master entry.';out.draft.extractionReviewFields.push('location');}
 out.raw.machineNotation={version:1,header:identifyCardMachine(raw.door,kind),headerMatchedAssetId:asset?String(asset.id):null};
 out.draft.machineNotationRuleVersion=1;
 if(kind==='vehicle'){
  out.draft=normalizeScanEquipmentRows(out.draft,scanEquipmentMasters(masters));
  out.draft.location=tripCardLocation(out.draft.location);
  out.draft.tripLocationRuleVersion=1;
  out.raw.shiftRuleVersion=1;
  out.draft.shiftRuleVersion=1;
  out.draft.shiftHours=CARD_SHIFTS[cardShift]?.hours||'';
  if(!cardShift){out.draft.shiftId='';out.draft.extractionReviewFields.push('cardShift','shiftHours');}
  out.raw.shiftSelectionStatus=cardShift?'clear':shiftUnclear?'unclear':'missing';
  out.raw.tripLocationRuleVersion=1;
 }
 return out;
}
