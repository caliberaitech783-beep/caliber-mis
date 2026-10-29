// Adapt model formatting failures without fabricating unreadable cell contents.
export function recoverCardResponse(parsed,kind,fieldNames){
 const issues=[];
 function field(input,label){
  if((typeof input==='string'&&input.length>0&&input.length<=300)||(typeof input==='number'&&Number.isFinite(input))){issues.push(label+': response omitted its clarity status; verify the literal value.');return {value:String(input),status:'clear'};}
  if(input&&['missing','unclear'].includes(input.status))return {value:null,status:input.status};
  if(input?.status==='clear'&&(typeof input.value==='string'||typeof input.value==='number'&&Number.isFinite(input.value))&&String(input.value).length>0&&String(input.value).length<=300)return {value:String(input.value),status:'clear'};
  issues.push(label+': invalid response field; check the original scan.');return {value:null,status:'unclear'};
 }
 const fields=Object.fromEntries(fieldNames.map(name=>[name,field(parsed.fields?.[name],name)]));
 const summary=parsed.fields?.machineSummary;
 if(!Array.isArray(summary)||summary.length>40){issues.push('Machine summary: invalid response table; check and enter the summary from the scan.');fields.machineSummary=[];}
 else fields.machineSummary=summary.map((row,i)=>({equipmentName:field(row?.equipmentName,'Summary row '+(i+1)+' equipment'),tripCount:field(row?.tripCount,'Summary row '+(i+1)+' trips')}));
 if(kind==='equipment'&&fields.machineSummary.length){issues.push('Job Card response contains an unexpected vehicle summary.');fields.machineSummary=[];}
 let rows=parsed.trips?.r;
 if(!Array.isArray(rows)||rows.length>120){issues.push('Trip table: invalid response or more than 120 rows; check the complete original table.');rows=[];}
 if(kind==='equipment'&&rows.length){issues.push('Job Card response contains unexpected vehicle trips.');rows=[];}
 const trips={p:kind==='vehicle'&&parsed.trips?.p===true,r:rows.map((entry,index)=>{
  const label='Trip row '+(index+1);
  const row=Array.isArray(entry)?entry:entry&&typeof entry==='object'?[entry.rowNumber??entry.tripNo,entry.equipmentName,entry.loadingTime,entry.unloadingTime]:[];
  if(row.length!==4)issues.push(label+': expected four cells; inspect all cells against the original scan.');
  const number=typeof row[0]==='string'&&/^\d{1,3}$/.test(row[0])?Number(row[0]):row[0];
  // A positional identifier is only for presenting the review row, never OCR evidence.
  const validNumber=Number.isInteger(number)&&number>=1&&number<=120;
  if(!validNumber)issues.push(label+': printed trip number unreadable; the displayed number is a review position.');
  return [validNumber?number:index+1,...[1,2,3].map((cell)=>{
   const value=row[cell];if(value===null||typeof value==='string'&&value.length<=100)return value;
   if(cell===1&&typeof value==='number'&&Number.isFinite(value)){issues.push(label+': equipment has no readable fleet prefix.');return String(value);}
   issues.push(label+': '+['','equipment','loading time','unloading time'][cell]+' unreadable or invalid; check the original scan.');return null;
  })];
 })};
 if(kind==='vehicle'&&parsed.trips?.p!==true)issues.push('Trip table was not clearly confirmed by the reader.');
 return {fields,trips,issues};
}

export const responseReviewNeeded=(raw={},draft={})=>Boolean(raw.responseRecoveryIssues?.length&&draft.responseRecoveryConfirmed!==true);
export function recoveredTripNumberIssues(raw={},draft={}){
 if(!raw.responseRecoveryIssues?.length)return {};
 const counts=new Map();for(const row of draft.trips||[])counts.set(Number(row.rowNumber),(counts.get(Number(row.rowNumber))||0)+1);
 return Object.fromEntries((draft.trips||[]).flatMap((row,index)=>Number.isInteger(Number(row.rowNumber))&&Number(row.rowNumber)>=1&&Number(row.rowNumber)<=120&&counts.get(Number(row.rowNumber))===1?[]:[['trips.'+index+'.rowNumber','Enter the unique printed trip number (1–120) from the original scan.']]));
}
