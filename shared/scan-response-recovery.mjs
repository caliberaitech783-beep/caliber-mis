import {identifyCardMachine} from './scan-machine-rules.mjs';
import {tripEquipmentRequired} from './trip-card-rules.mjs';
// Adapt model formatting failures without fabricating unreadable cell contents.
export function recoverCardResponse(parsed,kind,fieldNames){
 const issues=[];
 function field(input,label){
  if(input&&['missing','unclear'].includes(input.status))return {value:null,status:input.status};
  if(input?.status==='clear'&&(typeof input.value==='string'||typeof input.value==='number'&&Number.isFinite(input.value))&&String(input.value).length>0&&String(input.value).length<=300)return {value:String(input.value),status:'clear'};
  issues.push(label+': invalid response field; check the original scan.');return {value:null,status:'unclear'};
 }
 const joinEquipment=(prefix,number,label)=>{
  const m=typeof prefix==='string'?prefix.trim():prefix;
  const n=typeof number==='number'&&Number.isSafeInteger(number)&&number>=0?String(number):typeof number==='string'?number.trim():number;
  if(m===''&&n==='')return '';
  const validPrefix=typeof m==='string'&&/^[A-Z][A-Z ._-]*$/i.test(m),validNumber=typeof n==='string'&&/^\d+$/.test(n);
  if(!validNumber)issues.push(label+': equipment number missing or unreadable; re-read the NO column.');
  if(!validPrefix)issues.push(label+': equipment fleet prefix missing or unreadable; re-read the M column.');
  if(prefix===null||number===null)return null;
  return validPrefix&&validNumber?m+n:validPrefix?m:validNumber?n:null;
 };
 const missingNumber=(value,label)=>{const machine=identifyCardMachine(value,'trip-body',{allowSuffix:true});if(machine&&!machine.hasNumber)issues.push(label+': equipment number missing or unreadable; re-read the NO column.');};
 const fields=Object.fromEntries(fieldNames.map(name=>[name,field(parsed.fields?.[name],name)]));
 const summary=parsed.fields?.machineSummary??parsed.machineSummary;
 if(!Array.isArray(summary)||summary.length>40){issues.push('Machine summary: invalid response table; check and enter the summary from the scan.');fields.machineSummary=[];}
 else fields.machineSummary=summary.map((row,i)=>{
  const label='Summary row '+(i+1);
  let equipmentName;
  if(row&&typeof row==='object'&&!Array.isArray(row)&&('equipmentType' in row||'equipmentNumber' in row)){
   const type=field(row.equipmentType,label+' M'),number=field(row.equipmentNumber,label+' NO');
   const value=joinEquipment(type.value,number.value,label);
   equipmentName=type.status==='clear'&&number.status==='clear'&&value?{value,status:'clear'}:{value:null,status:'unclear'};
  }else equipmentName=field(row?.equipmentName,label+' equipment');
  if(equipmentName.value)missingNumber(equipmentName.value,label);
  return {equipmentName,tripCount:field(row?.tripCount,label+' trips')};
 });
 if(kind==='equipment'&&fields.machineSummary.length){issues.push('Job Card response contains an unexpected vehicle summary.');fields.machineSummary=[];}
 let rows=parsed.trips?.r;
 if(!Array.isArray(rows)||rows.length>120){issues.push('Trip table: invalid response or more than 120 rows; check the complete original table.');rows=[];}
 if(kind==='equipment'&&rows.length){issues.push('Job Card response contains unexpected vehicle trips.');rows=[];}
 const trips={p:kind==='vehicle'&&parsed.trips?.p===true,r:rows.map((entry,index)=>{
  const label='Trip row '+(index+1);
  let row=Array.isArray(entry)?entry:entry&&typeof entry==='object'?('equipmentType' in entry||'equipmentNumber' in entry?[entry.rowNumber??entry.tripNo,entry.equipmentType,entry.equipmentNumber,entry.loadingTime,entry.unloadingTime]:[entry.rowNumber??entry.tripNo,entry.equipmentName,entry.loadingTime,entry.unloadingTime]):[];
  if(row.length===5)row=[row[0],joinEquipment(row[1],row[2],label),row[3],row[4]];
  if(typeof row[1]==='string')missingNumber(row[1],label);
  if(row.length!==4)issues.push(label+': expected four cells; inspect all cells against the original scan.');
  const number=typeof row[0]==='string'&&/^\d{1,3}$/.test(row[0])?Number(row[0]):row[0];
  // Printed trip serials are fixed row positions on the card. OCR may miss or repeat
  // the tiny serial column, so row order is the reliable fallback and must not block saving.
  const validNumber=Number.isInteger(number)&&number>=1&&number<=120;
  return [validNumber?number:index+1,...[1,2,3].map((cell)=>{
   const value=row[cell];if(value===null||typeof value==='string'&&value.length<=100)return value;
   if(cell===1&&typeof value==='number'&&Number.isFinite(value)){issues.push(label+': equipment has no readable fleet prefix.');return String(value);}
   issues.push(label+': '+['','equipment','loading time','unloading time'][cell]+' unreadable or invalid; check the original scan.');return null;
  })];
 })};
 if(new Set(trips.r.map(row=>row[0])).size!==trips.r.length||trips.r.some((row,index)=>index>0&&row[0]!==trips.r[index-1][0]+1))trips.r=trips.r.map((row,index)=>[index+1,...row.slice(1)]);
 if(kind==='vehicle'&&parsed.trips?.p!==true)issues.push('Trip table was not clearly confirmed by the reader.');
 return {fields,trips,issues:[...new Set(issues)]};
}

// Keep the literal OCR notes, but only surface equipment issues for loading rows.
export function activeResponseRecoveryIssues(raw={},draft={}){
 return (raw.responseRecoveryIssues||[]).filter(issue=>{
  if(/printed trip number unreadable|duplicate printed numbers|trip numbering: (?:duplicate|gaps|out-of-order)/i.test(String(issue)))return false;
  const match=String(issue).match(/^Trip row (\d+): equipment\b/i);if(!match)return true;
  const index=Number(match[1])-1,source=(raw.gemini||raw.hybrid)?.trips?.r?.[index];
  const row=source?(draft.trips||[]).find((row,i)=>Number(row.rowNumber||i+1)===Number(source[0])):draft.trips?.[index];
  return !row||tripEquipmentRequired(row,draft.timeMode);
 });
}
export const responseReviewNeeded=(raw={},draft={})=>Boolean(activeResponseRecoveryIssues(raw,draft).length&&draft.responseRecoveryConfirmed!==true);
export function recoveredTripNumberIssues(raw={},draft={}){
 return {};
}
