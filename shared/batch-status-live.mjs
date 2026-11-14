// Batch Status & Turnaround · Working now: who is entering batches at this moment.
// A person is "working now" when they saved something in a batch (trip card, LMV log book, machine entry,
// lock, unlock) within the last WORKING_NOW_MINUTES. The same 10 minutes the report already uses to tell
// work on the website from waiting. A report only: it reads the batch history and changes nothing.
import {canonicalSiteName} from './site-location.mjs';
import {displaySiteName} from './region-scope.mjs';
import {bookShiftCode} from './trip-card-rules.mjs';
import {IDLE_LIMIT_MINUTES,SHIFT_LABELS,actionStage,displayDate} from './batch-status-report.mjs';
import {RECENT_WINDOWS,durationLabel} from './recent-activity.mjs';

export const WORKING_NOW_MINUTES=IDLE_LIMIT_MINUTES;
// Last action looks back one day; older activity shows a dash.
export const LAST_ACTION_HOURS=24;
// The live figures re-read once a minute while the page is on screen.
export const LIVE_REFRESH_MS=60000;

const ms=value=>value===null||value===undefined||value===''?null:new Date(value).getTime();
const minutesAgo=(now,at)=>Math.max(0,Math.floor((now-at)/60000));

// actions: [{actor, action, at, batchId, batchName, site, date, shift}] from the last LAST_ACTION_HOURS.
// names: {login: display name}. Returns the people working now, and per site and per batch who and when.
export function buildWorkingNow({now=Date.now(),actions=[],names={}}){
 const windowStart=now-WORKING_NOW_MINUTES*60000,dayStart=now-LAST_ACTION_HOURS*3600000;
 const known=actions.map(a=>({...a,at:ms(a.at),actor:String(a.actor||'').trim()})).filter(a=>a.at!==null&&a.at>=dayStart&&a.at<=now+60000&&a.actor);
 const label=login=>names[login.toLowerCase()]||login;
 // One line per person and batch they saved in during the window, newest first.
 const lines=new Map();
 for(const a of known){
  if(a.at<windowStart)continue;
  const key=a.actor.toLowerCase()+'|'+(a.batchId||'scope|'+canonicalSiteName(a.site)+'|'+a.date+'|'+(bookShiftCode(a.shift)||a.shift));
  const line=lines.get(key)||{id:key,login:a.actor,name:label(a.actor),siteKey:canonicalSiteName(a.site),site:displaySiteName(a.site),date:a.date,shift:a.shift,batchId:a.batchId||'',batchName:a.batchName||'',stage:'',lastAt:0,saves:0};
  line.saves++;
  if(a.at>=line.lastAt){line.lastAt=a.at;line.stage=actionStage(a.action);}
  lines.set(key,line);
 }
 // Site by site (A to Z), so the people of one site stand together; inside a site the latest save first.
 const people=[...lines.values()].sort((a,b)=>a.site.localeCompare(b.site)||b.lastAt-a.lastAt).map(line=>{const code=bookShiftCode(line.shift)||line.shift;return {...line,
  shiftLabel:SHIFT_LABELS[code]||code||'',dateLabel:displayDate(line.date),lastAt:new Date(line.lastAt).toISOString(),minutesAgo:minutesAgo(now,line.lastAt)};});
 const names_=list=>[...new Set(list.map(p=>p.name))];
 const sites={};
 for(const a of known){const key=canonicalSiteName(a.site);if(!key)continue;const site=sites[key]||(sites[key]={working:[],lastAt:0});if(a.at>site.lastAt)site.lastAt=a.at;}
 for(const [key,site] of Object.entries(sites)){const here=people.filter(p=>p.siteKey===key);sites[key]={working:names_(here),count:new Set(here.map(p=>p.login.toLowerCase())).size,lastAt:new Date(site.lastAt).toISOString(),minutesAgo:minutesAgo(now,site.lastAt)};}
 const batches={};
 for(const p of people){if(!p.batchId)continue;const b=batches[p.batchId]||(batches[p.batchId]={working:[],stage:p.stage});if(!b.working.includes(p.name))b.working.push(p.name);}
 return {asOf:new Date(now).toISOString(),windowMinutes:WORKING_NOW_MINUTES,lastActionHours:LAST_ACTION_HOURS,
  count:new Set(people.map(p=>p.login.toLowerCase())).size,people,sites,batches};
}

// Batches locked at each site in the last 6, 12 and 24 hours, by the time of the lock whatever the date on the batch
// (the same batches as Batches locked on the dashboard), and how long ago the site last locked a batch. A site that
// keeps saving but locks nothing shows 0 here while Working now and Last action stay busy.
// rows: [{site, h6, h12, h24, last_at}], one per spelling of a site, from mis_vlb_batches.closed_at.
export function buildRecentLocks({now=Date.now(),rows=[]}){
 const sites={};
 for(const row of rows){
  const key=canonicalSiteName(row.site);if(!key)continue;
  const site=sites[key]||(sites[key]={...Object.fromEntries(RECENT_WINDOWS.map(hours=>['h'+hours,0])),lastAt:null});
  for(const hours of RECENT_WINDOWS)site['h'+hours]+=Number(row['h'+hours]||0);
  const at=ms(row.last_at);
  if(at!==null&&!Number.isNaN(at)&&(site.lastAt===null||at>site.lastAt))site.lastAt=at;
 }
 for(const site of Object.values(sites)){
  site.minutesAgo=site.lastAt===null?null:minutesAgo(now,site.lastAt);
  site.lastAt=site.lastAt===null?null:new Date(site.lastAt).toISOString();
 }
 return sites;
}
// The lock cells of Step 1 for one site, or for ALL SITES (siteKey ''). Before the first live read they show an ellipsis.
export function siteLockCells(live,siteKey){
 if(!live)return {locksRead:false};
 const locks=live.locks||{},list=siteKey?[locks[siteKey]].filter(Boolean):Object.values(locks);
 const cells={locksRead:true};
 for(const hours of RECENT_WINDOWS)cells['locked'+hours]=list.reduce((n,site)=>n+(site['h'+hours]||0),0);
 const latest=list.map(site=>site.minutesAgo).filter(minutes=>minutes!==null&&minutes!==undefined);
 cells.lastLockMinutes=latest.length?Math.min(...latest):null;
 return cells;
}
export const lastLockLabel=minutes=>minutes===null||minutes===undefined?'—':minutes<1?'just now':durationLabel(minutes)+' ago';

// The Working now and Last action cells of Step 1. Before the first live read they show an ellipsis.
export function siteLiveCells(live,siteKey){
 if(!live)return {workingNow:'…',lastAction:'…'};
 if(!siteKey){
  const latest=Object.values(live.sites).reduce((best,s)=>best===null||s.minutesAgo<best?s.minutesAgo:best,null);
  return {workingNow:live.count?String(live.count):'—',lastAction:latest===null?'—':agoLabel(latest),workingCount:live.count};
 }
 const site=live.sites[siteKey];
 if(!site)return {workingNow:'—',lastAction:'—',workingCount:0};
 return {workingNow:site.count?`${site.count} · ${site.working.join(', ')}`:'—',lastAction:agoLabel(site.minutesAgo),workingCount:site.count};
}
// The Working now cell of Step 2: people saving in that shift's batch right now.
export function batchLiveCell(live,batchId){
 if(!live)return '…';
 const batch=batchId?live.batches[batchId]:null;
 return batch?.working.length?`${batch.working.join(', ')} (${batch.stage})`:'—';
}
export const agoLabel=minutes=>minutes<1?'just now':minutes<60?`${minutes} min ago`:`${Math.floor(minutes/60)} h ${minutes%60} min ago`;

export function liveSummary(live){
 if(!live)return 'Reading who is working now…';
 if(!live.count)return `Nobody has saved anything in a batch in the last ${live.windowMinutes} minutes.`;
 const sites=new Set(live.people.map(p=>p.site)).size;
 return `${live.count} ${live.count===1?'person is':'people are'} working now at ${sites} ${sites===1?'site':'sites'}: saved in a batch in the last ${live.windowMinutes} minutes.`;
}
