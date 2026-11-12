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
import {tripSerialNumber} from './log-book-labels.mjs';
import {siteLabels} from './trip-timing-report.mjs';

// Owner's bands (13 Nov 2026): a machine is idle when more than 5 minutes pass between two loadings.
// He named 5 to 10, 10 to 15 and 15 to 20; 20+ is added so that a longer stop is not lost.
export const IDLE_LIMIT=5;
export const BANDS=[{key:'b1',label:'5 to 10 min',above:5,upTo:10},{key:'b2',label:'10 to 15 min',above:10,upTo:15},{key:'b3',label:'15 to 20 min',above:15,upTo:20},{key:'b4',label:'20+ min',above:20,upTo:Infinity}];
export const BAND_LABELS={ok:'Up to '+IDLE_LIMIT+' min',...Object.fromEntries(BANDS.map(b=>[b.key,b.label]))};
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

// One entry per loading machine, site, date and shift. `records` are rows from normalise(); `assets`, `fleet` and
// `batches` come with them from GET /api/reports/operations. `fleet` lists the site machines of a batch with no saved ELB.
export function machineShifts(records,{assets=[],fleet=[],batches=[],filters={}}={}){
 const siteName=siteLabels(records);
 const byId=new Map(assets.map(a=>[String(a.id),a]));
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
  (r.trips||[]).forEach((t,i)=>{
   if(isUnloadingOnlyTrip(t))return;
   const name=text(t.equipmentName),asset=t.equipmentId?byId.get(String(t.equipmentId)):doors.get(canonicalSiteName(r.location))?.get(fleetDoorKey(name));
   const machine=machineOf(slot,asset?'id:'+asset.id:t.equipmentId?'id:'+t.equipmentId:'name:'+(fleetDoorKey(name)||name.toUpperCase()));
   if(name)machine.names.add(name);
   machine.trips+=num(t.completedTrips)??num(t.tripCount)??0;
   if(text(r.door))machine.tippers.add(text(r.door));
   const at=r.timeMode==='without'?null:clockMinutes(t.loadingTime);
   if(at===null)machine.untimed++;
   else machine.loadings.push({at,clock:text(t.loadingTime).slice(0,5),recordId:String(r.id),book:r.book,row:i,sr:tripSerialNumber(t,i),door:text(r.door)||'Not recorded',driver:text(r.employeeName),caliberId:text(r.caliberId)});
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
   const state=running?'running':down?'breakdown':'nohours';
   const statusLabel=running?(!m.cards.length?'Working · ELB not entered':status==='working_partial_breakdown'||bdHours>0?'Working, part breakdown':'Working')
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
   const count={b1:0,b2:0,b3:0,b4:0},stopList=[];let longest=null,idleMinutes=0;
   for(let i=1;i<judged.length;i++){
    const minutes=round1(judged[i].off-judged[i-1].off),band=bandOf(minutes);
    if(longest===null||minutes>longest)longest=minutes;
    if(band==='ok')continue;
    count[band]++;idleMinutes+=minutes;stopList.push({id:slot.key+'|'+m.key+'|'+i,minutes,band,from:judged[i-1],to:judged[i]});
   }
   const door=text(asset?.door||last?.door||m.roster?.door)||[...m.names][0]||'Not recorded';
   out.push({id:slot.key+'|'+m.key,slotKey:slot.key,machineKey:m.key,site,date:slot.date,shiftCode:slot.code,shift,stage:slot.stage||'',
    door,machineName,names:[...m.names],operator:unique(m.cards.flatMap(c=>[text(c.employeeName),text(c.operatorSplit?.secondOperatorName)])).join(', '),
    state,status,statusLabel,reason:text(last?.statusReason||last?.remark),elbBooks:unique(m.cards.map(c=>text(c.book))).join(', '),
    breakdowns:m.cards.flatMap(c=>Array.isArray(c.pulseBreakdowns)?c.pulseBreakdowns:[]).map(b=>[text(b.reference),text(b.description),[stamp(b.start),b.end?stamp(b.end):'ongoing'].filter(Boolean).join(' to ')].filter(Boolean).join(' · ')).join('; '),
    trips:m.trips,tippers:[...m.tippers],hours,shiftHours,percent:percentWorked(hours,shiftHours),bdHours,
    loadings:judged.length,gaps:Math.max(judged.length-1,0),firstLoading:judged[0]?.clock||'',lastLoading:judged.at(-1)?.clock||'',...count,stops:stopList.length,idleMinutes:round1(idleMinutes),longest,notJudged:m.untimed+outside,stopList});
  }
 }
 return out;
}

const keyOf={site:e=>e.site,shift:e=>e.slotKey,machine:e=>e.machineKey};
export const groupKey=(group,entry)=>keyOf[group](entry);
function totals(list){
 const t={machineShifts:list.length,running:0,breakdown:0,nohours:0,trips:0,hours:null,shiftHours:0,percent:null,bdHours:null,b1:0,b2:0,b3:0,b4:0,gaps:0,stops:0,idleMinutes:0,longest:null,notJudged:0};
 const tippers=new Set();let judgedHours=0;
 for(const e of list){
  t[e.state]++;t.trips+=e.trips;e.tippers.forEach(d=>tippers.add(d));
  if(e.hours!==null)t.hours=(t.hours??0)+e.hours;
  // The share worked counts only the machine shifts whose ELB gives both the hours worked and the hours of the shift.
  if(e.hours!==null&&e.shiftHours){judgedHours+=e.hours;t.shiftHours+=e.shiftHours;}
  if(e.bdHours!==null)t.bdHours=(t.bdHours??0)+e.bdHours;
  for(const b of BANDS)t[b.key]+=e[b.key];
  t.gaps+=e.gaps;t.stops+=e.stops;t.idleMinutes+=e.idleMinutes;t.notJudged+=e.notJudged;
  if(e.longest!==null&&(t.longest===null||e.longest>t.longest))t.longest=e.longest;
 }
 t.tipperCount=tippers.size;t.idleMinutes=round1(t.idleMinutes);t.percent=percentWorked(t.shiftHours?judgedHours:null,t.shiftHours);
 if(t.hours!==null)t.hours=round3(t.hours);if(t.bdHours!==null)t.bdHours=round3(t.bdHours);
 for(const b of BANDS)t[b.key+'Share']=bandShare(t[b.key],t.gaps);
 return t;
}
const STATE_ORDER={running:0,mixed:0,breakdown:1,nohours:2};
// One line per site, per date and shift, or per machine, with the machines in each state and the idle stops in each band.
// `total` is the line for all of them.
export function summarise(entries,group){
 const groups=new Map();
 for(const e of entries){const key=keyOf[group](e);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
 const rows=[...groups.entries()].map(([key,list])=>{
  const f=list[0],t=totals(list),one=list.length===1,state=t.running===list.length?'running':t.breakdown===list.length?'breakdown':t.nohours===list.length?'nohours':'mixed';
  return {id:group+':'+key,key,site:f.site,date:f.date,shift:f.shift,stage:f.stage,stageLabel:STAGE_LABELS[f.stage]||STAGE_LABELS[''],door:f.door,machineName:f.machineName,operator:unique(list.flatMap(e=>e.operator.split(', '))).join(', '),state,
   statusLabel:one?f.statusLabel:[t.running&&'Ran '+t.running+' shift'+(t.running===1?'':'s'),t.breakdown&&'In BD '+t.breakdown,t.nohours&&'No hours '+t.nohours].filter(Boolean).join(' · '),
   reason:one?f.reason:'',elbBooks:one?f.elbBooks:'',firstLoading:one?f.firstLoading:'',lastLoading:one?f.lastLoading:'',...t};
 });
 if(group==='site')rows.sort((a,b)=>a.site.localeCompare(b.site));
 else if(group==='shift')rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.shift.localeCompare(b.shift,undefined,{numeric:true}));
 // Running machines first, the most idle on top; then the machines in BD; then the machines with no hours.
 else rows.sort((a,b)=>STATE_ORDER[a.state]-STATE_ORDER[b.state]||b.idleMinutes-a.idleMinutes||b.stops-a.stops||b.trips-a.trips||a.door.localeCompare(b.door,undefined,{numeric:true}));
 return {rows,total:{id:group+':total',key:null,total:true,site:'ALL SITES',date:'',shift:'ALL SHIFTS',stage:'',stageLabel:'',door:'TOTAL',machineName:'',operator:'',state:'',statusLabel:'',reason:'',elbBooks:'',firstLoading:'',lastLoading:'',...totals(entries)}};
}
// The idle stops behind a line, newest shift first and in the order of the shift. `band` keeps one band only.
export function idleStops(entries,band=''){
 return entries.flatMap(e=>e.stopList.filter(s=>!band||s.band===band).map(s=>({...s,site:e.site,date:e.date,shift:e.shift,machine:e.door})))
  .sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.shift.localeCompare(b.shift,undefined,{numeric:true})||a.machine.localeCompare(b.machine,undefined,{numeric:true})||a.from.off-b.from.off);
}
// The shifts in which a machine did not run, newest first, with what its ELB and Pulse say.
export function shiftsNotWorked(entries){
 return entries.filter(e=>e.state!=='running').sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.shift.localeCompare(b.shift,undefined,{numeric:true})||a.door.localeCompare(b.door,undefined,{numeric:true}));
}
