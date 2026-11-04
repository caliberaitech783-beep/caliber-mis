export const MANUAL_ROW_LIMIT=300;
export const blankJob=()=>({jobType:'',tripCount:'',uom:'',startDate:'',startTime:'',endDate:'',endTime:'',remark:''});
export const blankBreakdown=()=>({detail:'',startTime:'',endTime:'',actionTaken:'',mechanic:'',tmExecution:'',remark:''});
export const emptyManualRow=row=>Object.values(row||{}).every(value=>value==null||String(value).trim()==='');
export function padManualRows(rows,count,blank){return [...(rows||[]).map(row=>({...row})),...Array.from({length:Math.max(0,count-(rows||[]).length)},blank)];}
const fail=message=>{throw Object.assign(new Error(message),{status:400})};
const text=(value,max=500)=>String(value??'').trim().slice(0,max);
const clock=value=>/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function jobDurationHours(row){
 if(!date(row.startDate)||!date(row.endDate)||!clock(row.startTime)||!clock(row.endTime))return null;
 const hours=(Date.parse(row.endDate+'T'+row.endTime+'Z')-Date.parse(row.startDate+'T'+row.startTime+'Z'))/3600000;
 return hours>=0?Math.round(hours*1000)/1000:null;
}
const list=(value,label)=>{if(!Array.isArray(value)||value.length>MANUAL_ROW_LIMIT||value.some(r=>!r||typeof r!=='object'||Array.isArray(r)))fail(label+' must be a list of up to 300 rows.');return value.filter(row=>!emptyManualRow(row));};
export function normalizeManualDetails(input={},kind='vehicle'){
 const result={};
 if(kind==='equipment'&&input.jobDetails!==undefined)result.jobDetails=list(input.jobDetails,'Job details').map((r,i)=>{
  const row=Object.fromEntries(Object.keys(blankJob()).map(k=>[k,text(r[k],k==='remark'?2000:500)]));
  if(!row.jobType)fail('Enter the job type in job row '+(i+1)+'.');
  if(row.tripCount!==''&&(!Number.isSafeInteger(Number(row.tripCount))||Number(row.tripCount)<0))fail('Job trips must be a non-negative whole number.');
  if(row.tripCount!=='')row.tripCount=Number(row.tripCount);
  const hasTimes=[row.startDate,row.startTime,row.endDate,row.endTime].some(Boolean),durationHours=jobDurationHours(row);
  if(hasTimes&&durationHours===null)fail('Enter valid start/end dates and times in job row '+(i+1)+'; the end must follow the start.');
  return {...row,durationHours};
 });
 if(input.breakdownDetails!==undefined)result.breakdownDetails=list(input.breakdownDetails,'Breakdown details').map((r,i)=>{
  const row=Object.fromEntries(Object.keys(blankBreakdown()).map(k=>[k,text(r[k],2000)]));
  if(!row.detail)fail('Enter the breakdown detail in row '+(i+1)+'.');
  if((row.startTime||row.endTime)&&(!clock(row.startTime)||!clock(row.endTime)))fail('Enter both valid breakdown times in row '+(i+1)+'.');
  return row;
 });
 if(input.manualAttributes!==undefined)result.manualAttributes=list(input.manualAttributes,'Attributes').map(r=>({name:text(r.name),value:text(r.value,2000)}));
 if(input.manualAttachments!==undefined){
  if(!Array.isArray(input.manualAttachments)||input.manualAttachments.length>3)fail('Attach up to 3 PDF or image files.');
  let total=0;
  result.manualAttachments=input.manualAttachments.map(r=>{
   if(!r||typeof r!=='object'||typeof r.data!=='string')fail('Invalid log book attachment.');
   const match=r.data.match(/^data:(application\/pdf|image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/);
   if(!match||match[2].length%4!==0)fail('Attach a PDF, PNG or JPEG file.');
   const bytes=Buffer.from(match[2],'base64');total+=bytes.length;
   const valid=match[1]==='application/pdf'?bytes.subarray(0,5).toString()==='%PDF-':match[1]==='image/png'?bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a':bytes.subarray(0,3).toString('hex')==='ffd8ff';
   if(!valid||bytes.length>1048576||total>2097152)fail('Attachments must be valid PDF/images, up to 1 MB each and 2 MB in total.');
   return {name:text(r.name,180).replace(/[\\/\x00-\x1f]/g,'_')||'attachment',type:match[1],size:bytes.length,data:r.data};
  });
 }
 for(const key of ['projectName','provisionalVoucherNo'])if(input[key]!==undefined)result[key]=text(input[key]);
 if(input.openingEngineHmr!==undefined||input.closingEngineHmr!==undefined){
  const a=input.openingEngineHmr,b=input.closingEngineHmr;
  if(a!==''&&a!=null||b!==''&&b!=null){if(a==null||b==null||a===''||b===''||!Number.isFinite(Number(a))||!Number.isFinite(Number(b))||Number(a)<0||Number(b)<Number(a))fail('Enter valid opening and closing R engine readings.');result.openingEngineHmr=Number(a);result.closingEngineHmr=Number(b);result.totalEngineHmr=Math.round((Number(b)-Number(a))*1000)/1000;}
 }
 return result;
}
