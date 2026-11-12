import {estimateMissingTripTimes} from './scan-trip-estimates.mjs';
import {machineSummary,machineLabel,isUnloadingOnlyTrip,tripEquipmentRequired,ignoreScanLoadingWithoutEquipment} from './trip-card-rules.mjs';
import {activeResponseRecoveryIssues} from './scan-response-recovery.mjs';
import {identifyCardMachine} from './scan-machine-rules.mjs';
const blank=value=>value==null||String(value).trim()==='';

function completeMachinesFromSummary(trips,summary,evidence={},summarySource=''){
 if(summarySource)return trips;
 const printed=(summary||[]).map((row,index)=>({row,index,machine:identifyCardMachine(row.equipmentName,'equipment',{allowSuffix:true})})).filter(item=>item.machine?.hasNumber&&evidence[item.index]?.equipmentName?.status!=='unclear');
 for(const code of new Set(printed.map(item=>item.machine.code))){
  const candidates=printed.filter(item=>item.machine.code===code);if(candidates.length!==1)continue;
  const candidate=candidates[0],expected=Number(candidate.row.tripCount);if(!Number.isSafeInteger(expected)||expected<1)continue;
  const matching=trips.map((row,index)=>({row,index,machine:identifyCardMachine(row.equipmentName,'trip-body',{allowSuffix:true})})).filter(item=>!isUnloadingOnlyTrip(item.row)&&item.machine?.code===code&&(item.machine.hasNumber?item.machine.key===candidate.machine.key:true));
  const total=matching.reduce((sum,item)=>sum+(Number(item.row.tripCount)||1),0);if(total!==expected)continue;
  for(const item of matching){if(item.row.equipmentSource==='master-selection')continue;item.row.equipmentName=candidate.machine.canonical;item.row.equipmentNotation={original:item.machine.original,resolved:candidate.machine.canonical};if(!item.machine.hasNumber)item.row.equipmentSource='machine-summary';}
 }
 return trips;
}

// Derived values are kept separate from the literal extraction in raw_fields.
export function completeScanTripDetails(input={},raw={}){
 raw=raw||{};
 input=ignoreScanLoadingWithoutEquipment(input,{openingOnly:true});
 if(activeResponseRecoveryIssues(raw,input).length)return input; // Recovered loading cells still require literal review.
 const evidence=raw.gemini||raw.hybrid||{},originalRows=evidence.trips?.r||[],summaryEvidence=evidence.fields?.machineSummary||[];
 let trips=completeMachinesFromSummary((input.trips||[]).map(row=>({...row})),input.scanMachineSummary||[],summaryEvidence,input.scanMachineSummarySource);
 let previous='',previousNumber=0,previousNotation=null;
 for(const [i,row] of trips.entries()){
  const number=row.rowNumber||i+1,source=originalRows.find(r=>r[0]===number);
  const populated=Boolean(row.loadingTime||row.unloadingTime||source);
  const contiguous=i===0||number===previousNumber+1;
  if(!contiguous){previous='';previousNotation=null;}
  if(!tripEquipmentRequired(row,input.timeMode)){previous='';previousNotation=null;}
  else if(blank(row.equipmentName)){
   if(row.equipmentSource!=='master-selection'&&previous&&populated&&source?.[1]!==null&&row.equipmentName!==null){
    row.equipmentName=previous;row.equipmentSource='previous-trip-row';
    if(previousNotation)row.equipmentNotation={...previousNotation,resolved:previous};
   }else {previous='';previousNotation=null;}
  }else {previous=machineLabel(row.equipmentName);previousNotation=row.equipmentNotation;}
  if(blank(row.tripCount)&&populated){row.tripCount=1;row.tripCountSource='individual-trip-row';}
  previousNumber=number;
 }
 trips=ignoreScanLoadingWithoutEquipment({...input,trips}).trips;
 const complete=trips.length>0&&trips.every((r,i)=>(!tripEquipmentRequired(r,input.timeMode)||!blank(r.equipmentName))&&Number.isSafeInteger(Number(r.tripCount))&&Number(r.tripCount)>0&&(i===0||(r.rowNumber||i+1)===(trips[i-1].rowNumber||i)+1));
 const calculated=complete?machineSummary(trips).map(row=>{
  const matching=trips.filter(trip=>!isUnloadingOnlyTrip(trip)&&machineLabel(trip.equipmentName)===row.equipmentName);
  const first=matching[0],notation=first?.equipmentNotation;
  if(first?.equipmentId&&matching.every(trip=>trip.equipmentSource==='master-selection'&&trip.equipmentId===first.equipmentId)){
   return {...row,equipmentId:first.equipmentId,equipmentSource:'master-selection',originalEquipmentName:first.originalEquipmentName,equipmentNotation:{...notation,resolved:row.equipmentName}};
  }
  return notation?{...row,equipmentNotation:{...notation,resolved:row.equipmentName}}:row;
 }):[];
 let summary=(input.scanMachineSummary||[]).map(row=>({...row})),summarySource=input.scanMachineSummarySource;
 const unclear=summaryEvidence.some(r=>r.equipmentName?.status==='unclear'||r.tripCount?.status==='unclear');
 if(complete&&(summarySource==='calculated-from-trips'||(!unclear&&(!summary.length||summary.every((r,i)=>blank(r.equipmentName)&&(blank(r.tripCount)||(Number(r.tripCount)===0&&summaryEvidence[i]?.tripCount?.status==='missing'))))))){
  summary=calculated;summarySource='calculated-from-trips';
 }else if(complete){
  summary=summary.map((row,i)=>{
   const source=summaryEvidence[i],next={...row};
   if(blank(next.equipmentName)&&calculated.length===1&&source?.equipmentName?.status!=='unclear')next.equipmentName=calculated[0].equipmentName;
   const match=calculated.filter(r=>machineLabel(r.equipmentName)===machineLabel(next.equipmentName));
   if((blank(next.tripCount)||(Number(next.tripCount)===0&&source?.tripCount?.status==='missing'))&&match.length===1&&source?.tripCount?.status!=='unclear'){
    next.tripCount=match[0].tripCount;next.tripCountSource='calculated-from-trips';
   }
   return next;
  });
 }
 return ignoreScanLoadingWithoutEquipment(estimateMissingTripTimes({...input,trips,scanMachineSummary:summary,...(summarySource?{scanMachineSummarySource:summarySource}:{})},raw));
}


