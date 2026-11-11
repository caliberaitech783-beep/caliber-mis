import {canonicalSiteName} from '../../shared/site-location.mjs';
import {normalizeCardShift,meterRuleIssues,machineDiscrepancies} from '../../shared/trip-card-rules.mjs';
import {manualScanIssues} from '../../src/scan-manual-fields.mjs';
import {cardMachineKey} from '../../shared/scan-machine-rules.mjs';
const present=value=>value!==null&&value!==undefined&&String(value).trim()!=='';
const groups={
 door:['doorText','assetId'],caliber:['employeeId'],hmr:['openingHmr','closingHmr'],kmr:['openingKmr','closingKmr'],
 trips:['trips','scanMachineSummary','timeMode'],date:['bookDate','bookDateSource'],site:['location'],shift:['cardShift','shiftId','shiftHours'],
};
export async function readScanWithRecovery(read,isActive=async()=>true){
 try{return await read({});}catch(error){
  if(!await isActive()||error.status&&error.status<500&&error.status!==429||/billing|api.?key|HTTP (?:400|401|402|403)|scanned on the|Invalid card type/i.test(error.message||''))throw error;
  const result=await read({forceRead:true});
  return {...result,firstScanReadRecovery:{attempted:true,recovered:true}};
 }
}
export function firstScanProblems(extracted,kind,context={}){
 const d=extracted.draft,issues=manualScanIssues(d,kind,extracted.raw),meters=meterRuleIssues(d,kind),found=[];
 if(!d.assetId||!present(d.doorText)||issues.assetId||issues.doorText)found.push('door');
 if(!d.employeeId||issues.employeeId)found.push('caliber');
 for(const [group,suffix]of [['hmr','Hmr'],...(kind==='vehicle'?[['kmr','Kmr']]:[])])if((group==='kmr'&&meters.replacementKmr)||['opening','closing'].some(prefix=>{const key=prefix+suffix;return !present(d[key])||!Number.isFinite(Number(d[key]))||issues[key]||meters[key]||d.meterReviewMessages?.[key]}))found.push(group);
 if(kind==='vehicle'&&(!(d.trips||[]).length||!(d.scanMachineSummary||[]).length||issues.scanMachineSummary||Object.keys(issues).some(key=>key.startsWith('trips.'))||machineDiscrepancies(d.trips,d.scanMachineSummary).length))found.push('trips');
 if(!d.bookDate||issues.bookDate||context.bookDate&&d.bookDate!==context.bookDate)found.push('date');
 if(!d.location||issues.location||context.location&&canonicalSiteName(d.location)!==canonicalSiteName(context.location))found.push('site');
 if(!d.shiftId||!d.cardShift||issues.shiftId||context.cardShift&&normalizeCardShift(d.cardShift)!==normalizeCardShift(context.cardShift))found.push('shift');
 return found;
}
// One fresh read for all problem groups together, before the card enters review.
export async function recoverFirstScanFields({kind,extracted,context={},allowMissingSite=false,alreadyRetried=false,readAgain,extract,onProgress}){
 const detectedProblems=firstScanProblems(extracted,kind,context),problems=alreadyRetried?[]:detectedProblems,verifyDoor=kind==='vehicle'&&present(extracted.draft.doorText)&&Boolean(extracted.draft.assetId);
 if((alreadyRetried&&!verifyDoor)||(!problems.length&&!verifyDoor)||!extracted.draft.location&&!allowMissingSite)return extracted;
 const recoveryGroups=[...new Set([...problems,...(verifyDoor?['door']:[])])];
 const audit={attempted:true,groups:recoveryGroups,recovered:[]};extracted.raw.firstScanFieldRecovery=audit;
 if(verifyDoor)extracted.raw.doorVerification={status:'pending',first:extracted.draft.doorText};
 if(problems.includes('door'))extracted.raw.firstScanDoorRecovery={attempted:true,originalDoor:extracted.draft.doorText||'',recovered:false};
 try{
  if(await onProgress?.('retrying',{reason:'Rechecking '+recoveryGroups.join(', ')+' against the original card',attempt:2,maxAttempts:2})===false)return extracted;
  const result=await readAgain({forceRead:true,recoveryFields:recoveryGroups}),candidate=await extract(result);
  const remaining=firstScanProblems(candidate,kind,context),site=canonicalSiteName(context.location||extracted.draft.location);
  if(!candidate.draft.location||site&&canonicalSiteName(candidate.draft.location)!==site){if(verifyDoor)extracted.raw.doorVerification={...extracted.raw.doorVerification,status:'conflict',second:candidate.draft.doorText||''};return extracted;}
  if(verifyDoor){
   const first=cardMachineKey(extracted.draft.doorText,'vehicle'),second=cardMachineKey(candidate.draft.doorText,'vehicle');
   extracted.raw.doorVerification={status:first&&second&&first===second&&candidate.draft.assetId?'confirmed':'conflict',first:extracted.draft.doorText,second:candidate.draft.doorText||''};
  }
  for(const group of problems){
   if(remaining.includes(group))continue;
   if(group==='site'){
    for(const key of ['assetId','employeeId','shiftId'])extracted.draft[key]=candidate.draft[key]||'';
   }
   for(const key of groups[group])extracted.draft[key]=structuredClone(candidate.draft[key]);
   audit.recovered.push(group);
   const rawKeys=({door:['door','machineNotation'],caliber:['employee','employeeCode'],site:['location','locationReadings','locationMatchIssue'],shift:['cardShift','shiftSelectionStatus','shiftDetection'],date:['dateSource'],trips:['tripGrid','tripGridIssues','responseRecoveryIssues']})[group]||[];
   for(const key of rawKeys){if(candidate.raw[key]!==undefined)extracted.raw[key]=structuredClone(candidate.raw[key]);else delete extracted.raw[key];}
   const evidence=group==='door'?['door']:group==='caliber'?['employeeCode']:group==='hmr'?['openingHmr','closingHmr']:group==='kmr'?['openingKmr','closingKmr']:[];
   for(const key of evidence){
    if(extracted.draft.meterReviewMessages)delete extracted.draft.meterReviewMessages[key];
    if(candidate.raw.handwritingCandidates?.[key])extracted.raw.handwritingCandidates={...extracted.raw.handwritingCandidates,[key]:candidate.raw.handwritingCandidates[key]};
    if(candidate.raw.meterReadings?.[key])extracted.raw.meterReadings={...extracted.raw.meterReadings,[key]:candidate.raw.meterReadings[key]};
   }
  }
  if(audit.recovered.includes('door'))extracted.raw.firstScanDoorRecovery={...extracted.raw.firstScanDoorRecovery,recovered:true,door:extracted.draft.doorText,assetId:extracted.draft.assetId};
  audit.remaining=firstScanProblems(extracted,kind,context);
  audit.evidence={provider:result.provider||candidate.raw.provider,fields:candidate.raw.gemini?.fields||candidate.raw.hybrid?.fields||candidate.raw.handwritingCandidates};
 }catch{audit.unavailable=true;if(verifyDoor)extracted.raw.doorVerification={...extracted.raw.doorVerification,status:'unavailable'};}
 return extracted;
}
