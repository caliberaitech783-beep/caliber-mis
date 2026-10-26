import {machineSummary,machineLabel} from './trip-card-rules.mjs';
const blank=value=>value==null||String(value).trim()==='';

// Derived values are kept separate from the literal extraction in raw_fields.
export function completeScanTripDetails(input={},raw={}){
 raw=raw||{};
 const evidence=raw.gemini||raw.hybrid||{},originalRows=evidence.trips?.r||[];
 const trips=(input.trips||[]).map(row=>({...row}));
 let previous='',previousNumber=0;
 for(const [i,row] of trips.entries()){
  const number=row.rowNumber||i+1,source=originalRows.find(r=>r[0]===number);
  const populated=Boolean(row.loadingTime||row.unloadingTime||source);
  const contiguous=i===0||number===previousNumber+1;
  if(!contiguous)previous='';
  if(blank(row.equipmentName)){
   if(previous&&populated&&source?.[1]!==null&&row.equipmentName!==null){
    row.equipmentName=previous;row.equipmentSource='previous-trip-row';
   }else previous='';
  }else previous=machineLabel(row.equipmentName);
  if(blank(row.tripCount)&&populated){row.tripCount=1;row.tripCountSource='individual-trip-row';}
  previousNumber=number;
 }
 const complete=trips.length>0&&trips.every((r,i)=>!blank(r.equipmentName)&&Number.isSafeInteger(Number(r.tripCount))&&Number(r.tripCount)>0&&(i===0||(r.rowNumber||i+1)===(trips[i-1].rowNumber||i)+1));
 const calculated=complete?machineSummary(trips):[];
 let summary=(input.scanMachineSummary||[]).map(row=>({...row})),summarySource=input.scanMachineSummarySource;
 const summaryEvidence=evidence.fields?.machineSummary||[];
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
 return {...input,trips,scanMachineSummary:summary,...(summarySource?{scanMachineSummarySource:summarySource}:{})};
}
