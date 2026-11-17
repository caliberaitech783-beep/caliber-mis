// Loading Equipment-wise Report: what every loading machine of a site did in a shift.
//   trips loaded     : the trip rows of tipper cards (Vehicle Log Books) that name the machine
//   idle stop        : the time from one loading to the next loading by the same machine, when above 5 minutes
//   % of shift worked: hours on the machine's own Equipment Log Book against the hours of the shift
//   In BD / No hours : a machine that neither loaded nor showed hours, by its ELB status
// Pure rules only; the screen is src/loading-machine-report.jsx.
import {canonicalSiteName} from './site-location.mjs';
import {vlbRecordShift} from './vlb-batch-format.mjs';
import {isUnloadingOnlyTrip,CARD_SHIFTS,normalizeCardShift} from './trip-card-rules.mjs';
import {cardWorkingHmr} from './log-book-shared-shift.mjs';
import {fleetDoorKey} from './scan-fleet-door.mjs';
import {equipmentGroupName} from './equipment-group.mjs';
import {tripSerialNumber} from './log-book-labels.mjs';
import {cardOnShiftClock} from './shift-clock.mjs';
import {siteLabels,minutesBetween,DELAY_LIMIT,DOUBTFUL_MINUTES} from './trip-timing-report.mjs';

// Owner's bands (13 Nov 2026): a machine is idle when more than 5 minutes pass between two loadings.
// He named 5 to 10, 10 to 15 and 15 to 20; 20+ is added so that a longer stop is not lost.
export const IDLE_LIMIT=5;
export const BANDS=[{key:'b1',label:'5 to 10 min',above:5,upTo:10},{key:'b2',label:'10 to 15 min',above:10,upTo:15},{key:'b3',label:'15 to 20 min',above:15,upTo:20},{key:'b4',label:'20+ min',above:20,upTo:Infinity}];
export const BAND_LABELS={ok:'Up to '+IDLE_LIMIT+' min',...Object.fromEntries(BANDS.map(b=>[b.key,b.label]))};
// The shift time-line of a machine shows every loading in one of three colours (owner, 13 Nov 2026: "trip wise where it
// was green, orange, and red"): green up to 5 minutes after the loading before, orange up to 20, red above 20.
export const TONES={first:'first',ok:'green',b1:'orange',b2:'orange',b3:'orange',b4:'red'};
export const TONE_LABELS={green:'Green',orange:'Orange',red:'Red'};
// A tipper trip counts as delayed when the tipper took more than this from its unloading to its next loading: the limit
// of the Trip Timing & Gap Report, so that both reports call the same trips delayed.
export const WAIT_LIMIT=DELAY_LIMIT;
// running: loaded a trip or showed hours. breakdown (red): did not run and was down. nohours (brown): did not run, not in BD.
export const STATES={running:'Running',breakdown:'In BD',nohours:'No hours, not in BD'};
export const STAGE_LABELS={vlb_open:'VLB still open',lmv_open:'VLB locked',elb_open:'VLB locked',closed:'Batch closed','':'No batch'};
// A loading written up to 90 minutes before the shift starts or 2 hours after it ends still belongs to the shift.
// Anything further out is a wrongly written time and is not judged.
const EARLY=90,LATE=120;
// Machines that load tippers. A machine named on any tipper card in the dates is a loading machine whatever its group.
const LOADER_WORDS=/excavator|loader|shovel|backhoe|poclain/i;
const STAGE_RANK={vlb_open:0,lmv_open:1,elb_open:2,closed:3};

const text=v=>String(v??'').trim();
const num=v=>v===null||v===undefined||text(v)===''||!Number.isFinite(Number(v))?null:Number(v);
const round1=n=>Math.round(n*10)/10;
const round3=n=>Math.round((n+Number.EPSILON)*1000)/1000;
const clockMinutes=value=>{const m=text(value).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);return m&&Number(m[1])<24&&Number(m[2])<60&&Number(m[3]||0)<60?Number(m[1])*60+Number(m[2])+Number(m[3]||0)/60:null;};
const mostCommon=values=>{const count=new Map();for(const v of values)if(v!==''&&v!==null&&v!==undefined)count.set(v,(count.get(v)||0)+1);return [...count].sort((a,b)=>b[1]-a[1])[0]?.[0]??null;};
const unique=values=>[...new Set(values.filter(Boolean))];
const stamp=value=>{const t=Date.parse(value);return Number.isFinite(t)?new Date(t).toLocaleString('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).replace(',',''):'';};

const identity=v=>text(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
// Breakdown periods as [from, to] minutes of the shift, joined where they overlap, and the minutes of them inside a window.
export function mergePeriods(periods){
 const merged=[];
 for(const p of [...periods].sort((a,b)=>a.from-b.from)){const prev=merged.at(-1);if(prev&&p.from<=prev.to)prev.to=Math.max(prev.to,p.to);else merged.push({from:p.from,to:p.to});}
 return merged;
}
function overlap(down,from,to){let m=0;for(const p of down)m+=Math.max(0,Math.min(to,p.to)-Math.max(from,p.from));return m;}

export function bandOf(minutes){if(minutes===null||minutes===undefined)return null;if(minutes<=IDLE_LIMIT)return 'ok';return BANDS.find(b=>minutes>b.above&&minutes<=b.upTo).key;}
// Always hours and minutes ("0 h 45 min", "3 h 05 min"), so that the column sorts in the order of the time.
export function idleText(minutes){if(minutes===null||minutes===undefined)return '—';const m=Math.round(minutes);return Math.floor(m/60)+' h '+String(m%60).padStart(2,'0')+' min';}
// Hours worked out of the hours of the shift: 8 hours worked in an 8-hour shift is 100%.
export function percentWorked(hours,shiftHours){return hours===null||hours===undefined||!shiftHours?null:round1(hours/shiftHours*100);}
// The share of one idle band: its stops out of all the timed gaps between one loading and the next, the gaps of
// 5 minutes or less included. Trips without a loading time make no gap, so a site that writes fewer times is not flattered.
export function bandShare(count,gaps){return gaps?round1(count/gaps*100):null;}
const shiftCodeOf=r=>vlbRecordShift(r)||text(r.shiftName)||'Not recorded';
const slotKey=(site,date,code)=>JSON.stringify([canonicalSiteName(site),date,code]);
// The clock time so many minutes after a clock time, through midnight: clockAt(1260,200) is "00:20".
export function clockAt(start,minutes=0){const m=((Math.floor(start+minutes)%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
// The tipper trips delayed by the idle stop that ends with loading `i`: the tipper was loaded by this machine at the end of
// the stop or later, took more than WAIT_LIMIT minutes from its unloading to that loading, and stood empty for more than
// IDLE_LIMIT minutes of the stop itself. `judged` are the loadings of the machine in the order of the shift.
// Minutes the machine was in breakdown are taken out: a tipper standing while the machine was broken down is not idle time.
function tippersKeptWaiting(judged,i,down=[]){
 const from=judged[i-1].off,to=judged[i].off,list=[];
 for(let k=i;k<judged.length;k++){
  const l=judged[k];if(l.waited===null||l.waited<=WAIT_LIMIT)continue;
  const since=Math.max(from,l.off-l.waited),inside=round1(to-since-overlap(down,since,to));
  if(inside>IDLE_LIMIT)list.push({key:l.recordId+'-'+l.row,recordId:l.recordId,book:l.book,door:l.door,driver:l.driver,unloadedAt:l.unloadedAt,loadedAt:l.clock,waited:l.waited,inside});
 }
 return list;
}

// One entry per loading machine, site, date and shift. `records` are rows from normalise(); `assets`, `fleet` and
// `batches` come with them from GET /api/reports/operations. `fleet` lists the site machines of a batch with no saved ELB.
// `pulseBreakdowns` is Pulse's breakdown list read when the report opened (null when Pulse could not be read): when given,
// a machine's breakdowns come from it, so that a breakdown entered or closed in Pulse after the ELB was saved still shows.
// Without it, the breakdowns copied onto the ELB card when it was saved are used.
export function machineShifts(records,{assets=[],fleet=[],batches=[],filters={},pulseBreakdowns=null,now=Date.now()}={}){
 const siteName=siteLabels(records);
 const byId=new Map(assets.map(a=>[String(a.id),a]));
 const live=Array.isArray(pulseBreakdowns),requests=new Map();
 if(live)for(const r of pulseBreakdowns){const site=canonicalSiteName(r.site);if(!requests.has(site))requests.set(site,[]);requests.get(site).push({...r,keys:[r.door,r.equipment,r.reg].map(identity).filter(Boolean),chassisKey:identity(r.chassis)});}
 // Door numbers of the machines of each site; a door shared by two machines identifies neither.
 const doors=new Map();
 for(const a of assets){if(a.kind!=='equipment')continue;const site=canonicalSiteName(a.site),key=fleetDoorKey(a.door);if(!key)continue;if(!doors.has(site))doors.set(site,new Map());doors.get(site).set(key,doors.get(site).has(key)?null:a);}
 const slots=new Map();
 const slotOf=(site,date,code)=>{const key=slotKey(site,date,code);if(!slots.has(key))slots.set(key,{key,site:text(site),date,code,names:[],starts:[],elbStarts:[],hours:[],stage:null,machines:new Map()});return slots.get(key);};
 const machineOf=(slot,key)=>{if(!slot.machines.has(key))slot.machines.set(key,{key,names:new Set(),trips:0,tippers:new Set(),loadings:[],untimed:0,cards:[],roster:null});return slot.machines.get(key);};
 for(const r of records){
  if(r.kind!=='vehicle'&&r.kind!=='equipment')continue;
  const slot=slotOf(r.location,r.bookDate,shiftCodeOf(r));
  slot.names.push(text(r.shiftName));slot.hours.push(num(r.shiftHours));
  if(r.kind==='equipment'){slot.elbStarts.push(text(r.masterShiftStart).slice(0,5));machineOf(slot,'id:'+r.assetId).cards.push(r);continue;}
  slot.starts.push(text(r.masterShiftStart).slice(0,5));
  // Trip times are read on the card's shift clock (owner, 17 Nov 2026): "12:50" on a Shift C card is 00:50.
  const rows=cardOnShiftClock(r).trips||[];
  rows.forEach((t,i)=>{
   if(isUnloadingOnlyTrip(t))return;
   const name=text(t.equipmentName),asset=t.equipmentId?byId.get(String(t.equipmentId)):doors.get(canonicalSiteName(r.location))?.get(fleetDoorKey(name));
   const machine=machineOf(slot,asset?'id:'+asset.id:t.equipmentId?'id:'+t.equipmentId:'name:'+(fleetDoorKey(name)||name.toUpperCase()));
   if(name)machine.names.add(name);
   machine.trips+=num(t.completedTrips)??num(t.tripCount)??0;
   if(text(r.door))machine.tippers.add(text(r.door));
   // A time outside the shift hours either way is a card mistake: the loading counts as untimed, not as an idle gap.
   const at=r.timeMode==='without'||t.outsideShift?null:clockMinutes(t.loadingTime);
   if(at===null){machine.untimed++;return;}
   // The tipper's own wait before this loading: from its unloading on the row above. A wait longer than a shift is a wrongly written time.
   const waited=i>0?minutesBetween(rows[i-1].unloadingTime,t.loadingTime):null;
   machine.loadings.push({at,clock:text(t.loadingTime).slice(0,5),recordId:String(r.id),book:r.book,row:i,sr:tripSerialNumber(t,i),door:text(r.door)||'Not recorded',driver:text(r.employeeName),caliberId:text(r.caliberId),
    waited:waited!==null&&waited<=DOUBTFUL_MINUTES?waited:null,unloadedAt:i>0?text(rows[i-1].unloadingTime).slice(0,5):''});
  });
 }
 // A machine on the site list of a batch with no ELB saved. The list follows the Site and Shift filters;
 // a filter on one vehicle, driver or work order leaves it out, because it belongs to no card.
 if(!filters.asset&&!filters.employee&&!filters.workOrder)for(const f of fleet){
  if(filters.site&&canonicalSiteName(f.site)!==canonicalSiteName(filters.site))continue;
  const key=slotKey(f.site,f.date,text(f.shift));
  if(filters.shift&&!slots.has(key))continue;
  const machine=machineOf(slotOf(f.site,f.date,text(f.shift)),'id:'+f.assetId);
  if(!machine.cards.length)machine.roster=f;
 }
 for(const b of batches){const slot=slots.get(slotKey(b.site,b.date,text(b.shift)));if(!slot)continue;const stage=b.stage in STAGE_RANK?b.stage:'vlb_open';if(slot.stage===null||STAGE_RANK[stage]<STAGE_RANK[slot.stage])slot.stage=stage;}
 const loaders=new Set();
 for(const slot of slots.values())for(const m of slot.machines.values())if(m.trips>0||m.loadings.length||m.untimed)loaders.add(m.key);
 const out=[];
 for(const slot of slots.values()){
  const preset=CARD_SHIFTS[normalizeCardShift(slot.code)],shift=mostCommon(slot.names)||slot.code,site=siteName(slot.site)||slot.site||'Unassigned';
  const start=clockMinutes(mostCommon(slot.starts)||mostCommon(slot.elbStarts)||preset?.start||''),shiftMinutes=(mostCommon(slot.hours)||preset?.hours||8)*60;
  for(const m of slot.machines.values()){
   const asset=m.key.startsWith('id:')?byId.get(m.key.slice(3)):null,last=m.cards.at(-1)||null;
   const machineName=text(last?.assetName||asset?.name||m.roster?.name),group=text(asset?.group||m.roster?.group);
   if(!loaders.has(m.key)&&!LOADER_WORDS.test(group+' '+machineName))continue;
   const worked=m.cards.map(cardWorkingHmr).filter(v=>v!==null),hours=worked.length?round3(worked.reduce((s,v)=>s+v,0)):null;
   const shiftHours=m.cards.length?num(m.cards[0].shiftHours):null;
   const bdValues=m.cards.map(c=>num(c.breakdownHours)).filter(v=>v!==null),bdHours=bdValues.length?Math.max(...bdValues):null;
   const status=text([...m.cards].reverse().find(c=>text(c.shiftStatus))?.shiftStatus);
   const running=m.trips>0||(hours??0)>0;
   const down=!running&&m.cards.length>0&&(status==='breakdown'||status==='maintenance'||bdHours!==null&&Boolean(shiftHours)&&bdHours>=shiftHours);
   let state=running?'running':down?'breakdown':'nohours';
   let statusLabel=running?(!m.cards.length?'Working · ELB not entered':status==='working_partial_breakdown'||bdHours>0?'Working, part breakdown':'Working')
    :down?(status==='maintenance'?'Maintenance':'Breakdown')
    :!m.cards.length?'ELB not entered':status==='no_operator'?'No operator':status==='not_in_use'?'Not in use':'No hours recorded';
   // Loadings in the order of the shift. Without a shift start, the longest silence of the day is the time outside the shift.
   let judged=[],outside=0;
   if(start!==null)for(const l of m.loadings){let off=(l.at-start+1440)%1440;if(off>=1440-EARLY)off-=1440;if(off>shiftMinutes+LATE)outside++;else judged.push({...l,off});}
   else if(m.loadings.length){
    const sorted=[...m.loadings].sort((a,b)=>a.at-b.at);let cut=0,widest=-1;
    sorted.forEach((l,i)=>{const gap=(l.at-sorted[(i-1+sorted.length)%sorted.length].at+1440)%1440;if(sorted.length>1&&gap>widest){widest=gap;cut=i;}});
    const first=sorted[cut].at;judged=sorted.map(l=>({...l,off:(l.at-first+1440)%1440}));
   }
   judged.sort((a,b)=>a.off-b.off||String(a.book).localeCompare(String(b.book))||a.row-b.row);
   // Breakdowns of the machine in this shift, as minutes from the start of the shift: from Pulse when it was read (owner,
   // 15 Nov 2026: a machine in BD for 15 minutes, an hour or two shows black on the strip, and pressing it gives the
   // reason), otherwise from the copy on the ELB card. Owner, same day: "take BD out of idle".
   const axisStart=start!==null?start:judged[0]?.at??null,shiftAt=start===null?NaN:Date.parse(slot.date+'T'+clockAt(start)+':00+05:30');
   const winFrom=Math.min(0,judged[0]?.off??0),winTo=Math.max(shiftMinutes,judged.at(-1)?.off??0);
   let source=[];
   if(live){
    const aliases=new Set([asset?.door,/\d/.test(text(asset?.name))?asset.name:'',m.roster?.door,last?.door,...m.names].map(identity).filter(Boolean)),chassis=identity(asset?.chassis);
    source=(requests.get(canonicalSiteName(slot.site))||[]).filter(r=>chassis&&r.chassisKey?chassis===r.chassisKey:r.keys.some(k=>aliases.has(k)))
     .map(r=>({reference:r.ref,reason:r.reason,status:r.status,start:r.start,end:r.end,ongoing:!r.end}));
   }else source=m.cards.flatMap(c=>Array.isArray(c.pulseBreakdowns)?c.pulseBreakdowns:[]).map(b=>({reference:b.reference,reason:b.description,status:b.status,start:b.start,end:b.end,ongoing:b.ongoing??!b.end,from:b.shiftStart,to:b.shiftEnd}));
   const seen=new Set(),bdPeriods=!Number.isFinite(shiftAt)?[]:source.map(b=>{
    const a=Date.parse(b.start),z=b.end?Date.parse(b.end):now,from=round1(Math.max(winFrom,(a-shiftAt)/60000)),to=round1(Math.min(winTo,(z-shiftAt)/60000));
    const minutes=round1(to-from);
    return {from,to,minutes,fromClock:clockAt(start,from),toClock:clockAt(start,to),reference:text(b.reference),reason:text(b.reason)||'Not written in Pulse',status:text(b.status)||(b.ongoing?'Ongoing':'Restored'),ongoing:Boolean(b.ongoing),
     started:stamp(b.start),ended:b.end?stamp(b.end):'',label:[text(b.reference),text(b.reason),clockAt(start,from)+' to '+clockAt(start,to)].filter(Boolean).join(' · ')};
   }).filter(p=>Number.isFinite(p.from)&&p.to>p.from&&!seen.has(p.reference+'|'+p.from)&&seen.add(p.reference+'|'+p.from)).sort((a,b)=>a.from-b.from);
   const bdSpans=mergePeriods(bdPeriods),bdMinutes=round1(overlap(bdSpans,0,shiftMinutes));
   // A machine that did not run and that Pulse shows in breakdown for the whole shift is in BD, ELB or not.
   if(state==='nohours'&&bdMinutes>=shiftMinutes-1){state='breakdown';statusLabel='Breakdown in Pulse';}
   // One line per timed loading in the order of the shift, with the gap from the loading before it. The first loading has no gap.
   // The minutes of a gap in breakdown are not idle: the stop is judged on what is left (`minutes`); `gap` is the whole of it.
   const count={b1:0,b2:0,b3:0,b4:0},lines=[],stopList=[],kept=new Set();let longest=null,idleMinutes=0,ok=0;
   judged.forEach((l,i)=>{
    const line={id:slot.key+'|'+m.key+'|'+i,n:i+1,minutes:null,gap:null,bdMinutes:0,band:'first',from:null,to:l,delayed:[],breakdown:''};
    lines.push(line);if(i===0)return;
    line.from=judged[i-1];line.gap=round1(l.off-line.from.off);line.bdMinutes=round1(overlap(bdSpans,line.from.off,l.off));
    line.minutes=round1(Math.max(0,line.gap-line.bdMinutes));line.band=bandOf(line.minutes);
    line.breakdown=bdPeriods.filter(p=>p.from<l.off&&p.to>line.from.off).map(p=>p.label).join('; ');
    if(longest===null||line.minutes>longest)longest=line.minutes;
    if(line.band==='ok'){ok++;return;}
    count[line.band]++;idleMinutes+=line.minutes;stopList.push(line);
    line.delayed=tippersKeptWaiting(judged,i,bdSpans);line.delayed.forEach(d=>kept.add(d.key));
   });
   const door=text(asset?.door||last?.door||m.roster?.door)||[...m.names][0]||'Not recorded';
   out.push({id:slot.key+'|'+m.key,slotKey:slot.key,machineKey:m.key,site,date:slot.date,shiftCode:slot.code,shift,stage:slot.stage||'',
    // Equipment category (owner, 16 Nov 2026): the machine's group in the Equipment master, named as OT & Multiple Duties names it.
    door,machineName,category:equipmentGroupName(group),names:[...m.names],operator:unique(m.cards.flatMap(c=>[text(c.employeeName),text(c.operatorSplit?.secondOperatorName)])).join(', '),
    state,status,statusLabel,reason:text(last?.statusReason||last?.remark),elbBooks:unique(m.cards.map(c=>text(c.book))).join(', '),
    breakdowns:(bdPeriods.length?bdPeriods.map(b=>[b.reference,b.reason,[b.started,b.ended||'ongoing'].filter(Boolean).join(' to ')].filter(Boolean).join(' · '))
     :source.map(b=>[text(b.reference),text(b.reason),[stamp(b.start),b.end?stamp(b.end):'ongoing'].filter(Boolean).join(' to ')].filter(Boolean).join(' · '))).join('; '),
    // Each Pulse breakdown of the machine that touches the shift, whole (owner, 16 Nov 2026: pressing Breakdown in Pulse
    // shows its details), with the minutes and clock times it took inside this shift.
    bdRequests:breakdownRequests(source,bdPeriods,now),
    // elbEntered: an ELB card was saved for the machine in this shift (owner, 17 Nov 2026: the BD mismatch report names
    // the shifts where Pulse shows a breakdown and no ELB was entered).
    elbEntered:m.cards.length>0,
    trips:m.trips,tippers:[...m.tippers],hours,shiftHours,percent:percentWorked(hours,shiftHours),bdHours,bdMinutes,
    loadings:judged.length,gaps:Math.max(judged.length-1,0),firstLoading:judged[0]?.clock||'',lastLoading:judged.at(-1)?.clock||'',ok,...count,stops:stopList.length,idleMinutes:round1(idleMinutes),longest,notJudged:m.untimed+outside,delayed:kept.size,stopList,
    lines,bdPeriods,axis:{start:axisStart,known:start!==null,minutes:shiftMinutes}});
  }
 }
 return out;
}

const keyOf={site:e=>e.site,shift:e=>e.slotKey,category:e=>e.category,machine:e=>e.machineKey};
export const groupKey=(group,entry)=>keyOf[group](entry);
function totals(list){
 const t={machineShifts:list.length,running:0,breakdown:0,nohours:0,trips:0,hours:null,shiftHours:0,percent:null,bdHours:null,bdMinutes:0,loadings:0,ok:0,b1:0,b2:0,b3:0,b4:0,gaps:0,stops:0,idleMinutes:0,longest:null,notJudged:0,delayed:0};
 const tippers=new Set();let judgedHours=0;
 for(const e of list){
  t[e.state]++;t.trips+=e.trips;t.loadings+=e.loadings;t.ok+=e.ok;t.delayed+=e.delayed;e.tippers.forEach(d=>tippers.add(d));
  if(e.hours!==null)t.hours=(t.hours??0)+e.hours;
  // The share worked counts only the machine shifts whose ELB gives both the hours worked and the hours of the shift.
  if(e.hours!==null&&e.shiftHours){judgedHours+=e.hours;t.shiftHours+=e.shiftHours;}
  if(e.bdHours!==null)t.bdHours=(t.bdHours??0)+e.bdHours;
  for(const b of BANDS)t[b.key]+=e[b.key];
  t.gaps+=e.gaps;t.stops+=e.stops;t.idleMinutes+=e.idleMinutes;t.notJudged+=e.notJudged;t.bdMinutes+=e.bdMinutes||0;
  if(e.longest!==null&&(t.longest===null||e.longest>t.longest))t.longest=e.longest;
 }
 t.tipperCount=tippers.size;t.idleMinutes=round1(t.idleMinutes);t.bdMinutes=round1(t.bdMinutes);t.percent=percentWorked(t.shiftHours?judgedHours:null,t.shiftHours);
 if(t.hours!==null)t.hours=round3(t.hours);if(t.bdHours!==null)t.bdHours=round3(t.bdHours);
 for(const b of BANDS)t[b.key+'Share']=bandShare(t[b.key],t.gaps);
 return t;
}
const STATE_ORDER={running:0,mixed:0,breakdown:1,nohours:2};
const hoursOrder=r=>r.hours===null||r.hours===undefined||!Number.isFinite(Number(r.hours))?Infinity:Number(r.hours);
// One line per site, per date and shift, or per machine, with the machines in each state and the idle stops in each band.
// `total` is the line for all of them.
export function summarise(entries,group){
 const groups=new Map();
 for(const e of entries){const key=keyOf[group](e);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
 const rows=[...groups.entries()].map(([key,list])=>{
  const f=list[0],t=totals(list),one=list.length===1,state=t.running===list.length?'running':t.breakdown===list.length?'breakdown':t.nohours===list.length?'nohours':'mixed';
  return {id:group+':'+key,key,site:f.site,sites:unique(list.map(e=>e.site)).join(', '),date:f.date,shift:f.shift,stage:f.stage,stageLabel:STAGE_LABELS[f.stage]||STAGE_LABELS[''],door:f.door,machineName:f.machineName,category:f.category,machineCount:new Set(list.map(e=>e.machineKey)).size,operator:unique(list.flatMap(e=>e.operator.split(', '))).join(', '),state,
   statusLabel:one?f.statusLabel:[t.running&&'Ran '+t.running+' shift'+(t.running===1?'':'s'),t.breakdown&&'In BD '+t.breakdown,t.nohours&&'No hours '+t.nohours].filter(Boolean).join(' · '),
   reason:one?f.reason:'',elbBooks:one?f.elbBooks:'',firstLoading:one?f.firstLoading:'',lastLoading:one?f.lastLoading:'',...t};
 });
 if(group==='site')rows.sort((a,b)=>a.site.localeCompare(b.site));
 else if(group==='shift')rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.shift.localeCompare(b.shift,undefined,{numeric:true}));
 // Equipment categories: the most idle on top, as the machines.
 else if(group==='category')rows.sort((a,b)=>b.idleMinutes-a.idleMinutes||b.machineShifts-a.machineShifts||a.category.localeCompare(b.category));
 // Owner, 17 Nov 2026: running machines first, the fewest hours worked on top (2.5 h before 3 h), a running machine
 // without hours on its ELB after them; then the machines in BD; then the machines with no hours. Equal hours: the most idle first.
 else rows.sort((a,b)=>STATE_ORDER[a.state]-STATE_ORDER[b.state]||hoursOrder(a)-hoursOrder(b)||b.idleMinutes-a.idleMinutes||b.stops-a.stops||b.trips-a.trips||a.door.localeCompare(b.door,undefined,{numeric:true}));
 return {rows,total:{id:group+':total',key:null,total:true,site:'ALL SITES',date:'',shift:'ALL SHIFTS',stage:'',stageLabel:'',door:'TOTAL',machineName:'',category:'ALL CATEGORIES',machineCount:new Set(entries.map(e=>e.machineKey)).size,operator:'',state:'',statusLabel:'',reason:'',elbBooks:'',firstLoading:'',lastLoading:'',...totals(entries)}};
}
const shiftOrder=(a,b)=>String(b.date).localeCompare(String(a.date))||a.shift.localeCompare(b.shift,undefined,{numeric:true});
// Every timed loading behind a line, newest shift first and in the order of the shift, each with the gap from the loading
// before it and its colour. `pick` keeps one group only: 'ok' (up to 5 minutes), one band, or 'stops' (every band).
export function loadingLines(entries,pick=''){
 const keep=pick==='stops'?l=>l.band!=='ok'&&l.band!=='first':pick?l=>l.band===pick:()=>true;
 return entries.flatMap(e=>e.lines.filter(keep).map(l=>({...l,tone:TONES[l.band],site:e.site,date:e.date,shift:e.shift,machine:e.door,machineKey:e.machineKey,slotKey:e.slotKey})))
  .sort((a,b)=>shiftOrder(a,b)||a.machine.localeCompare(b.machine,undefined,{numeric:true})||a.to.off-b.to.off);
}
// The idle stops behind a line, newest shift first and in the order of the shift. `band` keeps one band only.
export function idleStops(entries,band=''){return loadingLines(entries,band||'stops');}
// The picture of one machine shift for the screen: the gaps between its loadings as coloured pieces laid on the hours of
// the shift, and for every hour the loadings and the minutes in each colour. Positions are minutes from the start of the
// shift (from the first loading when the shift start is not known). Null when the machine has no timed loading.
// Owner, 15 Nov 2026: on the strip a gap changes colour as its minutes pass ("where it was green, where it became orange,
// and where it became red with that same timer mark"): green for the first 5 minutes after a loading, orange from the 5th
// minute, red from the 20th, until the next loading. Only the drawing follows the clock; a stop is still counted in the
// band of its full length.
export const RED_AFTER=20;
// Owner, 15 Nov 2026: the minutes in breakdown are black and are not idle. The idle clock stops while the machine is in
// breakdown and goes on from where it stopped when the breakdown ends: 3 green minutes, a breakdown, then 2 more green
// and the gap turns orange. `down` are the breakdown periods of the shift (mergePeriods).
export function gapParts(from,to,down=[]){
 const parts=[];let idle=0,at=from;
 const push=(a,b,tone)=>{if(b-a<=1e-9)return;const prev=parts.at(-1);if(prev&&prev.tone===tone&&Math.abs(prev.to-a)<1e-9)prev.to=b;else parts.push({from:a,to:b,tone});};
 const run=(a,b)=>{
  // Idle minutes from `a` to `b`, the idle clock standing at `idle` minutes at `a`.
  const greenEnd=a+Math.max(0,IDLE_LIMIT-idle),orangeEnd=a+Math.max(0,RED_AFTER-idle);
  push(a,Math.min(b,greenEnd),'green');push(Math.max(a,greenEnd),Math.min(b,orangeEnd),'orange');push(Math.max(a,orangeEnd),b,'red');
  idle+=b-a;
 };
 for(const p of down){
  if(p.to<=at||p.from>=to)continue;
  const a=Math.max(at,p.from),b=Math.min(to,p.to);
  if(a>at)run(at,a);
  push(a,b,'bd');at=b;
 }
 if(to>at)run(at,to);
 return parts.map(p=>({from:round1(p.from),to:round1(p.to),tone:p.tone}));
}
// The Pulse breakdowns of one machine shift, one line per breakdown (the same reference and start once): when it began
// and ended in Pulse, its whole length, and the part of it inside this shift (`periods`, minutes from the shift start).
export function breakdownRequests(source=[],periods=[],now=Date.now()){
 const seen=new Set(),out=[];
 for(const b of source){
  const reference=text(b.reference),key=reference+'|'+text(b.start);if(seen.has(key))continue;seen.add(key);
  const a=Date.parse(b.start),z=b.end?Date.parse(b.end):now,inside=periods.filter(p=>p.reference===reference);
  out.push({reference,reason:text(b.reason)||'Not written in Pulse',status:text(b.status)||(b.ongoing?'Ongoing':'Restored'),ongoing:Boolean(b.ongoing),
   start:text(b.start),end:b.end?text(b.end):'',started:stamp(b.start),ended:b.end?stamp(b.end):'',
   totalMinutes:Number.isFinite(a)&&Number.isFinite(z)&&z>=a?round1((z-a)/60000):null,
   shiftMinutes:round1(inside.reduce((s,p)=>s+p.minutes,0)),inShift:inside.map(p=>p.fromClock+' to '+p.toClock).join(', ')});
 }
 return out.sort((x,y)=>String(x.start).localeCompare(String(y.start)));
}
// The wording of a breakdown, for its pop-up and the line under the strip when it is pressed.
export function breakdownText(b){
 const length=b.minutes>=60?Math.floor(b.minutes/60)+' h '+String(Math.round(b.minutes%60)).padStart(2,'0')+' min':Math.round(b.minutes)+' min';
 return ['Breakdown · '+b.fromClock+' to '+b.toClock+' · '+length+' in this shift',b.reference&&'Pulse '+b.reference,'Reason: '+b.reason,
  b.ongoing?'Still open in Pulse (started '+b.started+')':b.status+(b.started?' (from '+b.started+' to '+b.ended+')':'')].filter(Boolean).join(' · ');
}
export function shiftTimeline(entry){
 const lines=entry.lines||[],periods=entry.bdPeriods||[];
 // A machine with no timed loading is still drawn when Pulse shows it in breakdown during the shift.
 if(!lines.length&&!(periods.length&&entry.axis.known))return null;
 const start=entry.axis.start,first=lines.length?lines[0].to.off:null,last=lines.length?lines.at(-1).to.off:null;
 const shiftMinutes=entry.axis.known?entry.axis.minutes:Math.max(60,last);
 const lo=Math.floor(Math.min(0,first??0)/60)*60,hi=Math.ceil(Math.max(shiftMinutes,last??0)/60)*60;
 const down=mergePeriods(periods.map(p=>({from:Math.max(lo,p.from),to:Math.min(hi,p.to)})).filter(p=>p.to>p.from));
 const pieces=lines.filter(l=>l.from).map(l=>{
  const parts=gapParts(l.from.off,l.to.off,down);
  // The clock times at which the gap turned orange and red: the "timer marks" of the strip. A breakdown and its end are
  // marked by the breakdown itself, so the turns name only the idle colours.
  const turns=parts.slice(1).filter((p,i)=>p.tone!=='bd'&&parts[i].tone!=='bd').map(p=>({at:p.from,tone:p.tone,clock:clockAt(start,p.from)}));
  // Every change of colour in words, the breakdown and its end included, for the pop-up and the line under the strip.
  const events=parts.slice(1).map((part,i)=>({clock:clockAt(start,part.from),words:part.tone==='bd'?'breakdown':parts[i].tone==='bd'?'breakdown over, '+part.tone:'turned '+part.tone}));
  return {id:l.id,events,from:l.from.off,to:l.to.off,minutes:l.minutes,gap:l.gap??l.minutes,bdMinutes:l.bdMinutes||0,band:l.band,tone:TONES[l.band],fromClock:l.from.clock,toClock:l.to.clock,fromDoor:l.from.door,door:l.to.door,delayed:l.delayed.length,breakdown:l.breakdown,parts,turns};
 });
 const hours=[];
 for(let h=lo;h<hi;h+=60){
  // `count` is the loadings of the hour by the colour of the gap before each; green, orange and red are the minutes of
  // the hour drawn in each colour on the strip, bd the minutes in breakdown.
  const hour={id:entry.id+'|h'+h,from:h,to:h+60,label:clockAt(start,h)+' to '+clockAt(start,h+60),loadings:0,count:{green:0,orange:0,red:0},green:0,orange:0,red:0,bd:0,longest:null};
  for(const l of lines)if(l.to.off>=h&&l.to.off<h+60){hour.loadings++;if(l.from)hour.count[TONES[l.band]]++;}
  for(const p of pieces){
   if(Math.min(p.to,h+60)-Math.max(p.from,h)<=0)continue;
   for(const part of p.parts){if(part.tone==='bd')continue;const share=Math.min(part.to,h+60)-Math.max(part.from,h);if(share>0)hour[part.tone]+=share;}
   if(p.tone!=='green'&&(hour.longest===null||p.minutes>hour.longest))hour.longest=p.minutes;
  }
  hour.bd=overlap(down,h,h+60);
  for(const tone of ['green','orange','red','bd'])hour[tone]=round1(hour[tone]);
  // What is left of the hour lies before the first loading or after the last one: the report does not judge it.
  hour.rest=round1(Math.max(0,60-hour.green-hour.orange-hour.red-hour.bd));
  hour.worst=hour.red>0?'red':hour.orange>0?'orange':hour.bd>0?'bd':hour.green>0?'green':'rest';
  hours.push(hour);
 }
 const marks=[];for(let h=lo;h<=hi;h+=60)marks.push({at:h,clock:clockAt(start,h),edge:entry.axis.known&&(h===0||h===shiftMinutes)});
 // A small tick every quarter of an hour between the hour marks.
 const ticks=[];for(let m=lo+15;m<hi;m+=15)if(m%60)ticks.push(m);
 // With the shift hours known, the whole shift is drawn: the time before the first loading and after the last is named.
 const lead=entry.axis.known&&first!==null&&first>0?{from:0,to:first,clock:lines[0].to.clock,minutes:round1(first)}:null;
 const tail=entry.axis.known&&last!==null&&last<shiftMinutes?{from:last,to:shiftMinutes,clock:lines.at(-1).to.clock,minutes:round1(shiftMinutes-last)}:null;
 const empty=!lines.length?{from:0,to:shiftMinutes}:null;
 const breakdowns=periods.map((p,i)=>({...p,id:entry.id+'|bd'+i,from:Math.max(lo,p.from),to:Math.min(hi,p.to)})).filter(p=>p.to>p.from);
 return {lo,hi,shiftMinutes,known:entry.axis.known,first,last,firstClock:lines[0]?.to.clock||'',lastClock:lines.at(-1)?.to.clock||'',pieces,hours,marks,ticks,lead,tail,empty,breakdowns,bdMinutes:round1(overlap(down,lo,hi))};
}
// The clock tags printed under one strip, so that no two overlap: the breakdowns first (when each began and ended), then
// the turns of the red stops, then the time each red stop ended, then the turns of the orange stops from the longest down.
// `width` is a tag's width in minutes of the strip for each letter and `pad` its padding and edge; a tag that finds no room
// in `lanes` rows is left to the pop-up of its piece and to the list below. A tag that would run past the end of the strip
// is drawn to the left of its time.
export function clockTags(t,{width=1,lanes=3,pad=0}={}){
 const wanted=[];
 for(const b of t.breakdowns||[]){
  wanted.push({id:b.id+'|from',at:b.from,tone:'bd',text:b.fromClock+' BD',rank:0,minutes:b.minutes,breakdown:b.id});
  if(!b.ongoing&&b.to<t.hi)wanted.push({id:b.id+'|to',at:b.to,tone:'bdover',text:b.toClock+' BD over',rank:0,minutes:b.minutes,breakdown:b.id});
 }
 for(const p of t.pieces){
  if(p.band==='ok')continue;
  for(const turn of p.turns)wanted.push({id:p.id+'|'+turn.tone+turn.at,at:turn.at,tone:turn.tone,text:turn.clock+' '+turn.tone,rank:p.tone==='red'?1:3,minutes:p.minutes,piece:p.id});
  if(p.tone==='red')wanted.push({id:p.id+'|end',at:p.to,tone:'green',text:p.toClock+' loaded',rank:2,minutes:p.minutes,piece:p.id});
 }
 wanted.sort((a,b)=>a.rank-b.rank||b.minutes-a.minutes||a.at-b.at);
 const rows=Array.from({length:lanes},()=>[]),placed=[];
 for(const w of wanted){
  const size=w.text.length*width+pad,end=w.at+size>t.hi;
  const from=end?w.at-size:w.at,to=end?w.at:w.at+size;
  const lane=rows.findIndex(row=>row.every(r=>to+width<=r.from||from>=r.to+width));
  if(lane<0)continue;
  rows[lane].push({from,to});placed.push({...w,lane,end});
 }
 return placed.sort((a,b)=>a.at-b.at||a.lane-b.lane);
}
// The shifts in which a machine did not run, newest first, with what its ELB and Pulse say.
export function shiftsNotWorked(entries){
 return entries.filter(e=>e.state!=='running').sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.shift.localeCompare(b.shift,undefined,{numeric:true})||a.door.localeCompare(b.door,undefined,{numeric:true}));
}
