// Repeat opens of the Attendance read (owner, 24 Nov 2026: "instant next, yes, do it").
//
// The read serves Attendance Batch-wise and Month-wise, Site Sheet vs Trip Card, Trip Card vs Bio-punch, the biometric
// check and the HR feed, and several of them read the same dates one after another. Two things are kept in memory, as
// JSON text, and used again only while everything they were built from is unchanged:
//  - a week: its card fingerprints (count, ids and revisions of every locked site-day, with its batches' lock counts),
//    the batch links of those cards, its batches, its zero-trip entries, the masters, the sites of the range, the
//    dates and the login's sites. Only a week that ended at least two days ago is kept: before that the state of an
//    empty shift slot ("not due" / "none") still changes with the clock.
//  - the answer: the keys of all its weeks and the locked days. One that holds a recent week is kept 5 minutes at most,
//    for the same reason.
// Anything that changes a key (a card saved or edited, a batch locked or reopened, a master changed) makes a new key, so
// the old text is simply never asked for again and leaves the cache when it is old or the cache is full.
// ATTENDANCE_CACHE_MB=0 switches it off. The cache lives in each server's memory and is empty after a restart.
import {createHash} from 'node:crypto';

export const ATTENDANCE_WEEK_KEEP_MS=30*60_000;
export const ATTENDANCE_RECENT_KEEP_MS=5*60_000;
export const attendanceCacheBytes=(env=process.env)=>{
 const mb=Number(env.ATTENDANCE_CACHE_MB);
 return (env.ATTENDANCE_CACHE_MB!==undefined&&env.ATTENDANCE_CACHE_MB!==''&&Number.isFinite(mb)&&mb>=0?mb:200)*1024*1024;
};
export const fingerprint=(...parts)=>{const h=createHash('sha256');for(const p of parts)h.update(typeof p==='string'?p:JSON.stringify(p)??'null').update('\u0000');return h.digest('hex');};

// Text kept by key, newest use last; at most maxBytes (string length) in all, each until its own time.
export function createTextCache({maxBytes=attendanceCacheBytes(),now=()=>Date.now()}={}){
 const entries=new Map();let bytes=0,hits=0,misses=0;
 const drop=key=>{const e=entries.get(key);if(e){bytes-=e.text.length;entries.delete(key);}};
 return {
  get(key){
   const e=entries.get(key);
   if(!e||e.until<=now()){if(e)drop(key);misses++;return null;}
   entries.delete(key);entries.set(key,e);hits++;return e.text;
  },
  set(key,text,keepMs){
   if(typeof text!=='string'||maxBytes<=0||text.length>maxBytes/2||!(keepMs>0))return;
   drop(key);
   const time=now();
   for(const [k,e] of entries)if(e.until<=time)drop(k);
   while(bytes+text.length>maxBytes&&entries.size)drop(entries.keys().next().value);
   entries.set(key,{text,until:time+keepMs});bytes+=text.length;
  },
  stats:()=>({entries:entries.size,megabytes:Math.round(bytes/1048576),maxMegabytes:Math.round(maxBytes/1048576),hits,misses}),
 };
}
export const attendanceAnswerCache=createTextCache();
