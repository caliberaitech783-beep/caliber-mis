// BD hours report (owner, 17 Nov 2026): the breakdown hours of every loading machine shift, taken both from Pulse (the
// start and end of each breakdown, only the part inside the shift) and from the ELB as the site typed it ("Hours in BD"),
// side by side, highest first; and the mismatch between the two.
//
// It reads the machine shifts the Loading machines report already builds (shared/loading-machine-report.mjs): `bdMinutes`
// is Pulse inside the shift (a breakdown still open counts to the end of the shift), `bdHours` is the ELB figure, and
// `elbEntered` says whether an ELB card was saved for that machine and shift.
import {groupKey} from './loading-machine-report.mjs';

// Within this many minutes the two figures agree (owner's pick, 17 Nov 2026: 30 minutes).
export const BD_TOLERANCE_MINUTES=30;

// The kinds of a machine shift with a breakdown on either side, worst first.
export const MISMATCH_KINDS=[
 {key:'pulseonly',label:'BD in Pulse, not on ELB',short:'Pulse only',tone:'red'},
 {key:'elbonly',label:'BD on ELB, not in Pulse',short:'ELB only',tone:'red'},
 {key:'elbmore',label:'ELB more than Pulse',short:'ELB more',tone:'orange'},
 {key:'pulsemore',label:'Pulse more than ELB',short:'Pulse more',tone:'orange'},
 {key:'noelb',label:'ELB not entered',short:'No ELB',tone:'brown'},
 {key:'match',label:'Match',short:'Match',tone:'green'}
];
export const KIND_LABELS=Object.fromEntries(MISMATCH_KINDS.map(k=>[k.key,k.label]));
const KIND_RANK=Object.fromEntries(MISMATCH_KINDS.map((k,i)=>[k.key,i]));
const MISMATCHES=MISMATCH_KINDS.filter(k=>k.key!=='match').map(k=>k.key);

const round1=n=>Math.round(n*10)/10;
const round2=n=>Math.round(n*100)/100;
const num=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);

// Hours as the site writes them: one decimal (2.5). Null stays a dash.
export function hoursText(minutes){return minutes===null||minutes===undefined?'—':String(round1(minutes/60));}
// The difference ELB minus Pulse, in hours with its sign: "+0.8", "-1.2", "0".
export function differenceText(minutes){
 if(minutes===null||minutes===undefined)return '—';
 const h=round1(minutes/60);
 return h>0?'+'+h:String(h===0?0:h);
}

// The kind of one machine shift. Null when neither Pulse nor the ELB shows a breakdown (nothing to compare).
export function mismatchKind({pulseMinutes=0,elbHours=null,elbEntered=true}={},tolerance=BD_TOLERANCE_MINUTES){
 const pulse=Math.max(0,num(pulseMinutes)||0),elb=num(elbHours);
 const elbMinutes=elb===null?0:Math.max(0,elb*60);
 if(!elbEntered)return pulse>0?'noelb':null;
 if(pulse<=0&&elbMinutes<=0)return null;
 if(pulse>0&&elbMinutes<=0)return 'pulseonly';
 if(elbMinutes>0&&pulse<=0)return 'elbonly';
 const diff=elbMinutes-pulse;
 return diff>tolerance?'elbmore':diff< -tolerance?'pulsemore':'match';
}

// One line per machine shift with a breakdown on either side.
export function bdLines(entries=[],tolerance=BD_TOLERANCE_MINUTES){
 const out=[];
 for(const e of entries){
  const pulseMinutes=round1(Math.max(0,num(e.bdMinutes)||0)),elbHours=num(e.bdHours),elbEntered=e.elbEntered!==false;
  const kind=mismatchKind({pulseMinutes,elbHours,elbEntered},tolerance);
  if(!kind)continue;
  const elbMinutes=elbHours===null?null:round1(elbHours*60);
  // Only the Pulse requests that fall inside this shift: the machine's list (bdRequests) holds every request of the
  // machine in the dates read, so a request of another day would otherwise be named on a shift with 0 Pulse hours
  // (found on live data, 17 Nov 2026, Gauri Pauni: 4 requests named on a shift whose Pulse hours were 0).
  const requests=(e.bdRequests||[]).filter(r=>r.shiftMinutes>0);
  out.push({...e,pulseMinutes,elbMinutes,elbEntered,kind,kindLabel:KIND_LABELS[kind],tone:MISMATCH_KINDS[KIND_RANK[kind]].tone,shiftRequests:requests,
   diffMinutes:elbEntered?round1((elbMinutes||0)-pulseMinutes):null,
   breakdownCount:requests.length||(e.bdPeriods||[]).length,
   pulseReasons:[...new Set(requests.map(r=>r.reason).filter(Boolean))].join('; ')||[...new Set((e.bdPeriods||[]).map(p=>p.reason).filter(Boolean))].join('; '),
   pulseRefs:[...new Set(requests.map(r=>r.reference).filter(Boolean))].join(', ')||[...new Set((e.bdPeriods||[]).map(p=>p.reference).filter(Boolean))].join(', '),
   stillOpen:requests.some(r=>r.ongoing)||(e.bdPeriods||[]).some(p=>p.ongoing)});
 }
 return out;
}

function totals(list){
 const t={machineShifts:list.length,pulseMinutes:0,elbMinutes:0,diffMinutes:0,breakdownCount:0,mismatches:0,...Object.fromEntries(MISMATCH_KINDS.map(k=>[k.key,0]))};
 const machines=new Set(),bdMachines=new Set();
 for(const l of list){
  machines.add(l.machineKey);if(l.pulseMinutes>0||l.elbMinutes>0)bdMachines.add(l.machineKey);
  t.pulseMinutes+=l.pulseMinutes;t.elbMinutes+=l.elbMinutes||0;t.breakdownCount+=l.breakdownCount;t[l.kind]++;
  if(MISMATCHES.includes(l.kind))t.mismatches++;
 }
 t.pulseMinutes=round1(t.pulseMinutes);t.elbMinutes=round1(t.elbMinutes);t.diffMinutes=round1(t.elbMinutes-t.pulseMinutes);
 t.machineCount=machines.size;t.bdMachineCount=bdMachines.size;
 // Hours for the date by shift grid: whole tenths so a box reads like the lines.
 t.pulseHours=round2(t.pulseMinutes/60);t.elbHours=round2(t.elbMinutes/60);
 return t;
}

const unique=list=>[...new Set(list.filter(Boolean))];
// `mode`: 'bd' sorts by Pulse BD hours, highest first; 'mismatch' puts the mismatches first, the biggest difference on top.
export function summariseBd(lines=[],group,mode='bd'){
 const groups=new Map();
 for(const l of lines){const key=groupKey(group,l);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(l);}
 const rows=[...groups.entries()].map(([key,list])=>{
  const f=list[0],one=list.length===1,t=totals(list);
  const worst=list.reduce((w,l)=>KIND_RANK[l.kind]<KIND_RANK[w]?l.kind:w,'match');
  return {id:group+':'+key,key,site:f.site,sites:unique(list.map(l=>l.site)).join(', '),date:f.date,shift:f.shift,door:f.door,machineName:f.machineName,category:f.category,
   operator:unique(list.flatMap(l=>String(l.operator||'').split(', '))).join(', '),statusLabel:one?f.statusLabel:'',
   kind:one?f.kind:worst,kindLabel:one?f.kindLabel:KIND_LABELS[worst],tone:MISMATCH_KINDS[KIND_RANK[one?f.kind:worst]].tone,
   pulseReasons:unique(list.flatMap(l=>String(l.pulseReasons||'').split('; '))).join('; '),pulseRefs:unique(list.flatMap(l=>String(l.pulseRefs||'').split(', '))).join(', '),
   stillOpen:list.some(l=>l.stillOpen),elbBooks:unique(list.flatMap(l=>String(l.elbBooks||'').split(', '))).join(', '),reason:one?f.reason:'',...t};
 });
 const byPulse=(a,b)=>b.pulseMinutes-a.pulseMinutes||(b.elbMinutes-a.elbMinutes)||String(a.door||a.site||'').localeCompare(String(b.door||b.site||''),undefined,{numeric:true});
 const byMismatch=(a,b)=>b.mismatches-a.mismatches||Math.abs(b.diffMinutes)-Math.abs(a.diffMinutes)||KIND_RANK[a.kind]-KIND_RANK[b.kind]||byPulse(a,b);
 if(group==='shift')rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.shift).localeCompare(String(b.shift),undefined,{numeric:true}));
 else rows.sort(mode==='mismatch'?byMismatch:byPulse);
 return {rows,total:{id:group+':total',key:null,total:true,site:'ALL SITES',date:'',shift:'ALL SHIFTS',door:'TOTAL',machineName:'',category:'ALL CATEGORIES',operator:'',statusLabel:'',kind:'',kindLabel:'',tone:'',pulseReasons:'',pulseRefs:'',stillOpen:false,elbBooks:'',reason:'',...totals(lines)}};
}

// The machine shifts of one machine (Step 5), newest first; in mismatch mode the mismatches first.
export function machineShiftLines(lines=[],mode='bd'){
 return [...lines].sort((a,b)=>mode==='mismatch'&&KIND_RANK[a.kind]-KIND_RANK[b.kind]||String(b.date).localeCompare(String(a.date))||String(a.shift).localeCompare(String(b.shift),undefined,{numeric:true}));
}
