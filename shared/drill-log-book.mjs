const text=value=>String(value??'').trim();

export function isDrillMachine(asset={}){
 const description=[asset.category,asset.equipmentCategory,asset.group,asset.equipmentGroup,asset.name,asset.equipmentName,asset.equipment,asset.type,asset.machineType,asset.make,asset.model].map(text).join(' ');
 return /\b(?:drill|drilling|drill\s*rig|blast\s*hole)\b/i.test(description);
}

export const DRILL_JOB_TYPES=['Clay Area','Hard Bench','Coal'];
export const DRILL_SHIFT_PERIODS=[{id:'day',label:'Day - 12 Hrs',hours:12},{id:'night',label:'Night - 12 Hrs',hours:12}];
export const blankDrillJob=(jobType='')=>({jobType,holes:'',holeLength:''});
export const fixedDrillJobs=()=>DRILL_JOB_TYPES.map(blankDrillJob);
export const blankDrillBreakdown=()=>({detail:'',startTime:'',endTime:'',actionTaken:'',mechanic:'',tmExecution:'',remark:''});

export function drillJobMetrics(row={},compressorHours){
 const holes=Number(row.holes),length=Number(row.holeLength),hours=Number(compressorHours);
 const validHoles=Number.isFinite(holes)&&holes>=0?holes:0;
 const validLength=Number.isFinite(length)&&length>=0?length:0;
 const totalMetrage=Math.round(validHoles*validLength*1000)/1000;
 return {
  totalMetrage,
  holesPerHour:hours>0?Math.round(validHoles/hours*1000)/1000:null,
  metersPerHour:hours>0?Math.round(totalMetrage/hours*1000)/1000:null
 };
}
