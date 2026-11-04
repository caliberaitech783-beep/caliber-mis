export function manualBreakdownHours(value,shiftHours){
 if(value===undefined||value===null||value==='')return null;
 if(!['number','string'].includes(typeof value)||typeof value==='string'&&!value.trim()||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>Number(shiftHours))throw Object.assign(new Error('Manual BD hours must be between 0 and the selected shift hours.'),{status:400});
 return Math.round(Number(value)*1000)/1000;
}

export async function applyBreakdownHours(data,{readHours,actor='',now=()=>new Date().toISOString()}={}){
 const manual=manualBreakdownHours(data.manualBreakdownHours,data.shiftHours);
 try{
  if(!readHours)throw Error('Pulse breakdown connection unavailable.');
  const hours=await readHours({...data,runningHours:data.totalWorkingHmr,actor});
  if(hours?.breakdownHours===null||hours?.breakdownHours===undefined||hours?.breakdownHours===''||!Number.isFinite(Number(hours.breakdownHours))||Number(hours.breakdownHours)<0||Number(hours.breakdownHours)>data.shiftHours)throw Error('Pulse did not return valid BD hours for the selected shift.');
  Object.assign(data,{breakdownHours:Number(hours.breakdownHours),breakdownHoursSource:'pulse',manualBreakdownHours:null,hoursSource:hours});
  delete data.hoursWarning;
 }catch(error){
  data.breakdownHours=manual;data.breakdownHoursSource=manual===null?null:'manual';data.hoursWarning=error.message||'Pulse breakdown hours unavailable.';
  data.hoursSource=manual===null?null:{source:'manual',breakdownHours:manual,enteredBy:actor,enteredAt:now(),bookDate:data.bookDate,location:data.location,assetId:data.assetId,shiftId:data.shiftId,shiftHours:data.shiftHours,availabilityHours:data.availabilityHours,runningHours:data.totalWorkingHmr,idleHours:data.idleHours};
 }
 return data;
}
