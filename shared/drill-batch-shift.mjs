// Drill shifts in 8-hour batches (owner, 27 Nov 2026: "Option 1 banao").
// A drill works 12-hour Day / Night shifts while a batch is 8 hours (Shift I / II / III). A Drill Log Book card goes
// in the batch of the same date whose 8-hour shift contains the start of the drill's 12-hour shift: Day (06:00) goes in
// the Shift I batch, Night (18:00) in the Shift II batch. A batch in which no drill shift starts needs no DLB card, so
// Lock DLB passes it straight on. A site that runs 12-hour Day / Night batches takes the drill shift of the same name.
//
// Start times come from the site's Shift Master: a Day / Night entry gives the drill start, else Day starts with
// Shift I and Night 12 hours after Day. The 8-hour windows are the site's Shift I / II / III entries, else the
// standard 05:00 / 13:00 / 21:00.
import {canonicalSiteName} from './site-location.mjs';
import {bookShiftCode,CARD_SHIFTS} from './trip-card-rules.mjs';
import {DRILL_SHIFT_PERIODS} from './drill-log-book.mjs';

const DAY=1440;
const text=value=>String(value??'').trim();
const minutes=value=>{const m=text(value).match(/^(\d{1,2}):(\d{2})/);return m&&Number(m[1])<24&&Number(m[2])<60?Number(m[1])*60+Number(m[2]):null;};
const clock=value=>String(Math.floor(value/60)%24).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
const DEFAULT_STARTS={S1:CARD_SHIFTS.I.start,S2:CARD_SHIFTS.II.start,S3:CARD_SHIFTS.III.start};
export const BATCH_SHIFT_LABELS={S1:'Shift I',S2:'Shift II',S3:'Shift III',D:'Day',N:'Night'};
export const drillPeriodLabel=period=>DRILL_SHIFT_PERIODS.find(row=>row.id===period)?.label.replace(/\s*-.*$/,'')||period;

function codeOf(row={}){return [row.shiftCode,row.shiftName,row.name,row.shift].map(bookShiftCode).find(Boolean)||'';}

// The site's active Shift Master entries on the date, newest effective entry first for each code.
function siteShifts(shifts=[],site,date){
 const canonical=canonicalSiteName(site),byCode=new Map();
 const rows=(Array.isArray(shifts)?shifts:[]).filter(row=>row&&canonicalSiteName(row.site||row.siteName)===canonical&&!row.sourceMissing&&text(row.status).toLowerCase()!=='inactive'&&(!row.effectiveFrom||!date||text(row.effectiveFrom)<=date)&&(!row.effectiveTo||!date||text(row.effectiveTo)>=date));
 for(const row of rows.sort((a,b)=>text(b.effectiveFrom).localeCompare(text(a.effectiveFrom)))){
  const code=codeOf(row),start=minutes(row.startTime||row.start);
  if(!code||start===null||byCode.has(code))continue;
  const end=minutes(row.endTime||row.end),length=end===null?null:(end-start+DAY)%DAY;
  byCode.set(code,{code,start,length:length||null});
 }
 return byCode;
}

// Where each 12-hour drill shift of the site starts, in minutes after midnight.
export function drillShiftStarts(shifts=[],site,date){
 const own=siteShifts(shifts,site,date);
 const shiftOne=own.get('S1')?.start??minutes(DEFAULT_STARTS.S1);
 const day=own.get('D')?.start??shiftOne;
 const night=own.get('N')?.start??(day+720)%DAY;
 return {day,night};
}

// The 8-hour batch shift (S1 / S2 / S3) running at a minute of the day.
function eightHourShiftAt(minute,own){
 const windows=['S1','S2','S3'].map(code=>{const row=own.get(code);return {code,start:row?.start??minutes(DEFAULT_STARTS[code]),length:row?.length||480};});
 const offset=row=>(minute-row.start+DAY)%DAY;
 const inside=windows.filter(row=>offset(row)<row.length);
 return (inside.length?inside:windows).sort((a,b)=>offset(a)-offset(b))[0].code;
}

// The batch shift a drill shift's card belongs to.
export function drillPeriodBatchShift(period,{shifts=[],site,date}={}){
 if(!DRILL_SHIFT_PERIODS.some(row=>row.id===period))return '';
 const starts=drillShiftStarts(shifts,site,date);
 return eightHourShiftAt(starts[period],siteShifts(shifts,site,date));
}

// The drill shifts whose cards go in a batch: the Day / Night shift of the same name for a 12-hour batch, else
// every drill shift that starts inside the batch's 8-hour shift. Empty: the batch needs no DLB card.
export function batchDrillPeriods(batchShift,{shifts=[],site,date}={}){
 const code=bookShiftCode(batchShift);
 if(code==='D')return ['day'];
 if(code==='N')return ['night'];
 if(!['S1','S2','S3'].includes(code))return [];
 return DRILL_SHIFT_PERIODS.map(row=>row.id).filter(period=>drillPeriodBatchShift(period,{shifts,site,date})===code);
}

// Why a drill shift's card cannot be saved in this batch ('' when it can).
export function drillBatchShiftIssue(period,batchShift,context={}){
 const periods=batchDrillPeriods(batchShift,context);
 if(periods.includes(period))return '';
 const code=bookShiftCode(batchShift),starts=drillShiftStarts(context.shifts,context.site,context.date);
 const home=['D','N'].includes(code)?(period==='day'?'D':'N'):drillPeriodBatchShift(period,context);
 const here=BATCH_SHIFT_LABELS[code]||batchShift;
 const lead=`The ${drillPeriodLabel(period)} drill shift starts at ${clock(starts[period])}, so its card goes in the ${BATCH_SHIFT_LABELS[home]||home} batch of this date, not ${here}.`;
 return periods.length?`${lead} This batch takes the ${periods.map(drillPeriodLabel).join(' and ')} drill shift.`:`${lead} No drill shift starts in this batch: lock DLB without a card.`;
}

// A Shift Master entry a drill card may name in this batch: the batch's own shift or the drill shift's Day / Night.
export function drillShiftEntryAllowed(row,batchShift,period){
 const code=codeOf(row);
 return Boolean(code)&&(code===bookShiftCode(batchShift)||code===(period==='day'?'D':period==='night'?'N':''));
}
