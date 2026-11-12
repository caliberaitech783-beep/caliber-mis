// Trip Timing & Gap Report: delay bands for the two timings of a Vehicle Log Book trip row.
//   load-unload : loading time to unloading time of the same trip row
//   unload-load : unloading time of the row above to loading time of this row, on the same card
// Pure rules only; the screen is src/trip-timing-report.jsx.
import {tripSerialNumber} from './log-book-labels.mjs';
import {canonicalSiteName} from './site-location.mjs';

// Owner's limit (11 Nov 2026): a time above 15 minutes is a delay. It was 10 at first; real cards showed a usual trip takes 10 to 20 minutes.
export const DELAY_LIMIT=15;
// A time longer than a shift can only be a wrongly written clock time, so it is not judged.
export const DOUBTFUL_MINUTES=720;
export const BANDS=[{key:'b1',label:DELAY_LIMIT+' to 20 min',above:DELAY_LIMIT,upTo:20},{key:'b2',label:'20 to 30 min',above:20,upTo:30},{key:'b3',label:'30+ min',above:30,upTo:Infinity}];
export const BAND_LABELS={ok:'Within '+DELAY_LIMIT+' min',...Object.fromEntries(BANDS.map(b=>[b.key,b.label]))};
export const MODES={
 'load-unload':{label:'Loading → Unloading',unit:'Trips timed',noun:'trip'},
 'unload-load':{label:'Unloading → next Loading',unit:'Gaps timed',noun:'gap'}
};
export const GROUPS={driver:'Driver-wise',door:'Door no.-wise',machine:'Loading machine-wise'};

const seconds=value=>{const m=String(value||'').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);return m&&Number(m[1])<24&&Number(m[2])<60&&Number(m[3]||0)<60?Number(m[1])*3600+Number(m[2])*60+Number(m[3]||0):null;};
// Minutes from one clock time to the next, counting forward through midnight.
export function minutesBetween(start,end){const a=seconds(start),b=seconds(end);return a===null||b===null?null:Math.round(((b-a+86400)%86400)/60*10)/10;}
export function bandOf(minutes){if(minutes===null||minutes===undefined||minutes>DOUBTFUL_MINUTES)return null;if(minutes<=DELAY_LIMIT)return 'ok';return BANDS.find(b=>minutes>b.above&&minutes<=b.upTo).key;}
const text=v=>String(v??'').trim();
const clock=v=>text(v).slice(0,5);

// Cards carry the site as it was typed or read ("Majri OB", "majri ob", "Dudhicua East OB"). All spellings of one site
// are shown as one site, under the spelling used most among those that are not all in small letters.
export function siteLabels(records){
 const spellings=new Map();
 for(const r of records){const name=text(r.location);if(!name)continue;const key=canonicalSiteName(name);if(!spellings.has(key))spellings.set(key,new Map());const count=spellings.get(key);count.set(name,(count.get(name)||0)+1);}
 const label=new Map([...spellings].map(([key,count])=>[key,[...count].sort((a,b)=>(a[0]===a[0].toLowerCase())-(b[0]===b[0].toLowerCase())||b[1]-a[1]||a[0].localeCompare(b[0]))[0][0]]));
 return name=>text(name)?label.get(canonicalSiteName(name)):'Unassigned';
}
// One entry per trip row of every saved Vehicle Log Book in `records` (rows from normalise()).
export function tripEntries(records){
 const out=[],siteName=siteLabels(records);
 for(const r of records){
  if(r.kind!=='vehicle')continue;
  const timed=r.timeMode!=='without',trips=r.trips||[];
  const caliberId=text(r.caliberId),driver=text(r.employeeName);
  trips.forEach((t,i)=>{
   const previous=i>0?trips[i-1]:null;
   const taken=timed?minutesBetween(t.loadingTime,t.unloadingTime):null,gap=timed&&previous?minutesBetween(previous.unloadingTime,t.loadingTime):null;
   out.push({id:r.id+'-'+i,recordId:String(r.id),book:r.book,date:r.bookDate,site:siteName(r.location),shift:r.shiftName||'',door:text(r.door)||'Not recorded',caliberId,driver,
    driverKey:JSON.stringify([caliberId,driver]),sr:tripSerialNumber(t,i),machine:text(t.equipmentName)||'Not recorded',trips:t.tripCount??'',
    loadingTime:clock(t.loadingTime),unloadingTime:clock(t.unloadingTime),previousUnloadingTime:previous?clock(previous.unloadingTime):'',first:i===0,
    'load-unload':{counted:true,minutes:taken,band:bandOf(taken)},'unload-load':{counted:i>0,minutes:gap,band:bandOf(gap)}});
  });
 }
 return out;
}

const keyOf={site:e=>e.site,shift:e=>JSON.stringify([e.date,e.shift]),driver:e=>e.driverKey,door:e=>e.door,machine:e=>e.machine};
const OTHER={'load-unload':'unload-load','unload-load':'load-unload'};
export const groupKey=(group,entry)=>keyOf[group](entry);
function counts(entries,mode){
 const c={timed:0,ok:0,b1:0,b2:0,b3:0,over:0,percent:null,longest:null,notJudged:0};const late=new Set();
 for(const e of entries){const m=e[mode];if(!m.counted)continue;if(!m.band){c.notJudged++;continue;}c.timed++;c[m.band]++;if(c.longest===null||m.minutes>c.longest)c.longest=m.minutes;if(m.band!=='ok'){c.over++;late.add(e.driverKey);}}
 c.percent=c.timed?Math.round(c.over/c.timed*1000)/10:null;c.driversLate=late.size;
 // Delays of the same rows in the other timing, so one line shows everything against a driver.
 c.otherOver=entries.filter(e=>{const o=e[OTHER[mode]];return o.counted&&o.band&&o.band!=='ok';}).length;return c;
}
// One line per site, date and shift, driver, door or loading machine, with the count in each band. `total` is the line for all of them.
export function summarise(entries,mode,group){
 const groups=new Map();
 for(const e of entries){const key=keyOf[group](e);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
 const rows=[...groups.entries()].map(([key,list])=>{const f=list[0];return {id:group+':'+key,key,site:f.site,date:f.date,shift:f.shift||'Not recorded',caliberId:f.caliberId||'ID not recorded',driver:f.driver||'Name not recorded',door:f.door,machine:f.machine,
  doors:[...new Set(list.map(e=>e.door))].join(', '),driverCount:new Set(list.map(e=>e.driverKey)).size,vehicleCount:new Set(list.map(e=>e.door)).size,...counts(list,mode)};}).filter(r=>r.timed+r.notJudged+r.otherOver>0);
 if(group==='site')rows.sort((a,b)=>a.site.localeCompare(b.site));
 else if(group==='shift')rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.shift.localeCompare(b.shift,undefined,{numeric:true}));
 else rows.sort((a,b)=>b.over-a.over||b.b3-a.b3||b.b2-a.b2||(b.longest??0)-(a.longest??0)||String(a.key).localeCompare(String(b.key)));
 const all=entries;
 return {rows,total:{id:group+':total',key:null,total:true,site:'ALL SITES',date:'',shift:'ALL SHIFTS',caliberId:'',driver:'TOTAL',door:'TOTAL',machine:'TOTAL',doors:'',driverCount:new Set(all.map(e=>e.driverKey)).size,vehicleCount:new Set(all.map(e=>e.door)).size,...counts(all,mode)}};
}
// The delayed trips (or gaps) behind one line, newest first. `band` keeps one band only.
export function delayedEntries(entries,mode,band=''){
 return entries.filter(e=>{const m=e[mode];return m.counted&&m.band&&m.band!=='ok'&&(!band||m.band===band);})
  .sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.book).localeCompare(String(a.book))||Number(b.id.split('-').pop())-Number(a.id.split('-').pop()));
}
export function entryRemark(e){
 const notes=[];
 if(e.first)notes.push('First trip of the card: no gap before it');
 if(!e['load-unload'].band)notes.push(e['load-unload'].minutes===null?'Loading or unloading time not written: not judged':'Time is longer than a shift: check the times');
 if(!e.first&&!e['unload-load'].band)notes.push(e['unload-load'].minutes===null?'Gap not judged: a time is not written':'Gap is longer than a shift: check the times');
 return notes.join(' · ');
}
