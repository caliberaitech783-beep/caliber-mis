// The steps of the Operations reports that were one long table (owner, 17 Nov 2026: "all other reports where the step
// is missing"): Step 1 one line per site, Step 2 date by shift, Step 3 by equipment category, Step 4 the report's own
// table for what was opened. One rule for all of them, so each report keeps its own columns and only gains the steps.
import {canonicalSiteName} from '../shared/site-location.mjs';
import {equipmentGroupName} from '../shared/equipment-group.mjs';
import {fleetDoorKey} from '../shared/scan-fleet-door.mjs';
import {shiftDisplayName} from '../shared/shift-master.mjs';
import {bookShiftCode} from '../shared/trip-card-rules.mjs';

export const EVERY='*';
// The reports whose table already has one line per log book or per finding, with its date, site, door and shift:
// the steps open those lines themselves. The column of each is where buildOperationReport puts it.
export const LINE_REPORTS={
 vehicle:{date:0,site:1,door:3,shift:6,count:'Log books'},
 equipment:{date:0,site:1,door:3,shift:6,count:'Log books'},
 breakdown:{date:0,site:1,door:3,shift:6,count:'Log books'},
 meters:{date:0,site:1,door:3,shift:6,count:'Exceptions'},
 missing:{date:0,site:1,door:2,shift:3,count:'Findings'}
};
// The reports that add log books up (by date, door, shift, work order, month) or list scanned cards: the steps open
// the log books (or cards) and the report is built again from the ones opened.
export const BUILT_REPORTS=['daily','vehicle-trips','shift','utilisation','site','trends','scans'];
export const STEP_REPORTS=[...Object.keys(LINE_REPORTS),...BUILT_REPORTS];
export const hasReportSteps=id=>STEP_REPORTS.includes(id);
export const countLabel=id=>LINE_REPORTS[id]?.count||(id==='scans'?'Cards':'Log books');

const text=v=>String(v??'').trim();
// The equipment category of a log book: its saved vehicle or machine, or else its door when that door is one asset at the site.
export function assetCategoryOf(assets=[]){
 const byId=new Map(assets.map(a=>[String(a.id),a])),doors=new Map();
 for(const a of assets){const door=fleetDoorKey(a.door);if(!door)continue;const key=canonicalSiteName(a.site)+'|'+door;doors.set(key,doors.has(key)?null:a);}
 return ({assetId,door,site})=>{
  const asset=byId.get(String(assetId??''))||(text(door)?doors.get(canonicalSiteName(site)+'|'+fleetDoorKey(door)):null);
  return equipmentGroupName(asset?.group);
 };
}

// One item per thing the steps count: a line of the report, a log book, or a scanned card.
// A scanned card's shift, named as the site's log books name it. Most cards read no shift name of their own: the
// shift (I, II, III, Day, Night) is marked on the card's batch, so it is matched to that site's Shift Master line
// (live, 18 Nov 2026: every Scan Review card fell under "Shift not recorded" before this).
const SHIFT_BY_CODE={S1:'Shift A',S2:'Shift B',S3:'Shift C',D:'Day',N:'Night'};
export function cardShiftOf(shifts=[]){
 const byId=new Map(shifts.map(s=>[String(s.id),s]));
 const atSite=new Map();
 for(const s of shifts){const key=canonicalSiteName(s.site)||text(s.site);if(!atSite.has(key))atSite.set(key,[]);atSite.get(key).push(s);}
 return card=>{
  const d=card.draft||{};
  if(text(d.shiftName))return shiftDisplayName(d.shiftName);
  const named=d.shiftId!=null&&byId.get(String(d.shiftId));
  if(named&&text(named.name))return shiftDisplayName(named.name);
  const code=bookShiftCode(card.card_shift)||bookShiftCode(d.cardShift);
  if(!code)return '';
  const master=(atSite.get(canonicalSiteName(d.location)||text(d.location))||[]).find(s=>(bookShiftCode(s.shiftCode)||bookShiftCode(s.name))===code);
  return master&&text(master.name)?shiftDisplayName(master.name):SHIFT_BY_CODE[code]||'';
 };
}

export function stepItems(id,{records=[],cards=[],report={rows:[]},assets=[],shifts=[]}){
 const categoryOf=assetCategoryOf(assets);
 const item=(fields,source)=>{const site=text(fields.site)||'Site not recorded';return {...fields,site,siteKey:canonicalSiteName(site)||site,shift:text(fields.shift)||'Shift not recorded',date:text(fields.date),category:categoryOf(fields),source};};
 const at=LINE_REPORTS[id];
 if(at)return report.rows.map(row=>item({date:row[at.date],site:row[at.site],door:row[at.door],shift:row[at.shift],assetId:null},row));
 if(id==='scans'){const shiftOf=cardShiftOf(shifts);return cards.map(c=>{const d=c.draft||{};return item({date:d.bookDate||c.scanned_date,site:d.location,door:d.door,shift:shiftOf(c),assetId:d.assetId},c);});}
 // A built report counts only the log books it is built from: the Vehicle-wise Trip Report leaves equipment out.
 const counted=id==='vehicle-trips'?records.filter(r=>r.kind==='vehicle'):records;
 return counted.map(r=>item({date:r.bookDate,site:r.location,door:r.door,shift:r.shiftName,assetId:r.assetId},r));
}

// What is open: a site (or EVERY), a date and shift (or EVERY for all of them) and an equipment category (or EVERY).
export function openedItems(items,{site,slot,category}={}){
 return items.filter(i=>(!site||site===EVERY||i.siteKey===site)&&(!slot||slot===EVERY||slotKey(i)===slot)&&(!category||category===EVERY||i.category===category));
}
export const slotKey=i=>i.date+'|'+i.shift;

const tally=list=>({count:list.length,assets:new Set(list.map(i=>i.assetId?'#'+i.assetId:fleetDoorKey(i.door)||text(i.door)).filter(Boolean)).size,dates:new Set(list.map(i=>i.date).filter(Boolean)).size});
const byText=(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true});
// One line per site, per date and shift, or per equipment category, with the line of all of them last.
export function stepLines(items,by){
 const groups=new Map();
 for(const i of items){const key=by==='site'?i.siteKey:by==='category'?i.category:slotKey(i)+(by==='slot-site'?'|'+i.siteKey:'');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}
 const rows=[...groups.entries()].map(([key,list])=>({id:key,key,site:list[0].site,date:list[0].date,shift:list[0].shift,category:list[0].category,...tally(list)}));
 rows.sort(by==='category'?(a,b)=>b.count-a.count||byText(a.category,b.category):by==='site'?(a,b)=>byText(a.site,b.site):(a,b)=>byText(a.key,b.key));
 return {rows,total:{id:'total',key:EVERY,total:true,site:'All sites',category:'All categories',...tally(items)}};
}

// The narrowed table of Step 4. A line report keeps its own lines; a built report is built again from what is open,
// with the dates, site and shift of the opening, so "Potential missing" and the scanned cards follow them too.
export function stepTable(id,report,opened,build){
 if(LINE_REPORTS[id])return {...report,rows:opened.map(i=>i.source)};
 return build(opened.map(i=>i.source));
}
