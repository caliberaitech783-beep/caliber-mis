import {normalizeScannedTime} from './scan-clock.mjs';
import {canonicalSiteName} from './site-location.mjs';
export function shiftMeterIssues(draft={},kind='vehicle'){
 const issues={},hours=Number(draft.shiftHours);
 if(![8,12].includes(hours))return issues;
 for(const meter of ['Hmr',...(kind==='vehicle'?['Kmr']:[])]){
  const a=draft['opening'+meter],b=draft['closing'+meter];
  if(a==null||b==null||String(a).trim()===''||String(b).trim()==='')continue;
  const opening=Number(a),closing=Number(b),limit=meter==='Hmr'?hours:hours===8?250:350;
  if(!Number.isFinite(opening)||!Number.isFinite(closing)||opening<0||closing<opening)continue;
  const difference=closing-opening;
  if(difference-limit>Number.EPSILON*Math.max(1,Math.abs(opening),Math.abs(closing))*4){
   const format=n=>Number(n.toFixed(3)),unit=meter==='Hmr'?'hours':'km';
   issues['closing'+meter]=`${meter.toUpperCase()} difference (closing - opening) is ${format(difference)} ${unit}; maximum for an ${hours}-hour shift is ${limit}. Exceeds limit by ${format(difference-limit)} ${unit}.`;
  }
 }
 return issues;
}
export const CARD_SHIFTS={I:{hours:8,start:'05:00',label:'I · 05:00–13:00'},II:{hours:8,start:'13:00',label:'II · 13:00–21:00'},III:{hours:8,start:'21:00',label:'III · 21:00–05:00'},Day:{hours:12,start:'',label:'Day · 12 hours'},Night:{hours:12,start:'',label:'Night · 12 hours'}};
export const systemBookDate=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function machineLabel(value){const s=String(value||'').trim().toUpperCase();return /^\d+$/.test(s)?'V'+String(Number(s)):/^V\s*-?\s*\d+$/.test(s)?'V'+String(Number(s.match(/\d+/)[0])):s;}
export function machineSummary(trips=[]){const map=new Map();for(const row of trips){const equipmentName=machineLabel(row.equipmentName);if(!equipmentName)continue;map.set(equipmentName,(map.get(equipmentName)||0)+(Number(row.tripCount)||0))}return [...map].map(([equipmentName,tripCount])=>({equipmentName,tripCount}));}
export function machineTripTotal(trips=[]){return trips.reduce((total,row)=>total+(Number(row.tripCount)||0),0);}
export function machineDiscrepancies(trips=[],printed=[]){
 if(!printed.length)return [];
 const actual=new Map(machineSummary(trips).map(r=>[r.equipmentName,r.tripCount])),expected=new Map(machineSummary(printed).map(r=>[r.equipmentName,r.tripCount]));
 const issues=[...new Set([...actual.keys(),...expected.keys()])].flatMap(name=>actual.get(name)===expected.get(name)?[]:[name+': detail trips '+(actual.get(name)||0)+', scanned summary '+(expected.get(name)||0)+'.']);
 const detailTotal=machineTripTotal(trips),summaryTotal=machineTripTotal(printed);
 if(detailTotal!==summaryTotal)issues.push('Total trips: detail trips '+detailTotal+', scanned summary '+summaryTotal+'. Machine summary must equal Trip Details; count each trip once.');
 return issues;
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
export function formatBookNumber(kind,date,counter,shift){if(kind==='vehicle'&&!bookShiftCode(shift))throw new Error('Select Shift I, II, III, Day or Night before generating a Vehicle Log Book number.');const [year,month,day]=date.split('-');return kind==='vehicle'?`CAL/VLB/${day}${month}${year.slice(-2)}/${bookShiftCode(shift)}/${String(counter).padStart(4,'0')}`:`CAL/ELB/${day}-${month}-${year.slice(-2)}/${String(counter).padStart(3,'0')}`;}

export function tripClockForShift(value,shift,master){const m=String(normalizeScannedTime(value)).match(/^(\d{1,2}):(\d{2})$/);if(!m)return normalizeScannedTime(value);let h=Number(m[1]);const start=String(master?.startTime||master?.start||'').match(/^(\d{2}):(\d{2})/);if(start&&h>=1&&h<=12&&Number(m[2])<60){const from=Number(start[1])*60+Number(start[2]),hours=CARD_SHIFTS[shift]?.hours||8;const candidates=[h%12,h%12+12].filter(hour=>(hour*60+Number(m[2])-from+1440)%1440<=hours*60);if(candidates.length===1)return String(candidates[0]).padStart(2,'0')+':'+m[2];return normalizeScannedTime(value);}if(shift==='I'&&h>=1&&h<=4)h+=12;if(shift==='II'&&h>=1&&h<=9)h+=12;if(shift==='III'){if(h>=9&&h<=11)h+=12;else if(h===12)h=0;}return String(h).padStart(2,'0')+':'+m[2];}

export function latestWorkOrder(rows,site,date){const eligible=matchingWorkOrders(rows,site,date).filter(r=>!r.workOrderDate||r.workOrderDate<=date);if(!eligible.length)return null;const stamp=r=>r.workOrderDate||r.begin||r.commencementDate||'';eligible.sort((a,b)=>stamp(b).localeCompare(stamp(a)));return eligible.length===1||stamp(eligible[0])!==stamp(eligible[1])?eligible[0]:null;}
export function interTripGap(trips,index){if(index<1||!trips[index-1]?.unloadingTime||!trips[index]?.loadingTime)return null;const parse=t=>{const m=String(t).match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);return m&&Number(m[1])<24&&Number(m[2])<60&&Number(m[3]||0)<60?Number(m[1])*3600+Number(m[2])*60+Number(m[3]||0):null};const a=parse(trips[index-1].unloadingTime),b=parse(trips[index].loadingTime);return a==null||b==null?null:Math.round(((b-a+86400)%86400)/60*1000)/1000;}
