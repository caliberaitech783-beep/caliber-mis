// Attendance approval of trip card batches, day by day for every site (owner, 27 Nov 2026).
// A site's day (all its batches of that report date) goes up four levels and is then locked:
//   Level 1 · Site HR (verify attendance) → Level 2 · Office HR (cross-check and validate)
//   → Level 3 · RHR, Regional HR (review) → Level 4 · Directors (final approval) → Locked.
// Each approver gets one Telegram message per site and day with Approve / Send back, or does the same from
// Masters › Attendance approval. Any level can send a day back with a reason: it returns to the batch creators
// and starts again at Level 1. A locked day's batches cannot be reopened and its cards cannot change.
// The approvers are set per site (Site HR, Office HR), per region (RHR) or for all sites (any level).
// This file holds the pure rules; server/routes/attendance-approval.mjs holds the tables, routes and Telegram.
import {REGION_DATA,displaySiteName} from './region-scope.mjs';
import {canonicalSiteName} from './site-location.mjs';

export const APPROVAL_LEVELS=Object.freeze([
 {level:1,key:'siteHr',label:'Site HR',task:'Verify attendance'},
 {level:2,key:'officeHr',label:'Office HR',task:'Cross-check and validate'},
 {level:3,key:'rhr',label:'RHR',task:'Regional review'},
 {level:4,key:'director',label:'Directors',task:'Final approval'},
]);
export const LOCKED_LEVEL=5;
export const ALL_SITES='*';
// The days that go through approval: trip card batches from 1 Nov 2026 up to 20 Nov 2026 (owner, 27 Nov 2026).
// The Azure setting ATTENDANCE_APPROVAL_UNTIL=YYYY-MM-DD moves the last day.
export const APPROVAL_FROM='2026-11-01';
export const APPROVAL_UNTIL_DEFAULT='2026-11-20';
export const SEND_BACK_REASON_MIN=5;
export const ATTENDANCE_LOCKED_SQLSTATE='CA423';

export function approvalUntil(env=process.env){
 const value=String(env?.ATTENDANCE_APPROVAL_UNTIL||'').trim();
 return /^\d{4}-\d{2}-\d{2}$/.test(value)&&value>=APPROVAL_FROM?value:APPROVAL_UNTIL_DEFAULT;
}
export const levelInfo=level=>APPROVAL_LEVELS.find(one=>one.level===Number(level))||null;
export const levelLabel=level=>Number(level)>=LOCKED_LEVEL?'Locked':levelInfo(level)?.label||'';

// One key per site, whatever spelling a batch carries ("Sasti OB", "SASTI II" → Sasti OC).
export const siteKey=value=>canonicalSiteName(value)||String(value||'').trim().toLowerCase();
export const siteLabel=value=>displaySiteName(value);
export function siteRegion(site){
 const key=siteKey(site);
 return REGION_DATA.find(region=>region.sites.some(one=>siteKey(one)===key))?.code||'';
}
export const knownSites=()=>REGION_DATA.flatMap(region=>region.sites.map(site=>({site,region:region.code})));
// An approver line's scope: a site, a region code (WCL / NCL) or every site.
export const scopeOptions=()=>[{value:ALL_SITES,label:'All sites'},...REGION_DATA.map(r=>({value:r.code,label:`Region ${r.code} (all its sites)`})),...knownSites().map(s=>({value:s.site,label:s.site}))];
export function normalScope(value){
 const raw=String(value||'').trim();
 if(raw===ALL_SITES)return ALL_SITES;
 const region=REGION_DATA.find(r=>r.code.toLowerCase()===raw.toLowerCase());
 if(region)return region.code;
 const site=knownSites().find(s=>siteKey(s.site)===siteKey(raw));
 return site?site.site:'';
}
export function scopeCovers(scope,site){
 if(scope===ALL_SITES)return true;
 if(REGION_DATA.some(r=>r.code===scope))return siteRegion(site)===scope;
 return siteKey(scope)===siteKey(site);
}
// approvers: [{level,scope,login}] → the logins that approve this site at this level.
export function approversFor(approvers,site,level){
 return [...new Set((approvers||[]).filter(a=>Number(a.level)===Number(level)&&scopeCovers(a.scope,site)).map(a=>String(a.login||'').trim().toLowerCase()).filter(Boolean))];
}
// The levels and sites one login approves, for the "connect your Telegram" pop-up (owner, 28 Nov 2026):
// → [{level,label,sites:[...]}] by level; All sites and a region read as such.
export function approverRoles(approvers,login){
 const who=String(login||'').trim().toLowerCase();if(!who)return [];
 const byLevel=new Map();
 for(const a of approvers||[]){
  if(String(a.login||'').trim().toLowerCase()!==who||!levelInfo(a.level))continue;
  const sites=byLevel.get(Number(a.level))||byLevel.set(Number(a.level),[]).get(Number(a.level));
  const name=a.scope===ALL_SITES?'All sites':REGION_DATA.some(r=>r.code===a.scope)?`Region ${a.scope}`:String(a.scope||'');
  if(name&&!sites.includes(name))sites.push(name);
 }
 return [...byLevel].sort((a,b)=>a[0]-b[0]).map(([level,sites])=>({level,label:levelInfo(level).label,sites}));
}
export function canApprove(approvers,login,site,level){
 return approversFor(approvers,site,level).includes(String(login||'').trim().toLowerCase());
}

// batches: [{id,site,reportDate,shift,closedAt,closureRevision,createdBy}] of the approval window, not deleted or archived.
// → one line per site and date: its batches, whether every one is closed, and a signature that changes whenever a
// batch of the day is added, reopened or closed again (so a corrected day starts again at Level 1).
export function groupDays(batches){
 const days=new Map();
 for(const batch of batches||[]){
  const key=siteKey(batch.site)+'|'+batch.reportDate;
  let day=days.get(key);
  if(!day){day={site:siteLabel(batch.site),siteKey:siteKey(batch.site),date:batch.reportDate,batches:[],rawSites:new Set()};days.set(key,day);}
  day.batches.push(batch);day.rawSites.add(String(batch.site||'').trim().toLowerCase());
 }
 return [...days.values()].map(day=>{
  const batches=[...day.batches].sort((a,b)=>String(a.shift).localeCompare(String(b.shift)));
  const open=batches.filter(b=>!b.closedAt);
  return {...day,rawSites:[...day.rawSites],batches,ready:batches.length>0&&!open.length,open:open.length,
   signature:batches.map(b=>`${b.id}:${b.closureRevision||0}:${b.closedAt?new Date(b.closedAt).toISOString():'open'}`).sort().join(','),
   creators:[...new Set(batches.map(b=>String(b.createdBy||'').trim().toLowerCase()).filter(Boolean))]};
 }).sort((a,b)=>a.site.localeCompare(b.site)||a.date.localeCompare(b.date));
}

// The saved state of a day: {level 1..4 waiting, 5 locked; signature; trail[]; sentBack}. A day not saved yet is
// at Level 1 once all its batches are closed. A day whose batches changed after approvals began (a batch reopened,
// added or closed again) drops back to Level 1 with its trail kept. A locked day never moves.
export function reconcileDay(saved,day,{at}){
 if(saved&&Number(saved.level)>=LOCKED_LEVEL)return {state:saved,changed:false};
 if(!day.ready){
  if(!saved)return {state:null,changed:false};
  if(saved.status==='not_ready')return {state:saved,changed:false};
  return {state:{...saved,status:'not_ready',level:1,signature:day.signature,trail:[...(saved.trail||[]),{level:Number(saved.level)||1,action:'batch_reopened',at}]},changed:true};
 }
 if(!saved)return {state:{level:1,status:'waiting',signature:day.signature,trail:[],sentBack:null},changed:true};
 if(saved.signature===day.signature&&saved.status!=='not_ready')return {state:saved,changed:false};
 const corrected=saved.status==='sent_back'||saved.status==='not_ready'||Number(saved.level)>1;
 return {state:{...saved,level:1,status:'waiting',signature:day.signature,corrected:corrected||Boolean(saved.corrected),
  trail:[...(saved.trail||[]),{level:Number(saved.level)||1,action:'batches_changed',at}]},changed:true};
}

export function approveDay(saved,{login,name,at,source}){
 const level=Number(saved.level);
 if(level>=LOCKED_LEVEL)throw Object.assign(new Error('This day is already locked.'),{status:409});
 if(saved.status!=='waiting')throw Object.assign(new Error(saved.status==='sent_back'?'This day was sent back. It waits for the batch creators to correct it.':saved.status==='unlocked'?'This day was unlocked by RHR for a correction. It waits for the batch to be reopened and closed again.':'Not every batch of this day is closed.'),{status:409});
 const next=level+1;
 return {...saved,level:next,status:next>=LOCKED_LEVEL?'locked':'waiting',sentBack:null,corrected:false,
  lockedAt:next>=LOCKED_LEVEL?at:saved.lockedAt||null,
  trail:[...(saved.trail||[]),{level,action:'approved',by:login,name:name||login,at,source}]};
}

export function sendBackDay(saved,{login,name,at,source,reason}){
 const level=Number(saved.level);
 if(level>=LOCKED_LEVEL)throw Object.assign(new Error('This day is already locked.'),{status:409});
 if(saved.status!=='waiting')throw Object.assign(new Error('This day is not waiting for approval.'),{status:409});
 const why=String(reason||'').replace(/\s+/g,' ').trim().slice(0,500);
 if(why.length<SEND_BACK_REASON_MIN)throw Object.assign(new Error('Write why this day is sent back.'),{status:400});
 const entry={level,action:'sent_back',by:login,name:name||login,at,source,reason:why};
 return {...saved,level:1,status:'sent_back',sentBack:entry,trail:[...(saved.trail||[]),entry]};
}

// A sent-back day waits for the batch creators. When they have corrected it (a batch reopened and closed again, so
// the signature changes) reconcileDay puts it back at Level 1. Site HR may also take it back as it is.
export function resumeDay(saved,{login,name,at,source}){
 if(!['sent_back','unlocked'].includes(saved.status))throw Object.assign(new Error('This day was not sent back or unlocked.'),{status:409});
 return {...saved,status:'waiting',level:1,sentBack:null,corrected:true,trail:[...(saved.trail||[]),{level:1,action:'taken_back',by:login,name:name||login,at,source}]};
}

const fmtDate=value=>{const [y,m,d]=String(value||'').split('-');return d?`${d}-${m}-${y}`:String(value||'');};
export const displayDate=fmtDate;
const html=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function istTime(value){
 if(!value)return '';
 const date=new Date(new Date(value).getTime()+330*60000);
 return `${String(date.getUTCDate()).padStart(2,'0')}-${String(date.getUTCMonth()+1).padStart(2,'0')} ${String(date.getUTCHours()).padStart(2,'0')}:${String(date.getUTCMinutes()).padStart(2,'0')}`;
}

// The Telegram message for one site and one day at one level (owner, 27 Nov 2026: one message per day).
export function approvalMessage({site,region,date,level,batches=[],summary={},trail=[],corrected=false}){
 const info=levelInfo(level);
 const done=trail.filter(t=>t.action==='approved');
 const lastDone=new Map();for(const t of done)lastDone.set(t.level,t);
 const shifts=batches.map(b=>b.shift).filter(Boolean).join(', ');
 return [
  `<blockquote>🗓 <b>ATTENDANCE APPROVAL · LEVEL ${info.level} · ${html(info.label.toUpperCase())}</b>${region&&info.level===3?` (${html(region)})`:''}\n${html(info.task)}</blockquote>`,
  '',
  `<b>${html(site)}</b> · ${html(fmtDate(date))} (one day)`,
  `Batches: ${batches.length}${shifts?` · ${html(shifts)}`:''} · all closed`,
  ...(summary.present!=null?[`Present: ${Number(summary.present).toLocaleString('en-IN')} duties · ${Number(summary.people||0).toLocaleString('en-IN')} people${summary.training?` · VTC Training ${summary.training}`:''}${summary.od?` · OD ${summary.od}`:''}`]:[]),
  ...(summary.cards!=null?[`Cards: VLB ${summary.vlb||0} · ELB ${summary.elb||0} · LMV ${summary.lmv||0}`]:[]),
  ...(corrected?['<i>Corrected after it was sent back or a batch was reopened.</i>']:[]),
  ...(lastDone.size?['',...[...lastDone.values()].sort((a,b)=>a.level-b.level).map(t=>`${html(levelLabel(t.level))}: ${html(t.name||t.by)} · ${html(istTime(t.at))} ✓`)]:[]),
  '',
  `Details: Masters › Attendance approval › ${html(fmtDate(date))}`,
 ].join('\n');
}
// One summary message per site, level and approver (owner, 28 Nov 2026: "make it summary", after one site's 20 days
// came as 20 messages). Every waiting day is one line with its own Approve / Send back row, so a day is still approved
// on its own; the approvals already given are shown once when every day has the same ones.
export const SUMMARY_DAYS_PER_MESSAGE=20;
export const SUMMARY_MAX_CHARS=3300;
const shortDate=value=>fmtDate(value).slice(0,5);
const shortShift=value=>String(value||'').replace(/^shift\s*/i,'S').replace(/^SIII$/,'S3').replace(/^SII$/,'S2').replace(/^SI$/,'S1');
function approvedBy(trail=[]){
 const last=new Map();for(const t of trail)if(t.action==='approved')last.set(t.level,t);
 return [...last.values()].sort((a,b)=>a.level-b.level).map(t=>`${levelLabel(t.level)}: ${t.name||t.by}`).join(' · ');
}
export function summaryDayLine({date,batches=[],summary={},corrected=false}){
 const shifts=batches.map(b=>shortShift(b.shift)).filter(Boolean).join(' ');
 const parts=[`<b>${html(shortDate(date))}</b>`,`${batches.length} batch${batches.length===1?'':'es'}${shifts?` (${html(shifts)})`:''}`];
 if(summary.present!=null)parts.push(`Present ${Number(summary.present).toLocaleString('en-IN')}`,`${Number(summary.people||0).toLocaleString('en-IN')} people`);
 if(summary.training)parts.push(`VTC ${summary.training}`);
 if(summary.od)parts.push(`OD ${summary.od}`);
 if(summary.cards!=null)parts.push(`VLB ${summary.vlb||0} · ELB ${summary.elb||0} · LMV ${summary.lmv||0}`);
 return parts.join(' · ')+(corrected?' · ✏️ corrected':'');
}
// days: [{date,batches,summary,trail,corrected}] of one site waiting at one level → [{text,dates}], oldest first.
export function approvalSummaryMessages({site,region,level,days=[]}){
 const info=levelInfo(level);
 const sorted=[...days].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 const by=sorted.map(d=>approvedBy(d.trail));
 const same=by.length&&by.every(v=>v===by[0])?by[0]:null;
 const lines=sorted.map((d,i)=>summaryDayLine(d)+(same===null&&by[i]?`\n   ✓ ${html(by[i])}`:''));
 const chunks=[];let current=[];let size=0;
 sorted.forEach((d,i)=>{
  const add=lines[i].length+1;
  if(current.length&&(current.length>=SUMMARY_DAYS_PER_MESSAGE||size+add>SUMMARY_MAX_CHARS)){chunks.push(current);current=[];size=0;}
  current.push(i);size+=add;
 });
 if(current.length)chunks.push(current);
 return chunks.map((chunk,part)=>{
  const first=sorted[chunk[0]].date,last=sorted[chunk.at(-1)].date;
  const span=chunk.length===1?fmtDate(first):`${shortDate(first)} to ${fmtDate(last)}`;
  return {dates:chunk.map(i=>sorted[i].date),text:[
   `<blockquote>🗓 <b>ATTENDANCE APPROVAL · LEVEL ${info.level} · ${html(info.label.toUpperCase())}</b>${region&&info.level===3?` (${html(region)})`:''}\n${html(info.task)}</blockquote>`,
   '',
   `<b>${html(site)}</b> · ${chunk.length} day${chunk.length===1?'':'s'} waiting · ${html(span)}${chunks.length>1?` (part ${part+1} of ${chunks.length})`:''}`,
   ...(same?[`Approved so far: ${html(same)} ✓`]:[]),
   '',
   ...chunk.map(i=>lines[i]),
   '',
   'Tap a date to approve or send back that day. Details: Masters › Attendance approval.',
  ].join('\n')};
 });
}
export const summaryButtons=(entries)=>entries.map(({date,id})=>[{text:`✅ Approve ${shortDate(date)}`,callback_data:callbackData(id,'a')},{text:`↩ Send back ${shortDate(date)}`,callback_data:callbackData(id,'b')}]);
export function lockedMessage({site,date}){
 return `🔒 <b>${html(site)} · ${html(fmtDate(date))} locked</b>\nApproved by Site HR, Office HR, RHR and Directors. The batches of this day cannot be reopened and its cards cannot change.`;
}
export function sentBackMessage({site,date,level,by,reason}){
 return `↩ <b>${html(site)} · ${html(fmtDate(date))} sent back</b> by ${html(by)} (${html(levelLabel(level))})\n<b>Reason:</b> ${html(reason)}\nReopen the batch, correct it and close it again. The day then starts again at Site HR.`;
}
export const callbackData=(id,action)=>`att:${id}:${action}`;
export function parseCallback(data){
 const match=/^att:([0-9a-f]{16}):([ab])$/.exec(String(data||''));
 return match?{id:match[1],action:match[2]==='a'?'approve':'back'}:null;
}

// RHR unlock with OTP (owner, 27 Nov 2026: "add an rhr unlock button with reason and it should be with otp; if any user
// needs to reopen the batch he needs to send request for otp to rhr to open it with otp request").
// A user who needs to reopen a batch of a locked day asks with a reason; the RHR of the site's region gets a six-digit
// OTP on Telegram (WhatsApp if Telegram is not connected); the OTP entered unlocks the day. The day then waits, like a
// day sent back, for its batch to be reopened, corrected and closed, and climbs the four levels again from Site HR.
export const UNLOCK_REASON_MIN=10;
export function unlockDay(saved,{login,name,at,reason,approvedBy=[],otpId}){
 if(!(Number(saved?.level)>=LOCKED_LEVEL))throw Object.assign(new Error('This day is not locked.'),{status:409});
 const entry={level:LOCKED_LEVEL,action:'unlocked',by:login,name:name||login,at,source:'OTP from RHR',reason,approvedBy,otpId};
 return {...saved,level:1,status:'unlocked',lockedAt:null,corrected:true,sentBack:entry,trail:[...(saved.trail||[]),entry]};
}
export function unlockOtpMessage({site,region,date,requestedBy,reason,otp,minutes}){
 return ['🔓 PULSE-II · ATTENDANCE UNLOCK',
  `${requestedBy} asks to unlock ${site} · ${fmtDate(date)}${region?` (${region})`:''} to reopen its batch.`,
  `Reason: ${reason}`,'',
  `OTP ${otp}, valid ${minutes} minutes. Share it only if this day should be reopened. It then goes through Site HR, Office HR, RHR and Directors again.`].join('\n');
}
export function unlockedMessage({site,date,by,reason,rhr}){
 return `🔓 <b>${html(site)} · ${html(fmtDate(date))} unlocked</b> with the OTP of RHR (${html(rhr)}) for ${html(by)}\n<b>Reason:</b> ${html(reason)}\nReopen the batch, correct it and close it again. The day then starts again at Site HR.`;
}
