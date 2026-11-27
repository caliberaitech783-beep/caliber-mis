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
 if(saved.status!=='waiting')throw Object.assign(new Error(saved.status==='sent_back'?'This day was sent back. It waits for the batch creators to correct it.':'Not every batch of this day is closed.'),{status:409});
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
 if(saved.status!=='sent_back')throw Object.assign(new Error('This day was not sent back.'),{status:409});
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
  ...(summary.present!=null?[`Present: ${Number(summary.present).toLocaleString('en-IN')} duties · ${Number(summary.people||0).toLocaleString('en-IN')} people${summary.training?` · VTC Training ${summary.training}`:''}`]:[]),
  ...(summary.cards!=null?[`Cards: VLB ${summary.vlb||0} · ELB ${summary.elb||0} · LMV ${summary.lmv||0}`]:[]),
  ...(corrected?['<i>Corrected after it was sent back or a batch was reopened.</i>']:[]),
  ...(lastDone.size?['',...[...lastDone.values()].sort((a,b)=>a.level-b.level).map(t=>`${html(levelLabel(t.level))}: ${html(t.name||t.by)} · ${html(istTime(t.at))} ✓`)]:[]),
  '',
  `Details: Masters › Attendance approval › ${html(fmtDate(date))}`,
 ].join('\n');
}
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
