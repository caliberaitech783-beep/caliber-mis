import {createHash} from 'node:crypto';

// Pulse-II's own copy of Pulse's breakdown list (15 Nov 2026).
//
// Before this, every VLB/ELB card asked Pulse live for its BD hours, through the reviewer's own
// Pulse sign-in. A slow Pulse (gateway 504), a reviewer whose Pulse sign-in was older than seven
// days, or a Pulse deploy held cards at "Enter breakdown hours manually because Pulse could not
// provide them". The server now reads the whole list once a minute in the background and keeps it
// in memory and in the database, so card checks read Pulse-II's copy and never wait on Pulse.
// If Pulse cannot be read, the last good copy keeps answering and its age is shown.

export const PULSE_MIRROR_REFRESH_MS=60_000;
// A copy younger than this answers on its own; an older one first tries Pulse live.
export const PULSE_MIRROR_FRESH_MS=15*60_000;
// The oldest copy still used when Pulse cannot be read at all.
export const PULSE_MIRROR_MAX_AGE_MS=24*60*60_000;
// A changed list is written to the database at most this often. The stored copy only serves a
// restart (the first read after a start replaces it at once), so it may lag the memory copy.
export const PULSE_MIRROR_STORE_MS=5*60_000;

// Why the list is read as raw bytes (24 Nov 2026): the whole list is about 26,000 rows. Parsing
// it, turning it back into text to compare and again to store held the server's main thread for
// about a second every minute ("freezes" in /api/diagnostics/performance, one a minute at the
// same second). Now the bytes are compared first; an unchanged list is never parsed, and a
// changed one is parsed once and stored from the bytes Pulse sent.

const TABLE='CREATE TABLE IF NOT EXISTS pulse_breakdown_mirror(id SMALLINT PRIMARY KEY CHECK(id=1),rows JSONB NOT NULL,row_count INTEGER NOT NULL,content_hash TEXT NOT NULL,read_at TIMESTAMPTZ NOT NULL)';
const hashText=text=>createHash('sha256').update(text).digest('hex');
const INSERT='INSERT INTO pulse_breakdown_mirror(id,rows,row_count,content_hash,read_at) VALUES(1,$1::jsonb,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET rows=EXCLUDED.rows,row_count=EXCLUDED.row_count,content_hash=EXCLUDED.content_hash,read_at=EXCLUDED.read_at';

// Rows handed out from the copy carry the time Pulse was last read; readHours uses it.
const readTimes=new WeakMap();
export function mirrorReadAt(rows){return rows&&typeof rows==='object'?readTimes.get(rows)??null:null;}
const tag=(rows,readAt)=>{readTimes.set(rows,readAt);return rows;};

// readFeedRaw: Pulse's answer as bytes (Buffer or string), preferred. readFeed: the parsed rows,
// used only when no raw reader is given.
export function createPulseBreakdownMirror({pool,readFeed,readFeedRaw=null,now=Date.now,refreshMs=PULSE_MIRROR_REFRESH_MS,storeMs=PULSE_MIRROR_STORE_MS,log=console}){
 let copy=null,loaded=false,lastAttempt=null,lastError='',refreshing=null,timer=null,started=false,refreshes=0,failures=0,writes=0,unchangedReads=0,parses=0;
 // What the database holds (hash, when written) and a changed list not written yet.
 let storedHash=null,storedAt=null,unstored=null;
 const ensure=async()=>{await pool.query(TABLE);};
 const load=async()=>{
  if(loaded)return copy;loaded=true;
  try{await ensure();const row=(await pool.query('SELECT rows,content_hash,read_at FROM pulse_breakdown_mirror WHERE id=1')).rows[0];
   if(row&&Array.isArray(row.rows)){storedHash=row.content_hash;if(!copy)copy={rows:row.rows,hash:row.content_hash,readAt:new Date(row.read_at).getTime()};}}
  catch(e){log.error?.('[pulse-mirror] stored copy could not be read:',e?.message||e);}
  return copy;
 };
 // Pulse's answer: its hash, and the rows only when they differ from the copy held now.
 const readPulse=async()=>{
  if(readFeedRaw){
   const raw=await readFeedRaw();
   if(raw==null||(typeof raw!=='string'&&!Buffer.isBuffer(raw)))throw new Error('Pulse returned an invalid breakdown feed.');
   const hash=hashText(raw);
   if(copy&&hash===copy.hash)return {hash,rows:null};
   const text=typeof raw==='string'?raw:raw.toString('utf8');
   let rows;try{rows=JSON.parse(text);}catch{rows=null;}
   parses++;
   if(!Array.isArray(rows))throw new Error('Pulse returned an invalid breakdown feed.');
   return {hash,rows,text};
  }
  const rows=await readFeed();
  if(!Array.isArray(rows))throw new Error('Pulse returned an invalid breakdown feed.');
  const text=JSON.stringify(rows);
  return {hash:hashText(text),rows,text};
 };
 const refresh=()=>{
  if(refreshing)return refreshing;
  refreshing=(async()=>{
   lastAttempt=now();
   try{
    await load();
    const {hash,rows,text}=await readPulse();
    const readAt=now(),changed=hash!==copy?.hash;
    copy={rows:rows||copy.rows,hash,readAt};lastError='';refreshes++;
    if(!changed)unchangedReads++;
    else unstored=hash===storedHash?null:{text,count:copy.rows.length,hash};
    // A changed list is written at most once every storeMs; an unchanged list that the
    // database already holds only moves the read time, so a quiet night writes almost nothing.
    if(unstored&&(storedAt==null||readAt-storedAt>=storeMs)){
     const {text:body,count,hash:written}=unstored;
     await ensure();await pool.query(INSERT,[body,count,written,new Date(readAt).toISOString()]);
     storedHash=written;storedAt=readAt;unstored=null;writes++;
    }else if(!unstored&&storedHash===hash)await pool.query('UPDATE pulse_breakdown_mirror SET read_at=$1 WHERE id=1',[new Date(readAt).toISOString()]).catch(()=>{});
    return copy;
   }catch(e){lastError=e?.message||String(e);failures++;throw e;}
   finally{refreshing=null;}
  })();
  return refreshing;
 };
 const ageMs=()=>copy?now()-copy.readAt:null;
 return {
  /** The copy, if it is young enough; null otherwise. Never calls Pulse. */
  async read({maxAgeMs=PULSE_MIRROR_FRESH_MS}={}){
   await load();
   if(!copy||ageMs()>maxAgeMs)return null;
   return tag(copy.rows,copy.readAt);
  },
  refresh,
  status(){const age=ageMs();return {enabled:true,readAt:copy?new Date(copy.readAt).toISOString():null,ageSeconds:age==null?null:Math.round(age/1000),rows:copy?.rows.length??0,fresh:age!=null&&age<=PULSE_MIRROR_FRESH_MS,lastAttempt:lastAttempt?new Date(lastAttempt).toISOString():null,lastError,refreshes,failures,writes,unchangedReads,parses,storedAt:storedAt?new Date(storedAt).toISOString():null,storePending:Boolean(unstored)};},
  async start(){
   if(started)return;started=true;
   await load();
   const tick=()=>{void refresh().catch(()=>{});};
   tick();timer=setInterval(tick,refreshMs);timer.unref?.();
  },
  stop(){clearInterval(timer);timer=null;started=false;},
 };
}

/**
 * Breakdown rows for BD hours: the copy when it is fresh, else Pulse live, else the last good copy
 * up to a day old. `readLive` is the old per-user live read.
 */
export async function readBreakdownRowsWithMirror(mirror,readLive){
 if(!mirror)return readLive();
 const fresh=await mirror.read();
 if(fresh)return fresh;
 try{return await readLive();}
 catch(error){
  const old=await mirror.read({maxAgeMs:PULSE_MIRROR_MAX_AGE_MS});
  if(old)return old;
  throw error;
 }
}

const STALE_NOTE_MS=5*60_000;
/** Adds when Pulse was read to a BD-hours answer built from the copy, and a note when the copy is old enough to miss part of the shift. */
export function withPulseCopyTime(summary,readAt,now=Date.now()){
 const asOf=new Date(readAt),out={...summary,pulseAsOf:asOf.toISOString(),pulseSource:'copy'};
 if(now-readAt>STALE_NOTE_MS&&Date.parse(summary.shiftEnd)>readAt){
  const time=asOf.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
  out.warnings=[...(summary.warnings||[]),'Pulse could not be read since '+time+' IST; breakdowns after that are not counted yet.'];
 }
 return out;
}
