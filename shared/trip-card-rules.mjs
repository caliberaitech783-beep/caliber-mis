import {normalizeScannedTime,validScannedTime} from './scan-clock.mjs';
import {canonicalSiteName} from './site-location.mjs';
export function kmrMeterReplaced({openingKmr,closingKmr}={},kind='vehicle'){
 return [openingKmr,closingKmr].every(value=>/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(value??'').trim())&&Number.isFinite(Number(value)))
  && Number(closingKmr)<Number(openingKmr)
  && !kmrReadingIssue({openingKmr,closingKmr},kind);
}
export const VLB_SHIFT_KMR_LIMIT=250;
function kmrDecimalIssue({openingKmr,closingKmr}){
 const readings=[openingKmr,closingKmr].map(value=>String(value??'').trim());
 if(!readings.every(value=>/^\d+(?:\.\d+)?$/.test(value)))return '';
 const [opening,closing]=readings.map(Number);
 if(closing>=opening&&closing-opening<=VLB_SHIFT_KMR_LIMIT)return '';
 const width=Math.max(...readings.map(value=>value.split('.')[0].length));
 if(width<6||width>15)return '';
 const corrected=readings.map(value=>{
  if(value.includes('.'))return value.split('.')[0].length===width-1?value:null;
  return value.length===width?value.slice(0,-1)+'.'+value.slice(-1):null;
 });
 if(corrected.includes(null)||corrected.every((value,index)=>value===readings[index]))return '';
 const distance=Number((Number(corrected[1])-Number(corrected[0])).toFixed(3));
 if(distance<=0||distance>VLB_SHIFT_KMR_LIMIT)return '';
 return `Possible dropped decimal in KMR readings. Check opening ${corrected[0]} and closing ${corrected[1]} on the original card (${distance} km if confirmed).`;
}
function kmrIncompletePrefix({openingKmr,closingKmr}){
 const opening=String(openingKmr??'').trim(),closing=String(closingKmr??'').trim();
 if(!/^\d{5,15}(?:\.\d+)?$/.test(opening)||!/^\d+$/.test(closing))return false;
 const whole=opening.split('.')[0];
 // A partly typed closing reading can be a prefix of any plausible closing value.
 const widths=opening.includes('.')?[whole.length]:[whole.length,whole.length-1];
 return widths.some(width=>{
  if(closing.length>=width)return false;
  const lower=Number(closing.padEnd(width,'0')),upper=Number(closing.padEnd(width,'9'));
  const start=width===whole.length?Number(opening):Number(opening)/10;
  return upper>=Math.floor(start)&&lower<=start+VLB_SHIFT_KMR_LIMIT;
 });
}
function kmrReadingIssue(draft,kind='vehicle'){
 const decimal=kind==='vehicle'?kmrDecimalIssue(draft):'';
 if(decimal)return decimal;
 const missing=kmrMissingDigitIssue(draft);
 if(missing)return missing;
 return kind==='vehicle'&&kmrIncompletePrefix(draft)?'Closing KMR appears incomplete. Enter the full reading from the original card.':'';
}
// A closing KMR one digit shorter than the opening (Jayant OC, 7 Nov 2026: 292146.5 then 29276.4)
// is a digit missed on the card or by the reader, not a new meter: putting one digit back gives a
// normal shift distance. Those full readings are returned, nearest first. A new meter starts near
// zero, so its reading is several digits shorter than a 5-digit-plus odometer and never qualifies.
export function kmrMissingDigitReadings({openingKmr,closingKmr}={}){
 const open=String(openingKmr??'').trim(),close=String(closingKmr??'').trim(),reading=/^\d+(?:\.\d+)?$/;
 if(!reading.test(open)||!reading.test(close))return [];
 const opening=Number(open),[whole,fraction]=close.split('.'),openWhole=open.split('.')[0].replace(/^0+(?=\d)/,'');
 if(!(Number(close)<opening)||openWhole.length<5||whole.replace(/^0+(?=\d)/,'').length!==openWhole.length-1)return [];
 const found=new Map();
 for(let at=0;at<=whole.length;at++)for(let digit=0;digit<=9;digit++){
  const full=whole.slice(0,at)+digit+whole.slice(at)+(fraction===undefined?'':'.'+fraction),value=Number(full);
  if(full[0]!=='0'&&value>=opening&&value-opening<=VLB_SHIFT_KMR_LIMIT)found.set(value,full);
 }
 return [...found].sort((a,b)=>a[0]-b[0]).map(([,full])=>full);
}
export function kmrMissingDigitIssue(draft={}){
 const readings=kmrMissingDigitReadings(draft);
 if(!readings.length)return '';
 const km=full=>Number((Number(full)-Number(draft.openingKmr)).toFixed(3));
 return `Closing KMR ${String(draft.closingKmr).trim()} has one digit fewer than opening KMR ${String(draft.openingKmr).trim()}: a digit is missing on the card or was misread. This is not a meter replacement. Enter the full closing reading, for example ${readings.slice(0,3).map(full=>full+' ('+km(full)+' km)').join(', ')}, or correct the opening KMR.`;
}
export function shiftMeterIssues(draft={},kind='vehicle'){
 const issues={},hours=Number(draft.shiftHours);
 // Blocks saving whatever the shift hours: below the opening and not a replacement, the
 // reading would otherwise be saved with a negative distance.
 if(kind!=='equipment'){const readingIssue=kmrReadingIssue(draft,kind);if(readingIssue)issues.closingKmr=readingIssue;}
 if(kind!=='lmv'&&![8,9,12].includes(hours))return issues;
 for(const meter of (kind==='lmv'?['Kmr']:kind==='vehicle'?['Hmr','Kmr']:['Hmr'])){
  const a=draft['opening'+meter],b=draft['closing'+meter];
  if(a==null||b==null||String(a).trim()===''||String(b).trim()==='')continue;
  const opening=Number(a),closing=Number(b),limit=meter==='Hmr'?hours:VLB_SHIFT_KMR_LIMIT;
  const replaced=meter==='Kmr'&&kmrMeterReplaced(draft,kind);
  if(!Number.isFinite(opening)||!Number.isFinite(closing)||opening<0||closing<0||(!replaced&&closing<opening))continue;
  const field=replaced?'replacementKmr':'closing'+meter;
  const actual=draft.replacementKmr;
  if(replaced&&(!['string','number'].includes(typeof actual)||String(actual).trim()===''||!Number.isFinite(Number(actual))||Number(actual)<0)){
   issues[field]='Enter the actual distance travelled in km for the KMR replacement.';
   continue;
  }
  const difference=replaced?Number(actual):closing-opening;
  if(kind!=='lmv'&&difference-limit>Number.EPSILON*(replaced?limit:Math.max(1,Math.abs(opening),Math.abs(closing)))*4){
   const format=n=>Number(n.toFixed(3)),unit=meter==='Hmr'?'hours':'km';
   const label=replaced?'Actual KMR distance':meter.toUpperCase()+' difference (closing - opening)';
   issues[field]||=`${label} is ${format(difference)} ${unit}; maximum for an ${hours}-hour shift is ${limit}. Exceeds limit by ${format(difference-limit)} ${unit}.`;
  }
 }
 return issues;
}
// Include historical meter discrepancies for review and reports.
export function meterRuleIssues(draft={},kind='vehicle'){
 const issues={...shiftMeterIssues(draft,kind)};
 for(const meter of (kind==='lmv'?['Kmr']:kind==='vehicle'?['Hmr','Kmr']:['Hmr'])){
  for(const prefix of ['opening','closing']){
   const key=prefix+meter,value=draft[key];
   if(value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)<0)issues[key]=`${prefix==='opening'?'Opening':'Closing'} ${meter.toUpperCase()} is negative.`;
  }
  const a=draft['opening'+meter],b=draft['closing'+meter];
  if(a!==null&&b!==null&&a!==undefined&&b!==undefined&&String(a).trim()!==''&&String(b).trim()!==''&&Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Number(b)<Number(a)&&!(meter==='Kmr'&&(kmrMeterReplaced(draft,kind)||kmrReadingIssue(draft,kind))))issues['closing'+meter]=`Closing ${meter.toUpperCase()} is below opening ${meter.toUpperCase()}.`;
 }
 return issues;
}
export const CARD_SHIFTS={I:{hours:8,start:'05:00',label:'I · 05:00–13:00'},II:{hours:8,start:'13:00',label:'II · 13:00–21:00'},III:{hours:8,start:'21:00',label:'III · 21:00–05:00'},Day:{hours:12,start:'',label:'Day · 12 hours'},Night:{hours:12,start:'',label:'Night · 12 hours'}};
export const systemBookDate=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function machineLabel(value){const s=String(value||'').trim().toUpperCase();return /^\d+$/.test(s)?'V'+String(Number(s)):/^V\s*-?\s*\d+$/.test(s)?'V'+String(Number(s.match(/\d+/)[0])):s;}
// An unloading-only row finishes a previous load; it is not a new
// machine loading trip. An auto-estimated loading time is not loading evidence.
export function isUnloadingOnlyTrip(row){
 const value=v=>String(v??'').trim();
 const loading=value(row.loadingTime),unloading=value(row.unloadingTime),estimate=row.timeEstimates?.loadingTime;
 const estimatedLoading=estimate&&loading===value(estimate.value)&&estimate.anchorField==='unloadingTime'&&unloading===value(estimate.anchorValue);
 return Boolean(unloading)&&(!loading||Boolean(estimatedLoading));
}
// Rule (14 Nov 2026): a trip loaded in the previous shift shows only its unloading
// time, often with a word such as "Load" in the loading cell; a trip still loading
// when the shift ends shows only its loading time. Such words and dashes mark a
// shift handover, not a time, and that half of the trip belongs to the other card.
export function isHandoverTimeMark(value){
 const text=String(value??'').trim().replace(/^["'‘’“”(]+|["'‘’“”.,;:)]+$/g,'').replace(/\s+/g,' ').trim();
 return /^(?:-+|—+|–+|_+|load(?:ed|ing)?|lod|ld|loaded in (?:previous|prev\.?|last) shift|unload(?:ed|ing)?|unld|shift (?:end|over|ended))$/i.test(text);
}
// A blank loader with a recorded unload is an unloading handover on scanned cards.
export function ignoreScanLoadingWithoutEquipment(draft,{openingOnly=false}={}){
 if(draft?.timeMode==='without'||!Array.isArray(draft?.trips))return draft;
 let changed=false;
 const trips=draft.trips.map((row,index)=>{
  if(openingOnly&&(index!==0||Number(row?.rowNumber||1)!==1))return row;
  if(row&&isHandoverTimeMark(row.loadingTime)&&validScannedTime(row.unloadingTime)){changed=true;return {...row,loadingTime:''};}
  if(row&&isHandoverTimeMark(row.unloadingTime)&&validScannedTime(row.loadingTime)){changed=true;return {...row,unloadingTime:''};}
  const estimate=row?.timeEstimates?.unloadingTime;
  const estimatedUnload=estimate?.anchorField==='loadingTime'&&estimate.value===row.unloadingTime;
  if(!row||!validScannedTime(row.unloadingTime)||estimatedUnload)return row;
  const blankLoader=!String(row.equipmentName??'').trim();
  // Older drafts could borrow a loader for the first row even when its paper loader cell was blank.
  const borrowedOpeningLoader=index===0&&Number(row.rowNumber||1)===1&&row.equipmentSource==='previous-shift'
   &&!String(row.equipmentNotation?.original??row.originalEquipmentName??'').trim();
  if(borrowedOpeningLoader){
   changed=true;
   const {equipmentId,equipmentSite,equipmentSource,equipmentNotation,equipmentProvenance,timeEstimates,...trip}=row;
   return {...trip,equipmentName:'',loadingTime:''};
  }
  if(!row.loadingTime||!blankLoader)return row;
  changed=true;
  const {timeEstimates,...trip}=row;
  return {...trip,loadingTime:''};
 });
 return changed?{...draft,trips}:draft;
}
// A previous load can finish on this card without identifying a new loader.
// Untimed aggregate rows and rows that record loading still require equipment.
export const tripEquipmentRequired=(row={},timeMode='with')=>timeMode==='without'||!isUnloadingOnlyTrip(row);
export function machineSummary(trips=[]){const map=new Map();for(const row of trips){if(isUnloadingOnlyTrip(row))continue;const equipmentName=machineLabel(row.equipmentName);if(!equipmentName)continue;map.set(equipmentName,(map.get(equipmentName)||0)+(Number(row.tripCount)||0))}return [...map].map(([equipmentName,tripCount])=>({equipmentName,tripCount}));}
export function machineTripTotal(trips=[]){return trips.reduce((total,row)=>total+(isUnloadingOnlyTrip(row)?0:Number(row.tripCount)||0),0);}
export function machineDiscrepancies(trips=[],printed=[]){
 if(!printed.length)return [];
 const actual=new Map(machineSummary(trips).map(r=>[r.equipmentName,r.tripCount])),expected=new Map(machineSummary(printed).map(r=>[r.equipmentName,r.tripCount]));
 const issues=[...new Set([...actual.keys(),...expected.keys()])].flatMap(name=>actual.get(name)===expected.get(name)?[]:[name+': detail trips '+(actual.get(name)||0)+', scanned summary '+(expected.get(name)||0)+'.']);
 const detailTotal=machineTripTotal(trips),summaryTotal=machineTripTotal(printed);
 if(detailTotal!==summaryTotal)issues.push('Total trips: detail trips '+detailTotal+', scanned summary '+summaryTotal+'. Machine summary must equal Trip Details; count each trip once.');
 return issues;
}
export const WORK_ORDER_MASTERS=['Work Order master','Work order master','Work Order Master','WO master'];
export function workOrderJobTypes(order){
 return [...new Set((Array.isArray(order.jobs)?order.jobs:[]).map(job=>String(job?.jobType||'').trim()).filter(Boolean))];
}
export function activeWorkOrders(rows,site,date){
 return matchingWorkOrders(rows,site,date).filter(r=>date&&(!r.workOrderDate||r.workOrderDate<=date)&&!['inactive','completed','closed','cancelled'].includes(String(r.status||'').trim().toLowerCase()));
}
export function matchingWorkOrders(rows,site,date){return rows.filter(r=>canonicalSiteName(r.site||r.location)===canonicalSiteName(site)&&site&&!r.sourceMissing&&(!(r.begin||r.commencementDate)||(r.begin||r.commencementDate)<=date)&&(!(r.end||r.completionDate)||(r.end||r.completionDate)>=date));}
export function normalizeCardShift(value){const code=bookShiftCode(String(value||'').replace(/\s*\([ABC]\)\s*$/i,''));return ({S1:'I',S2:'II',S3:'III',D:'Day',N:'Night'})[code]||'';}
export function markedShiftEvidence(text){
 const found=new Set(),source=String(text),token='(III|II|I|DAY|NIGHT|S[123]|[123ABC])',mark='(?:\\[\\s*[xX✓√]\\s*\\]|☑|✓|√)';
 for(const m of source.matchAll(new RegExp(mark+'\\s*'+token+'\\b','gi')))found.add(normalizeCardShift(m[1]));
 for(const m of source.matchAll(new RegExp('(?:^|\\n)\\s*'+token+'(?:\\s*\\([ABC]\\))?(?:\\s+SHIFT)?\\s*'+mark+'\\s*(?=\\n|$)','gi')))found.add(normalizeCardShift(m[1]));
 for(const line of source.split('\n')){const plain=line.match(/^(?:\s*SHIFT\s*[:=-]\s*)([^\n]+)$/i)||line.match(/^\s*(DAY|NIGHT)\s*$/i);if(plain){const shift=normalizeCardShift(plain[1]);if(shift)found.add(shift);}}
 return {value:found.size===1?[...found][0]:'',status:found.size>1?'unclear':found.size===1?'clear':'missing'};
}
export const markedShift=text=>markedShiftEvidence(text).value;
export function manualTripShiftPatch(key,value,rows=[]){
 if(key==='cardShift'){const shift=normalizeCardShift(value);return {cardShift:shift,shiftHours:CARD_SHIFTS[shift]?.hours||'',shiftId:''};}
 if(key==='shiftId'){const row=rows.find(r=>String(r.id)===String(value));const shift=normalizeCardShift(row?.shiftCode)||normalizeCardShift(row?.name||row?.shiftName);return {cardShift:shift,shiftHours:CARD_SHIFTS[shift]?.hours||''};}
 return {};
}
export function selectedMasterShift(rows,site,selection,date=''){
 const normalized=normalizeCardShift(selection),s=CARD_SHIFTS[normalized];if(!s||!site)return null;
 const code=bookShiftCode(normalized),candidates=rows.filter(r=>!r.sourceMissing&&String(r.status||'').trim().toLowerCase()!=='inactive'&&canonicalSiteName(r.site||r.siteName)===canonicalSiteName(site)&&(!date||(!(r.effectiveFrom)||r.effectiveFrom<=date)&&(!(r.effectiveTo)||date<=r.effectiveTo)));
 const named=candidates.filter(r=>[r.shiftCode,r.shiftName,r.name,r.shift].some(value=>bookShiftCode(value)===code));
 let matches=named.length?named:candidates.filter(r=>s.start&&String(r.startTime||r.start||'').slice(0,5)===s.start);
 // A dated revision supersedes undated seed records for the card's date.
 if(date&&matches.some(r=>r.effectiveFrom)){const latest=matches.map(r=>r.effectiveFrom||'').sort().at(-1);matches=matches.filter(r=>r.effectiveFrom===latest);}
 if(matches.length===1)return matches[0];
 const clock=value=>{const m=String(value||'').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);return m&&Number(m[1])<24&&Number(m[2])<60&&Number(m[3]||0)<60?[m[1].padStart(2,'0'),m[2],m[3]||'00'].join(':'):'';};
 const schedules=matches.map(r=>{const start=clock(r.startTime||r.start),end=clock(r.endTime||r.end);return start&&end?start+'|'+end:'';});
 // Identical seeded/imported schedules are equivalent; different times remain ambiguous.
 if(matches.length&&schedules.every(value=>value&&value===schedules[0]))return [...matches].sort((a,b)=>String(a.id).localeCompare(String(b.id),undefined,{numeric:true}))[0];
 return null;
}

export function cardShiftLabel(rows,site,selection,date){
 const definition=CARD_SHIFTS[selection];if(!definition)return selection;
 const master=selectedMasterShift(rows,site,selection,date);
 const start=String(master?.startTime||master?.start||'').slice(0,5),end=String(master?.endTime||master?.end||'').slice(0,5);
 return selection+' · '+(start?start+(end?'–'+end:''):definition.hours+' hours · select location shift');
}

export function bookShiftCode(value){const key=String(value||'').trim().toUpperCase().replace(/^SHIFT\s*|\s*SHIFT$/g,'').replace(/[ ._-]/g,'');return ({'1':'S1','2':'S2','3':'S3',I:'S1',II:'S2',III:'S3',A:'S1',B:'S2',C:'S3',S1:'S1',S2:'S2',S3:'S3',DAY:'D',NIGHT:'N',D:'D',N:'N'})[key]||'';}
export function formatBookNumber(kind,date,counter,shift){if(kind==='vehicle'&&!bookShiftCode(shift))throw new Error('Select Shift I, II, III, Day or Night before generating a Vehicle Log Book number.');const [year,month,day]=date.split('-');return kind==='vehicle'?`CAL/VLB/${day}${month}${year.slice(-2)}/${bookShiftCode(shift)}/${String(counter).padStart(4,'0')}`:`CAL/${kind==='lmv'?'LMV':'ELB'}/${day}-${month}-${year.slice(-2)}/${String(counter).padStart(3,'0')}`;}

export function tripClockForShift(value,shift,master){const m=String(normalizeScannedTime(value)).match(/^(\d{1,2}):(\d{2})$/);if(!m)return normalizeScannedTime(value);let h=Number(m[1]);const start=String(master?.startTime||master?.start||'').match(/^(\d{2}):(\d{2})/);if(start&&h>=1&&h<=12&&Number(m[2])<60){const from=Number(start[1])*60+Number(start[2]),hours=CARD_SHIFTS[shift]?.hours||8;const candidates=[h%12,h%12+12].filter(hour=>(hour*60+Number(m[2])-from+1440)%1440<=hours*60);if(candidates.length===1)return String(candidates[0]).padStart(2,'0')+':'+m[2];return normalizeScannedTime(value);}if(shift==='I'&&h>=1&&h<=4)h+=12;if(shift==='II'&&h>=1&&h<=9)h+=12;if(shift==='III'){if(h>=9&&h<=11)h+=12;else if(h===12)h=0;}return String(h).padStart(2,'0')+':'+m[2];}

export function latestWorkOrder(rows,site,date){const eligible=matchingWorkOrders(rows,site,date).filter(r=>!r.workOrderDate||r.workOrderDate<=date);if(!eligible.length)return null;const stamp=r=>r.workOrderDate||r.begin||r.commencementDate||'';eligible.sort((a,b)=>stamp(b).localeCompare(stamp(a)));return eligible.length===1||stamp(eligible[0])!==stamp(eligible[1])?eligible[0]:null;}
export function interTripGap(trips,index){if(index<1||!trips[index-1]?.unloadingTime||!trips[index]?.loadingTime)return null;const parse=t=>{const m=String(t).match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);return m&&Number(m[1])<24&&Number(m[2])<60&&Number(m[3]||0)<60?Number(m[1])*3600+Number(m[2])*60+Number(m[3]||0):null};const a=parse(trips[index-1].unloadingTime),b=parse(trips[index].loadingTime);return a==null||b==null?null:Math.round(((b-a+86400)%86400)/60*1000)/1000;}

