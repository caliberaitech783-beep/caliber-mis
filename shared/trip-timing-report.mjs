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
// Count of trips that an exception time (see the end of this file) moved to a lower band; 0 in the standard view.
export const EXCEPTION_KEY='given';
export const EXCEPTION_LABEL='Exception given';

const seconds=value=>{const m=String(value||'').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);return m&&Number(m[1])<24&&Number(m[2])<60&&Number(m[3]||0)<60?Number(m[1])*3600+Number(m[2])*60+Number(m[3]||0):null;};
// Minutes from one clock time to the next, counting forward through midnight.
export function minutesBetween(start,end){const a=seconds(start),b=seconds(end);return a===null||b===null?null:Math.round(((b-a+86400)%86400)/60*10)/10;}
export function bandOf(minutes){if(minutes===null||minutes===undefined||minutes>DOUBTFUL_MINUTES)return null;if(minutes<=DELAY_LIMIT)return 'ok';return BANDS.find(b=>minutes>b.above&&minutes<=b.upTo).key;}
const text=v=>String(v??'').trim();
const clock=v=>text(v).slice(0,5);
const minuteOfDay=value=>{const s=seconds(value);return s===null?null:s/60;};
const round1=n=>Math.round(n*10)/10;
// One timing of a trip row. `minutes` and `band` are what the report counts; `rawMinutes` and `rawBand` are the clock
// times as written, and stay so when an exception time (below) takes minutes out. `start` is the minute of the day it begins.
const timing=(counted,minutes,startsAt)=>{const band=bandOf(minutes);return {counted,minutes,band,rawMinutes:minutes,rawBand:band,excepted:0,start:minuteOfDay(startsAt)};};

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
    'load-unload':timing(true,taken,t.loadingTime),'unload-load':timing(i>0,gap,previous?.unloadingTime)});
  });
 }
 return out;
}

const keyOf={site:e=>e.site,shift:e=>JSON.stringify([e.date,e.shift]),driver:e=>e.driverKey,door:e=>e.door,machine:e=>e.machine};
const OTHER={'load-unload':'unload-load','unload-load':'load-unload'};
export const groupKey=(group,entry)=>keyOf[group](entry);
function counts(entries,mode){
 const c={timed:0,ok:0,b1:0,b2:0,b3:0,over:0,percent:null,longest:null,notJudged:0,[EXCEPTION_KEY]:0};const late=new Set();
 for(const e of entries){const m=e[mode];if(!m.counted)continue;if(!m.band){c.notJudged++;continue;}c.timed++;c[m.band]++;if(m.rawBand!==m.band)c[EXCEPTION_KEY]++;if(c.longest===null||m.minutes>c.longest)c.longest=m.minutes;if(m.band!=='ok'){c.over++;late.add(e.driverKey);}}
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
// The delayed trips (or gaps) behind one line, newest first. `band` keeps one band only; the exception key keeps the
// trips an exception time moved to a lower band, whether or not they are still a delay.
export function delayedEntries(entries,mode,band=''){
 return entries.filter(e=>{const m=e[mode];if(!m.counted||!m.band)return false;return band===EXCEPTION_KEY?m.rawBand!==m.band:m.band!=='ok'&&(!band||m.band===band);})
  .sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.book).localeCompare(String(a.book))||Number(b.id.split('-').pop())-Number(a.id.split('-').pop()));
}
export function entryRemark(e){
 const notes=[];
 if(e.first)notes.push('First trip of the card: no gap before it');
 if(!e['load-unload'].band)notes.push(e['load-unload'].minutes===null?'Loading or unloading time not written: not judged':'Time is longer than a shift: check the times');
 if(!e.first&&!e['unload-load'].band)notes.push(e['unload-load'].minutes===null?'Gap not judged: a time is not written':'Gap is longer than a shift: check the times');
 for(const [mode,what] of [['load-unload','loading to unloading'],['unload-load','gap before this loading']]){const m=e[mode];if(m.excepted>0)notes.push(`Exception time: ${m.excepted} of ${m.rawMinutes} min not counted (${what})`);}
 return notes.join(' · ');
}

// Exception time (owner, 13 Nov 2026). During blasting or breakfast every vehicle stands, and each of those trips showed
// as 30+ min. A user enters the clock period of the stop for what is on the screen (all sites, one site, or one date and
// shift). The minutes of a trip or gap that fall inside the period are not counted, and the band is judged on the minutes
// left. It is the user's own view: the standard figures stay as they are for everyone else.
export const EXCEPTION_MAX_MINUTES=480;
export const EXCEPTION_MAX_RULES=200;
const hhmm=value=>{const s=seconds(value);return s===null?'':String(Math.floor(s/3600)).padStart(2,'0')+':'+String(Math.floor(s%3600/60)).padStart(2,'0');};
const periodLength=(from,to)=>(minuteOfDay(to)-minuteOfDay(from)+1440)%1440;
// Why a period cannot be saved, or '' when it can. A period runs forward from `from`, through 12 at night if need be.
export function exceptionPeriodProblem(from,to){
 if(minuteOfDay(from)===null||minuteOfDay(to)===null)return 'Enter both times: From and To.';
 if(hhmm(from)===hhmm(to))return 'From and To are the same time. Enter the start and the end of the stop.';
 if(periodLength(hhmm(from),hhmm(to))>EXCEPTION_MAX_MINUTES)return 'An exception time can be 8 hours at most (one shift). Check From and To.';
 return '';
}
// `site` is the site key ('' = all sites), `slot` the date and shift key ('' = every date and shift).
export const exceptionSiteKey=site=>text(site)?canonicalSiteName(site):'';
const ruleId=r=>JSON.stringify([r.site,r.slot,r.from,r.to]);
// Saved periods come back from the browser's storage, so every field is checked again before it is used.
export function cleanExceptionRules(list){
 const seen=new Set();
 return (Array.isArray(list)?list:[]).flatMap(r=>{
  if(!r||typeof r!=='object'||exceptionPeriodProblem(r.from,r.to))return [];
  const rule={from:hhmm(r.from),to:hhmm(r.to),site:text(r.site),slot:text(r.slot),where:text(r.where).slice(0,160),reason:text(r.reason).replace(/\s+/g,' ').slice(0,40)};
  rule.id=ruleId(rule);if(seen.has(rule.id))return [];seen.add(rule.id);return [rule];
 }).slice(-EXCEPTION_MAX_RULES);
}
export function addExceptionRule(rules,{from,to,reason='',site='',slot='',where=''}={}){
 const saved=cleanExceptionRules(rules),problem=exceptionPeriodProblem(from,to);
 if(problem)return {problem,rules:saved};
 const next=cleanExceptionRules([...saved,{from,to,reason,site,slot,where}]);
 return next.length===saved.length&&saved.length<EXCEPTION_MAX_RULES?{problem:'This exception time is already saved here.',rules:saved}:{problem:'',rules:next};
}
// The saved periods that touch what is on the screen: one site ('' = all) and one date and shift ('' = all).
export const exceptionRulesFor=(rules,site='',slot='')=>rules.filter(r=>(!site||!r.site||r.site===site)&&(!slot||!r.slot||r.slot===slot));
// Minutes of [start, start+length] that fall inside any of the periods, on a 24-hour clock; overlapping periods count once.
function minutesInside(start,length,periods){
 const end=start+length,parts=[];
 for(const p of periods)for(const turn of [-1440,0,1440]){const a=Math.max(start,p.start+turn),b=Math.min(end,p.start+p.length+turn);if(b>a)parts.push([a,b]);}
 parts.sort((x,y)=>x[0]-y[0]);let total=0,reach=-Infinity;
 for(const [a,b] of parts){if(b<=reach)continue;total+=b-Math.max(a,reach);reach=b;}
 return total;
}
// The same entries, judged with the exception periods left out. An entry no period touches is returned as it is.
// A time longer than a shift stays not judged: it is a wrongly written clock time, not a stop.
export function withExceptionTime(entries,rules){
 const periods=cleanExceptionRules(rules).map(r=>({site:r.site,slot:r.slot,start:minuteOfDay(r.from),length:periodLength(r.from,r.to)}));
 if(!periods.length)return entries;
 const siteKeys=new Map(),siteKey=name=>{if(!siteKeys.has(name))siteKeys.set(name,canonicalSiteName(name));return siteKeys.get(name);};
 return entries.map(e=>{
  const site=siteKey(e.site),slot=keyOf.shift(e),mine=periods.filter(p=>(!p.site||p.site===site)&&(!p.slot||p.slot===slot));
  if(!mine.length)return e;
  let next=null;
  for(const mode of Object.keys(MODES)){
   const m=e[mode];if(!m.counted||!m.rawBand||m.start===null)continue;
   const out=Math.min(m.rawMinutes,round1(minutesInside(m.start,m.rawMinutes,mine)));if(!(out>0))continue;
   const minutes=round1(m.rawMinutes-out);
   (next||(next={...e}))[mode]={...m,minutes,band:bandOf(minutes),excepted:out};
  }
  return next||e;
 });
}
// The user's own view, kept on the device for each login: {on, rules}. `on` is false until the user opens the view.
export const exceptionStorageKey=account=>text(account)?'caliber:trip-timing-exception:v1:'+text(account).toLowerCase():'';
export function readExceptionView(storage,key){
 try{const saved=JSON.parse(storage.getItem(key)||'null'),rules=cleanExceptionRules(saved?.rules);return {on:saved?.on===true&&rules.length>0,rules};}catch{return {on:false,rules:[]};}
}
export function storeExceptionView(storage,key,view){
 try{if(view.rules.length)storage.setItem(key,JSON.stringify({on:Boolean(view.on),rules:view.rules.map(({id,...rule})=>rule)}));else storage.removeItem(key);return true;}catch{return false;}
}
