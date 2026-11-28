// HR Pulse's saved trip card days, kept in step with Pulse-II (owner, 28 Nov 2026).
// "either re-read by itself, or any change made by MIS department, then upon update by them should auto update the hr
//  saved days also", then: "now build the MIS push and nightly check also".
//
// Why: on 28 Nov 2026 HR Pulse's Trip card tab showed 781 employees for Majri OC from a copy saved on 22 Nov, and 749
// after a fresh read. Cards had been corrected here after the save; HR Pulse's saved copy stayed as it was.
//
// Pulse-II is the master of trip card attendance (shared/hr-attendance-change.mjs). HR Pulse keeps a saved copy of a
// site's day only to open its roster faster. This service keeps those copies honest, in two ways:
//
//  1. Push, every HR_DAY_WATCH_INTERVAL_MS on the live server. Each site-day gets a small stamp of everything its
//     attendance is made from: its cards (how many, their ids, their revisions), its batches (each with its lock count
//     and whether it is closed), its Present entries, and the changes HR Pulse made with an OTP. When a stamp moves,
//     HR Pulse is told the site-day (caliber-hr server/mis-trip-card-days.mjs), marks its saved copy and reads the day
//     from Pulse-II the next time the roster is opened. A site-day that has never had a closed batch was never sent to
//     HR Pulse, so its stamp is kept without telling. A message that cannot be delivered waits and goes with the next
//     run. The first run only writes the stamps down: nothing is told for the past.
//
//  2. Nightly check, once a day from HR_DAY_NIGHT_HOUR (India). Pulse-II asks HR Pulse for its saved days (no cards)
//     and sets each against what the HR feed signs for that site and day now. A saved day that is not the same, and a
//     day saved before days were signed (it cannot be compared), is marked in HR Pulse the same way. This catches what
//     the stamps cannot see (a master change that moves a card to another person) and a message that was lost.
//     The release approvers are told on Telegram when the two were not the same (automation A29).
//
// Nothing here changes a card, a batch or attendance in Pulse-II, and HR Pulse deletes nothing: a marked day keeps its
// old rows until "Save trip cards" stores the new copy.
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {HR_CHANGE_FROM} from '../../shared/hr-attendance-change.mjs';
import {sameSite} from '../../shared/hr-site-cut.mjs';

export const HR_DAY_WATCH_STATE_KEY='hr_attendance_day_watch';
export const HR_DAY_WATCH_INTERVAL_MS=2*60*1000;
// How far back the stamps are kept. HR Pulse's roster opens at most 31 days at a time.
export const HR_DAY_WATCH_DAYS=62;
// HR Pulse has not taken the changed days for this long: the release approvers are told once.
export const HR_DAY_WATCH_SILENT_MINUTES=30;
// The nightly check: once a day, from 02:30 in India (after the Employee Master match at 02:00); after a failure it is
// tried again every 15 minutes.
export const HR_DAY_NIGHT_HOUR=2,HR_DAY_NIGHT_MINUTE=30,HR_DAY_NIGHT_RETRY_MINUTES=15;
// One question to the HR feed covers at most 31 days (manpowerFilters).
const FEED_SPAN_DAYS=31,SEND_LIMIT=2000,LIST_LIMIT=40;
export const HR_DAY_WATCH_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_hr_day_watch(site_key TEXT NOT NULL,book_date DATE NOT NULL,stamp TEXT NOT NULL,
 changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),told_at TIMESTAMPTZ,tries INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(book_date,site_key));
 CREATE INDEX IF NOT EXISTS mis_hr_day_watch_waiting ON mis_hr_day_watch(changed_at) WHERE told_at IS NULL;`;
const SETTINGS_SCHEMA="CREATE TABLE IF NOT EXISTS app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";
const READ_SQL='SELECT setting_value FROM app_settings WHERE setting_key=$1';
const SAVE_SQL=`INSERT INTO app_settings (setting_key,setting_value,updated_at) VALUES ($1,$2::jsonb,NOW())
 ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()`;
const CARDS_SQL=`SELECT site,book_date::text AS date,count(*)::int AS n,sum(id)::text AS ids,sum(revision)::text AS revs FROM mis_log_books
 WHERE book_type IN ('vehicle','equipment','lmv') AND deleted_at IS NULL AND book_date BETWEEN $1 AND $2 GROUP BY site,book_date`;
const BATCHES_SQL=`SELECT site,book_date::text AS date,id::text AS id,COALESCE(closure_revision,0)::int AS locks,(closed_at IS NOT NULL) AS closed FROM mis_vlb_batches
 WHERE deleted_at IS NULL AND archived_at IS NULL AND book_date BETWEEN $1 AND $2`;
const ENTRIES_SQL=`SELECT site,book_date::text AS date,count(*)::int AS n,
 md5(string_agg(shift||':'||employee_id::text||':'||kind||':'||reason,',' ORDER BY shift,employee_id)) AS hash FROM mis_shift_attendance
 WHERE book_date BETWEEN $1 AND $2 GROUP BY site,book_date`;
const CHANGES_SQL=`SELECT site_key AS site,book_date::text AS date,count(*)::int AS n,
 md5(string_agg(id::text||':'||(replaced_at IS NULL)::text,',' ORDER BY id)) AS hash FROM mis_hr_attendance_changes
 WHERE status='used' AND book_date BETWEEN $1 AND $2 GROUP BY site_key,book_date`;
const STORED_SQL='SELECT site_key,book_date::text AS date,stamp FROM mis_hr_day_watch WHERE book_date BETWEEN $1 AND $2';
// quiet: the stamp is kept without telling HR Pulse (the first run, or a day that was never sent to it). A day that is
// still waiting to be told stays waiting.
const UPSERT_SQL=`INSERT INTO mis_hr_day_watch(site_key,book_date,stamp,changed_at,told_at)
 SELECT v.site_key,v.book_date,v.stamp,NOW(),CASE WHEN v.quiet THEN NOW() END FROM unnest($1::text[],$2::date[],$3::text[],$4::boolean[]) AS v(site_key,book_date,stamp,quiet)
 ON CONFLICT(book_date,site_key) DO UPDATE SET stamp=EXCLUDED.stamp,changed_at=NOW(),tries=0,
  told_at=CASE WHEN EXCLUDED.told_at IS NULL THEN NULL ELSE mis_hr_day_watch.told_at END`;
const WAITING_SQL=`SELECT site_key,book_date::text AS date FROM mis_hr_day_watch WHERE told_at IS NULL ORDER BY changed_at,book_date,site_key LIMIT ${SEND_LIMIT}`;
const TOLD_SQL=`UPDATE mis_hr_day_watch w SET told_at=NOW() FROM unnest($1::text[],$2::date[]) AS v(site_key,book_date)
 WHERE w.site_key=v.site_key AND w.book_date=v.book_date AND w.told_at IS NULL`;
const TRIED_SQL=`UPDATE mis_hr_day_watch w SET tries=w.tries+1 FROM unnest($1::text[],$2::date[]) AS v(site_key,book_date)
 WHERE w.site_key=v.site_key AND w.book_date=v.book_date AND w.told_at IS NULL`;

const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=value=>value===null||value===undefined?'':String(value).trim();
const count=value=>Number(value||0).toLocaleString('en-IN');
const DAY=86400000;
const istDate=at=>new Date(at+5.5*60*60*1000).toISOString().slice(0,10);
const istMinutes=at=>{const d=new Date(at+5.5*60*60*1000);return d.getUTCHours()*60+d.getUTCMinutes();};
const istClock=at=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));
const addDays=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
const ddmm=date=>`${date.slice(8,10)}-${date.slice(5,7)}`;
const keyOf=(siteKey,date)=>siteKey+'|'+date;
const split=key=>{const cut=key.lastIndexOf('|');return {siteKey:key.slice(0,cut),date:key.slice(cut+1)};};

// One stamp per site-day ("site key|date") of everything its attendance is made from. It starts with L when a batch
// of the day is closed (the day may have been sent to HR Pulse) and with O when none is.
export function dayStamps({cards=[],batches=[],entries=[],changes=[]}){
 const parts=new Map(),closed=new Set();
 const add=(site,date,part)=>{const siteKey=canonicalSiteName(site);if(!siteKey||!date)return;const k=keyOf(siteKey,date);if(!parts.has(k))parts.set(k,[]);parts.get(k).push(part);return k;};
 for(const r of cards)add(r.site,r.date,`c:${text(r.site)}:${r.n}:${r.ids}:${r.revs}`);
 for(const r of batches){const k=add(r.site,r.date,`b:${r.id}@${Number(r.locks||0)}${r.closed?'':'!'}`);if(k&&r.closed)closed.add(k);}
 for(const r of entries)add(r.site,r.date,`p:${text(r.site)}:${r.n}:${r.hash}`);
 for(const r of changes)add(r.site,r.date,`h:${r.n}:${r.hash}`);
 return new Map([...parts].map(([k,list])=>[k,(closed.has(k)?'L|':'O|')+list.sort().join(';')]));
}
const sentDay=stamp=>text(stamp).startsWith('L|');

// What changed between the stamps kept and the stamps now. A site-day that is no longer there at all (its cards and
// batches are gone) gets the stamp "O|gone". quiet: nothing is told (see the header).
export function changedDays(stored,current,{baseline=false}={}){
 const out=[];
 for(const [key,stamp] of current){
  const old=stored.get(key);
  if(old===stamp)continue;
  out.push({...split(key),stamp,quiet:baseline||(!sentDay(stamp)&&!sentDay(old))});
 }
 for(const [key,old] of stored)if(!current.has(key)&&old!=='O|gone')out.push({...split(key),stamp:'O|gone',quiet:baseline||!sentDay(old)});
 return out;
}

// The Pulse-II site keys and signatures a saved day of HR Pulse was read from ("key:signature,key:signature").
export const signedParts=signature=>text(signature).split(',').filter(part=>part.includes(':')).map(part=>{const cut=part.lastIndexOf(':');return {siteKey:part.slice(0,cut).trim(),signature:part.slice(cut+1).trim()};}).filter(part=>part.siteKey);

// The nightly check, worked out without reading or writing anything.
//  saved: HR Pulse's saved days [{site,day,signature,changedAt}]; feed: what the HR feed signs now [{siteKey,date,signature}].
//  → differed: signed days that are not what Pulse-II holds; unsigned: days saved before signing; mark: what HR Pulse is told.
export function nightlyPlan(saved,feed){
 const now=new Map(feed.map(d=>[keyOf(d.siteKey,d.date),text(d.signature)]));
 const byDate=new Map();for(const d of feed){if(!byDate.has(d.date))byDate.set(d.date,[]);byDate.get(d.date).push(d.siteKey);}
 const differed=[],unsigned=[],mark=[];let checked=0,alreadyMarked=0;
 for(const day of Array.isArray(saved)?saved:[]){
  const site=text(day?.site),date=text(day?.day),signature=text(day?.signature);
  if(!site||!date)continue;
  if(day.changedAt){alreadyMarked++;continue;}
  const parts=signedParts(signature);
  if(parts.length){
   checked++;
   if(parts.some(part=>now.get(keyOf(part.siteKey,date))!==part.signature)){differed.push({site,day:date});for(const part of parts)mark.push({siteKey:part.siteKey,date});}
   continue;
  }
  if(signature==='none'){
   // Saved when Pulse-II held nobody for the site that day: still right unless Pulse-II now signs a day for it.
   checked++;
   const mine=(byDate.get(date)||[]).filter(siteKey=>sameSite(site,siteKey));
   if(mine.length){differed.push({site,day:date});mark.push({siteKey:site.toLowerCase(),date});}
   continue;
  }
  // Saved before days were signed: it cannot be compared, so it is read again. HR Pulse finds it by its own site name.
  unsigned.push({site,day:date});mark.push({siteKey:site.toLowerCase(),date});
 }
 return {checked,alreadyMarked,differed,unsigned,mark};
}

// Is the nightly check due? Once per India day, from 02:30, and not within the retry time of a try that failed.
export const nightDue=(state,at)=>istMinutes(at)>=HR_DAY_NIGHT_HOUR*60+HR_DAY_NIGHT_MINUTE&&state?.lastNight?.day!==istDate(at)
 &&!(state?.nightTriedAt&&at-Date.parse(state.nightTriedAt)<HR_DAY_NIGHT_RETRY_MINUTES*60*1000);

const dayList=list=>{
 const bySite=new Map();for(const d of list){if(!bySite.has(d.site))bySite.set(d.site,[]);bySite.get(d.site).push(d.day);}
 return [...bySite].sort(([a],[b])=>a.localeCompare(b)).map(([site,days])=>`${site}: ${days.sort().slice(0,12).map(ddmm).join(', ')}${days.length>12?` and ${days.length-12} more`:''}`).join('\n');
};
export function nightlyMessage({day,differed,unsigned,marked,hrOnlyCorrections}){
 const lines=[`⚠️ Trip card days, nightly check with HR Pulse (${day}): HR Pulse's saved days were not all what Pulse-II holds.`];
 if(differed.length)lines.push(`${count(differed.length)} saved day${differed.length===1?' was':'s were'} changed in Pulse-II after saving:`,dayList(differed));
 if(unsigned.length)lines.push(`${count(unsigned.length)} day${unsigned.length===1?' was':'s were'} saved before days were signed and could not be compared:`,dayList(unsigned));
 lines.push(`${count(marked)} saved day${marked===1?' is':'s are'} marked in HR Pulse. The roster reads them from Pulse-II again when it is opened; "Save trip cards" there keeps the new copy.`);
 if(hrOnlyCorrections)lines.push(`Old corrections kept only in HR Pulse and not applied: ${count(hrOnlyCorrections)}. HR sets them again with an OTP.`);
 return lines.join('\n');
}

// hr: the HR Pulse client (server/services/hr-employee-sync.mjs: configured, tripCardDays, tripCardDaysChanged).
// feedDays: ({from,to}) => the HR feed's signatures of every site, at most 31 days ([{siteKey,date,signature}]).
// live: only the live server runs it (the test slot must never mark HR Pulse's days).
export function createHrAttendanceDayWatch({pool,hr,feedDays,ensureBooks=async()=>{},now=()=>Date.now(),alert=async()=>{},live=true,log=console}){
 let schema=null,running=false,timer=null,first=null,last={};
 const ensure=()=>schema??=pool.query(SETTINGS_SCHEMA).then(()=>pool.query(HR_DAY_WATCH_SCHEMA)).catch(error=>{schema=null;throw error;});
 const iso=()=>new Date(now()).toISOString();
 const readState=async()=>{await ensure();return (await pool.query(READ_SQL,[HR_DAY_WATCH_STATE_KEY])).rows[0]?.setting_value||{};};
 const saveState=async patch=>{const state={...await readState(),...patch};await pool.query(SAVE_SQL,[HR_DAY_WATCH_STATE_KEY,JSON.stringify(state)]);last=state;return state;};
 const tell=async(key,message)=>{try{await alert(message,key);}catch{/* an alert that cannot be sent never stops the watch */}};
 const range=()=>{const to=istDate(now()),from=addDays(to,-HR_DAY_WATCH_DAYS);return {from:from<HR_CHANGE_FROM?HR_CHANGE_FROM:from,to};};

 async function readStamps(db,{from,to}){
  const has=async name=>Boolean((await db.query('SELECT to_regclass($1) IS NOT NULL AS has',[name])).rows[0]?.has);
  const rows=async(sql,table)=>table&&!(await has(table))?[]:(await db.query(sql,[from,to])).rows;
  return dayStamps({cards:await rows(CARDS_SQL),batches:await rows(BATCHES_SQL),entries:await rows(ENTRIES_SQL,'mis_shift_attendance'),changes:await rows(CHANGES_SQL,'mis_hr_attendance_changes')});
 }
 // The stamps of now set against the stamps kept: what moved is written down, and waits to be told unless it is quiet.
 async function note(db,state){
  const dates=range(),current=await readStamps(db,dates);
  const stored=new Map((await db.query(STORED_SQL,[dates.from,dates.to])).rows.map(r=>[keyOf(r.site_key,r.date),r.stamp]));
  const baseline=!state.baselineAt,moved=changedDays(stored,current,{baseline});
  if(moved.length)await db.query(UPSERT_SQL,[moved.map(d=>d.siteKey),moved.map(d=>d.date),moved.map(d=>d.stamp),moved.map(d=>d.quiet)]);
  return {baseline,days:current.size,moved:moved.length,toTell:moved.filter(d=>!d.quiet).length};
 }
 // Every waiting site-day goes to HR Pulse in one message; what it does not take waits for the next run.
 async function send(db){
  const waiting=(await db.query(WAITING_SQL)).rows;
  if(!waiting.length)return {sent:0,marked:0};
  const sites=waiting.map(r=>r.site_key),dates=waiting.map(r=>r.date);
  try{
   const answer=await hr.tripCardDaysChanged({reason:'Changed in Pulse-II',days:waiting.map(r=>({siteKey:r.site_key,date:r.date}))});
   await db.query(TOLD_SQL,[sites,dates]);
   return {sent:waiting.length,marked:Number(answer?.marked||0)};
  }catch(error){
   await db.query(TRIED_SQL,[sites,dates]).catch(()=>{});
   throw error;
  }
 }

 // The nightly check (see the header). by: who asked for it.
 async function night({by='Nightly check'}={}){
  if(!hr.configured())throw fail(503,'HR connection is not set up (HR_SYNC_KEY).');
  const at=iso(),day=istDate(now());
  try{
   const {from,to}=range();
   const saved=await hr.tripCardDays({from,to});
   const list=Array.isArray(saved?.days)?saved.days:null;
   if(!list)throw fail(502,'HR Pulse returned no list of saved days. Nothing was marked.');
   const feed=[];
   for(let start=from;start<=to;start=addDays(start,FEED_SPAN_DAYS)){const end=addDays(start,FEED_SPAN_DAYS-1);feed.push(...await feedDays({from:start,to:end>to?to:end}));}
   const plan=nightlyPlan(list,feed);
   let marked=0;
   for(let start=0;start<plan.mark.length;start+=SEND_LIMIT){
    const answer=await hr.tripCardDaysChanged({reason:'Nightly check: not what Pulse-II holds',days:plan.mark.slice(start,start+SEND_LIMIT)});
    marked+=Number(answer?.marked||0);
   }
   const same=!plan.differed.length&&!plan.unsigned.length,hrOnlyCorrections=Number(saved.hrOnlyCorrections||0);
   const lastNight={at,day,by:text(by).slice(0,120),same,saved:list.length,checked:plan.checked,alreadyMarked:plan.alreadyMarked,differed:plan.differed.length,unsigned:plan.unsigned.length,marked,hrOnlyCorrections,
    list:[...plan.differed,...plan.unsigned].slice(0,LIST_LIMIT)};
   await saveState({nightTriedAt:at,nightError:'',lastNight});
   if(!same)await tell(`hr-trip-card-days:night:${day}`,nightlyMessage({day,differed:plan.differed,unsigned:plan.unsigned,marked,hrOnlyCorrections}));
   return {ok:true,...lastNight};
  }catch(error){
   const message=error?.status?error.message:'The nightly check of trip card days with HR Pulse failed. Nothing was marked.';
   const state=await saveState({nightTriedAt:at,nightError:message}).catch(()=>({}));
   // Told once per night, however many times it is tried again.
   if(state.nightFailureDay!==day){await saveState({nightFailureDay:day}).catch(()=>{});await tell(`hr-trip-card-days:night-failed:${day}`,`⚠️ Trip card days, nightly check with HR Pulse (${day}) could not be made at ${istClock(now())} IST. It is tried again every ${HR_DAY_NIGHT_RETRY_MINUTES} minutes.\n${message}`);}
   throw error;
  }
 }

 async function tick(){
  if(running)return {skipped:'running'};
  if(!live)return {skipped:'not the live server'};
  if(!hr.configured())return {skipped:'not connected'};
  running=true;
  let guard=null,locked=false;
  try{
   await ensure();await ensureBooks();
   // One server at a time: the others see the lock taken and leave this run to it.
   guard=await pool.connect();
   locked=(await guard.query('SELECT pg_try_advisory_lock(709224117) AS ok')).rows[0]?.ok!==false;
   if(!locked)return {skipped:'another server'};
   let state=await readState();
   if(state.lastRunAt&&now()-Date.parse(state.lastRunAt)<HR_DAY_WATCH_INTERVAL_MS-15000)return {skipped:'recent'};
   const at=iso();
   const noted=await note(guard,state);
   if(noted.baseline){state=await saveState({baselineAt:at,lastRunAt:at,lastOkAt:at,error:'',failingSince:null,failureTold:false});return {ok:true,...noted};}
   let sent={sent:0,marked:0};
   try{
    sent=await send(guard);
    state=await saveState({lastRunAt:at,lastOkAt:at,error:'',failingSince:null,failureTold:false,...(sent.sent?{lastSentAt:at,lastSent:sent}:{})});
   }catch(error){
    const message=error?.status?error.message:'HR Pulse did not take the changed days.',since=state.failingSince||at;
    const silent=now()-Date.parse(since)>=HR_DAY_WATCH_SILENT_MINUTES*60*1000;
    if(silent&&!state.failureTold)await tell(`hr-trip-card-days:silent:${since}`,`⚠️ Pulse-II has not been able to tell HR Pulse which trip card days changed since ${istClock(Date.parse(since))} IST. The changed days wait and go when HR Pulse answers; the nightly check also catches them.\n${message}`);
    state=await saveState({lastRunAt:at,error:message,failingSince:since,failureTold:state.failureTold||silent});
    return {ok:false,...noted,error:message};
   }
   // Once a night every saved day is checked, after this run's changes have gone.
   if(nightDue(state,now()))await night().catch(error=>log.error?.('Trip card days nightly check failed',error?.message));
   return {ok:true,...noted,...sent};
  }finally{
   if(guard){if(locked)await guard.query('SELECT pg_advisory_unlock(709224117)').catch(()=>{});guard.release();}
   running=false;
  }
 }
 const status=async()=>{const state=await readState();return {connected:hr.configured(),live,everySeconds:HR_DAY_WATCH_INTERVAL_MS/1000,startedAt:state.baselineAt||null,lastRunAt:state.lastRunAt||null,lastOkAt:state.lastOkAt||null,
  lastSentAt:state.lastSentAt||null,lastSent:state.lastSent||null,error:text(state.error),lastNight:state.lastNight||null,nightError:text(state.nightError),nightHour:`${String(HR_DAY_NIGHT_HOUR).padStart(2,'0')}:${String(HR_DAY_NIGHT_MINUTE).padStart(2,'0')}`};};
 const run=()=>void tick().catch(error=>log.error?.('Trip card day watch for HR Pulse failed',error?.message));
 return {tick,night,status,
  // What the Automation Centre shows without a database read: the state as this server last wrote it.
  last:()=>({running:Boolean(timer||first)&&live,lastRunAt:last.lastRunAt||null,lastNight:last.lastNight||null,error:text(last.error)}),
  startTimer({firstDelayMs=150*1000}={}){if(timer||first)return;first=setTimeout(()=>{first=null;run();timer=setInterval(run,HR_DAY_WATCH_INTERVAL_MS);timer.unref?.();},firstDelayMs);first.unref?.();},
  stopTimer(){clearTimeout(first);clearInterval(timer);first=null;timer=null;}};
}
