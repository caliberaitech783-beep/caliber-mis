import {decodeScanJson} from '../rules/scan-text-storage.mjs';
import {ownerTelegramLogins} from './release-otp-delivery.mjs';
import {escapeHtml,duration} from './scan-batch-report.mjs';
import {displaySiteName} from '../../shared/region-scope.mjs';

// Speed report on Telegram (owner, 16 Nov 2026): three times a day, at 10:00, 16:00 and 21:00 IST,
// one message to the owner's linked logins (the same people as A24): is the application slow or
// not, how many batches were closed since the last report, which batch took the longest from start
// to close and the usernames that started and locked it, then the figures behind the verdict.
//
// Each report covers the time since the previous one (21:00 -> 10:00 overnight, 10:00 -> 16:00,
// 16:00 -> 21:00). Batches and card reading are read from the database, so they are complete for
// the whole period. Server freezes and database waits are measured in memory by this server, so
// they cover the period only from the server's last start (a release restarts it); the message
// says so. Card saving shows the last 40 saves, as on /api/health.
//
// It runs on the live slot only. Server instances share one claim per window
// (mis_health_reports), so one message is sent. A report is sent only in the first 30 minutes after
// its time: a server that starts later does not send an old report. MIS_HEALTH_REPORT=off stops it;
// the Automation Centre switch A25 stops it too.

export const HEALTH_REPORT_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_health_reports(window_key TEXT PRIMARY KEY,sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),summary JSONB)`;
export const REPORT_TITLE='PULSE-II SPEED REPORT';
export const WINDOWS=[600,960,1260]; // 10:00, 16:00, 21:00 IST, in minutes after IST midnight
const SEND_WITHIN_MINUTES=30;
const IST_MS=330*60000,DAY_MS=86400000;

const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const average=list=>{const v=list.filter(finite);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null;};
const most=list=>{const v=list.filter(finite);return v.length?Math.max(...v):null;};
const hhmm=minutes=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
const istDayStart=ms=>Math.floor((ms+IST_MS)/DAY_MS)*DAY_MS-IST_MS;

// The report window of a moment: its time (ms), the start of the period it covers (the previous
// report time) and its key "YYYY-MM-DD HH:MM IST". due() answers only in the first 30 minutes.
export function reportWindow(now=Date.now()){
 const day=istDayStart(now),minute=Math.floor((now-day)/60000);
 const index=WINDOWS.findLastIndex(w=>w<=minute);
 const at=index<0?day-DAY_MS+WINDOWS.at(-1)*60000:day+WINDOWS[index]*60000;
 const previous=index>0?day+WINDOWS[index-1]*60000:index===0?day-DAY_MS+WINDOWS.at(-1)*60000:day-DAY_MS+WINDOWS.at(-2)*60000;
 const ist=new Date(at+IST_MS).toISOString();
 return {at,from:previous,key:`${ist.slice(0,10)} ${ist.slice(11,16)} IST`};
}
export function dueWindow(now=Date.now()){
 const window=reportWindow(now);
 return now-window.at<SEND_WITHIN_MINUTES*60000?window:null;
}

const clock=ms=>new Date(ms).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false});
const dayClock=ms=>new Date(ms).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).replace(',','');
const ms=v=>finite(v)?(v<1000?`${Math.round(v)} ms`:duration(v)):'-';
const hoursText=span=>{const h=Math.round(span/360000)/10;return `${h} h`;};
const reportPeriod=window=>`${dayClock(window.from)} → ${dayClock(window.at)} IST · ${hoursText(window.at-window.from)}`;

// Names of the card-saving steps (entry-read-steps.mjs) in plain words.
const STEP_NAMES={'card-check':'card rule check','card-fill':'card fill','check-world':'master lists','card-other':'other card work',
 'duplicate-saved':'duplicate check','duplicate-mark':'duplicate marking','duplicate-list':'duplicate list','duplicate-batches':'duplicate batches',
 'duplicate-image':'duplicate picture','duplicate-cards':'duplicate cards','reading-request':'reading request','card-rows':'card rows',
 'open-deletion':'open deletions','reader-info':'reader details',decode:'decode',queue:'queue',connection:'database connection'};
const stepName=key=>STEP_NAMES[key]||key;

// Limits behind the verdict. Red = people feel it (a save near the browser's 15 s limit, the
// server stopping for seconds, requests queueing for the database, card reading stopped or far
// behind). Amber = worth a look, nobody blocked yet.
export const LIMITS={
 freezeMs:{amber:1000,red:3000},dbWaiting:{amber:1,red:5},
 saveAverageMs:{amber:1000,red:3000},saveSlowestMs:{amber:5000,red:15000},
 queueAverageMs:{amber:60000,red:300000},readAverageMs:{amber:40000,red:90000},notReadShare:{amber:0.1,red:0.25},
};
const band=(value,limit)=>!finite(value)?0:value>=limit.red?2:value>=limit.amber?1:0;

export function verdict(f){
 const checks=[
  [band(f.server?.longestFreezeMs,LIMITS.freezeMs),`server stopped for ${ms(f.server?.longestFreezeMs)}`],
  [band(f.server?.mostWaiting,LIMITS.dbWaiting),`${f.server?.mostWaiting} requests waited for the database`],
  [band(f.saving?.averageMs,LIMITS.saveAverageMs),`card save ${ms(f.saving?.averageMs)} on average`],
  [band(f.saving?.slowestMs,LIMITS.saveSlowestMs),`slowest card save ${ms(f.saving?.slowestMs)}`],
  [band(f.reading?.queueAverageMs,LIMITS.queueAverageMs),`cards waited ${ms(f.reading?.queueAverageMs)} to be read`],
  [band(f.reading?.readAverageMs,LIMITS.readAverageMs),`${ms(f.reading?.readAverageMs)} to read a card`],
  [f.reading?.cards>=20?band(f.reading.notRead/f.reading.cards,LIMITS.notReadShare):0,`${f.reading?.notRead} cards not read`],
  [f.engines?.blocked?2:0,`card reading held: ${f.engines?.blockedReason||'reader account failed'}`],
  [f.pulseCopy&&f.pulseCopy.fresh===false?1:0,'Pulse breakdown copy is not fresh'],
 ];
 const level=Math.max(0,...checks.map(([value])=>value));
 // Two states only (owner, 16 Nov 2026): SPEED GOOD in green, or SPEED SLOW in red as soon as any
 // limit is crossed. The reasons list the worst ones first.
 const reasons=checks.filter(([value])=>value>0).sort((a,b)=>b[0]-a[0]).map(([,text])=>text);
 const good=level===0;
 return {level,good,label:good?'SPEED GOOD':'SPEED SLOW',icon:good?'🟢':'🔴',reasons};
}

const shortBatchName=name=>{const parts=String(name||'').split('/');return parts.length>=4&&parts[0]==='CMLL'?parts.slice(2).join('/'):String(name||'-');};
const login=v=>String(v||'').trim().toLowerCase()||'-';

export function healthReportMessage({window,figures:f,sample=false}){
 const v=verdict(f),b=f.batches,r=f.reading,s=f.saving,srv=f.server;
 const lines=[
  // The punch line first, bold (owner, 16 Nov 2026); the green / red picture above it carries the colour.
  `${v.icon}${v.icon} <b>${v.label}</b> ${v.icon}${v.icon}`,
  ...v.reasons.slice(0,3).map(text=>`• ${escapeHtml(text)}`),
  '',
  `<b>${REPORT_TITLE}${sample?' (SAMPLE)':''}</b>`,
  `🕙 ${escapeHtml(reportPeriod(window))}`,
  '',
  `<b>📦 Batches closed: ${b.closed}</b>`,
 ];
 if(b.longest){
  const l=b.longest;
  lines.push(`⏳ Longest: ${escapeHtml(shortBatchName(l.name))}`,
   `   ${escapeHtml(displaySiteName(l.site)||l.site||'-')} · ${duration(l.totalMs)} start to close`,
   `   👤 Started ${escapeHtml(login(l.startedBy))} · locked ${escapeHtml(login(l.lockedBy))}`);
  if(finite(l.vlbMs)||finite(l.lmvMs)||finite(l.elbMs))lines.push(`   VLB ${duration(l.vlbMs)} · LMV ${duration(l.lmvMs)} · ELB ${duration(l.elbMs)}`);
  lines.push(`⏱ Average start to close: ${duration(b.averageMs)}`);
 }
 lines.push('',`<b>🗂 Card reading (scan)</b>`);
 lines.push(r.cards?`${r.cards} cards · ${ms(r.readAverageMs)}/card · slowest ${ms(r.readSlowestMs)}`:'No cards scanned in this period');
 if(r.cards)lines.push(`⌛ Queue wait ${ms(r.queueAverageMs)} avg · longest ${ms(r.queueSlowestMs)}`,`❌ Not read ${r.notRead}`);
 lines.push('',`<b>💾 Card saving (last ${s?.reads||0} saves)</b>`);
 if(s?.reads){
  lines.push(`⚡ ${ms(s.averageMs)} avg · slowest ${ms(s.slowestMs)}`);
  if(s.duplicate)lines.push(`🔎 Duplicate check ${ms(s.duplicate.avgMs)} avg · ${ms(s.duplicate.maxMs)} slowest`);
  if(s.largest)lines.push(`🧩 Largest step: ${escapeHtml(stepName(s.largest.name))} ${ms(s.largest.avgMs)} avg · ${ms(s.largest.maxMs)} slowest`);
 }else lines.push('No card saved since the server started');
 if(srv||f.queue||f.engines||f.pulseCopy)lines.push('',`<b>🖥 Server${srv?.measuredFrom>window.from?` (since restart ${escapeHtml(clock(srv.measuredFrom))})`:''}</b>`);
 if(srv)lines.push(`🧊 Freezes ${srv.freezes}${srv.freezes?` · longest ${ms(srv.longestFreezeMs)}`:''}`,
  `🔌 Database: ${srv.free} free, ${srv.waitingNow} waiting now · most waiting ${srv.mostWaiting}`);
 if(f.queue)lines.push(`📥 Card read queue: ${f.queue.slots} slots, ${f.queue.active} busy, ${f.queue.waiting} waiting`);
 if(f.engines)lines.push(`🤖 Engines ${f.engines.live} live, ${f.engines.blocked?`${f.engines.blocked} blocked`:'none blocked'}, ${f.engines.reading} reading now`);
 if(f.pulseCopy)lines.push(`🔄 Pulse breakdown copy ${f.pulseCopy.fresh?'fresh':'NOT fresh'} (${duration((f.pulseCopy.ageSeconds||0)*1000)} old)`);
 return lines.join('\n').slice(0,4000);
}

// Batches closed in the period: start = created_at, close = closed_at (the same as the dashboard's
// "Batch start to close"); started by = the batch's creator; locked by = the "saved and locked" entry
// in the batch history.
async function batchFigures(pool,from,to){
 const {rows}=await pool.query(`SELECT b.id::text AS id,b.name,b.site,b.created_at,b.vlb_locked_at,b.lmv_locked_at,b.closed_at,
   COALESCE(b.creator_login,b.created_by,'') AS started_by
  FROM mis_vlb_batches b WHERE b.deleted_at IS NULL AND b.archived_at IS NULL AND b.closed_at>=$1::timestamptz AND b.closed_at<$2::timestamptz
  ORDER BY b.closed_at LIMIT 5000`,[new Date(from).toISOString(),new Date(to).toISOString()]);
 // The lock is written to the batch history at the moment of closing (the history is indexed by time, not by batch).
 const lockers=rows.length?new Map((await pool.query(`SELECT batch_id::text AS batch_id,actor FROM mis_vlb_batch_audit
  WHERE occurred_at>=$1::timestamptz AND occurred_at<$2::timestamptz AND action='saved_and_locked' ORDER BY occurred_at,id LIMIT 20000`,
  [new Date(from-3600000).toISOString(),new Date(to+3600000).toISOString()])).rows.map(row=>[row.batch_id,String(row.actor||'').trim()])):new Map();
 const t=v=>v?Date.parse(v):null,gap=(a,b)=>a!==null&&b!==null&&b>=a?b-a:null;
 const list=rows.map(row=>{const start=t(row.created_at),vlb=t(row.vlb_locked_at),lmv=t(row.lmv_locked_at),close=t(row.closed_at);
  return {name:row.name,site:row.site,startedBy:row.started_by,lockedBy:lockers.get(row.id)||'',totalMs:gap(start,close),
   vlbMs:gap(start,vlb),lmvMs:gap(vlb,lmv),elbMs:gap(lmv??vlb,close)};});
 const longest=list.filter(b=>finite(b.totalMs)).sort((a,b)=>b.totalMs-a.totalMs)[0]||null;
 return {closed:list.length,averageMs:average(list.map(b=>b.totalMs)),longest};
}

// Cards uploaded in the period: time to read each card and time it waited in the queue.
const ENCODED='__caliberUtf8JsonV1';
const CARD_STATUSES=['queued','reading','review','approved','rejected','posted','error'];
async function readingFigures(pool,from,to){
 const {rows}=await pool.query(`SELECT c.status,CASE WHEN c.raw_fields ? '${ENCODED}' THEN c.raw_fields ELSE jsonb_build_object('scanTiming',c.raw_fields->'scanTiming') END AS timing
  FROM mis_scan_cards c WHERE c.status=ANY($3::text[]) AND c.created_at>=$1::timestamptz AND c.created_at<$2::timestamptz AND c.duplicate_of IS NULL`,
  [new Date(from).toISOString(),new Date(to).toISOString(),CARD_STATUSES]);
 const cards=rows.map(row=>({status:row.status,timing:decodeScanJson(row.timing)?.scanTiming||{}}));
 const read=cards.filter(c=>!['queued','reading','error'].includes(c.status));
 return {cards:cards.length,notRead:cards.filter(c=>c.status==='error').length,
  readAverageMs:average(read.map(c=>c.timing.totalMs)),readSlowestMs:most(read.map(c=>c.timing.totalMs)),
  queueAverageMs:average(read.map(c=>c.timing.queuedMs)),queueSlowestMs:most(read.map(c=>c.timing.queuedMs))};
}

// In-memory figures of this server: freezes and database waits in the period (per-minute history of
// the performance monitor), card saving steps (last 40 saves) and the state now.
export function liveFigures({performance,scanning,pool,pulseCopy},from){
 const minutes=(performance?.minutes||[]).filter(m=>Date.parse(m.minute)>=from-60000);
 const measuredFrom=Math.max(from,Date.parse(performance?.measuredSince)||from);
 const server=performance?{measuredFrom,freezes:minutes.reduce((s,m)=>s+(m.freezes||0),0),longestFreezeMs:Math.max(0,...minutes.map(m=>m.longestFreezeMs||0)),
  mostWaiting:Math.max(0,...minutes.map(m=>m.poolMaxWaiting||0),pool?.waiting||0),free:pool?.idle??0,waitingNow:pool?.waiting??0}:null;
 const steps=scanning?.entryReadSteps;
 const entries=Object.entries(steps?.steps||{}).filter(([name])=>!['queue','connection'].includes(name));
 const largest=entries.sort((a,b)=>b[1].avgMs-a[1].avgMs)[0];
 const saving=steps?{reads:steps.reads,averageMs:steps.total?.avgMs??null,slowestMs:steps.total?.maxMs??most((steps.slowest||[]).map(s=>s.totalMs)),
  duplicate:steps.steps?.['duplicate-saved']||null,largest:largest?{name:largest[0],...largest[1]}:null}:null;
 const outages=scanning?.outages||[];
 return {server,saving,
  queue:scanning?.entryReadLane?{slots:scanning.entryReadLane.slots,active:scanning.entryReadLane.active,waiting:scanning.entryReadLane.waiting}:null,
  engines:scanning?{live:scanning.liveEngines??0,reading:scanning.reading??0,blocked:outages.length,blockedReason:outages[0]?.reason||''}:null,
  pulseCopy:pulseCopy&&pulseCopy.enabled!==false?{fresh:Boolean(pulseCopy.fresh),ageSeconds:pulseCopy.ageSeconds}:null};
}

export const isLiveSlot=(env=process.env)=>!env.WEBSITE_SLOT_NAME||String(env.WEBSITE_SLOT_NAME).toLowerCase()==='production';
export const healthReportEnabled=(env=process.env)=>!['off','0','false','no'].includes(String(env.MIS_HEALTH_REPORT??'').trim().toLowerCase());

export function createHealthReporter({pool,telegram,live=()=>({}),recipients=()=>ownerTelegramLogins(pool),now=()=>Date.now(),log=console}){
 let ready=null,running=false;
 const ensure=()=>ready||=pool.query(HEALTH_REPORT_SCHEMA).catch(error=>{ready=null;throw error;});
 async function figures(window){
  const [batches,reading]=await Promise.all([batchFigures(pool,window.from,window.at),readingFigures(pool,window.from,window.at)]);
  let state={};try{state=liveFigures(await live(),window.from);}catch(error){log.error?.('Speed report live figures:',error?.message||error);}
  return {batches,reading,...state};
 }
 // Every message goes with the green / red headline picture (mis-telegram.mjs draws it from photo.speed).
 const headline=(window,f)=>{const v=verdict(f);return {speed:{good:v.good,period:reportPeriod(window),reasons:v.reasons.slice(0,2)}};};
 async function deliver(key,message,photo=null){
  const people=await recipients();let sent=0;
  for(const person of people){try{if(await telegram.send(person,message,`health-report:${key}:${person}`,{html:true,photo}))sent++;}catch(error){log.error?.('Speed report not sent:',error?.message||error);}}
  return {people:people.length,sent};
 }
 async function tick(){
  if(running)return {skipped:true};running=true;
  try{
   const window=dueWindow(now());if(!window)return {due:false};
   await ensure();
   // One claim per window for every server; the figures are stored with it for a later look.
   const claimed=(await pool.query('INSERT INTO mis_health_reports(window_key) VALUES($1) ON CONFLICT DO NOTHING RETURNING window_key',[window.key])).rows.length>0;
   if(!claimed)return {due:true,claimed:false};
   const f=await figures(window);
   await pool.query('UPDATE mis_health_reports SET summary=$2::jsonb WHERE window_key=$1',[window.key,JSON.stringify({verdict:verdict(f),...f})]).catch(()=>{});
   return {due:true,claimed:true,...await deliver(window.key,healthReportMessage({window,figures:f}),headline(window,f))};
  }finally{running=false;}
 }
 // "Send sample to Telegram" on the Automation Centre: the report of the period up to now, to the
 // same people. It is not recorded, so the real report of the window is still sent.
 async function sendSample(){
  const at=now(),window={at,from:reportWindow(at).at,key:`sample:${at}`};
  if(at-window.from<3600000)window.from=reportWindow(window.from-1).at;
  const f=await figures(window);
  return {verdict:verdict(f).label,...await deliver(window.key,healthReportMessage({window,figures:f,sample:true}),headline(window,f))};
 }
 return {tick,sendSample,
  start({intervalMs=60000}={}){
   const run=()=>tick().catch(error=>log.error?.('Speed report failed:',error?.message||error));
   void run();const timer=setInterval(run,intervalMs);timer.unref?.();return ()=>clearInterval(timer);
  }};
}
