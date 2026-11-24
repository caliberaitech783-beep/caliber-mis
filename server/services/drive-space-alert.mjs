// Server drive nearly full, on Telegram (Automation line A28). Owner, 24 Nov 2026: "intimate us on Telegram whenever
// 470 GB of data is crossed out of 500 GB, and ... after 470, if it is upward, then every 6 hours we should get that
// message", to Mohit Chadda and Anup both.
//
// Why: Pulse-II, its test slot and Pulse share one 500 GB drive (/home of the App Service plan). On 13 and 24 Nov 2026
// it was full, and every release failed at the upload (Kudu 409) until space was freed.
//  - Only the live server checks (both slots see the same drive), every DRIVE_CHECK_MINUTES.
//  - At or above DRIVE_ALERT_USED_GB used, the owner's logins and Mr Mohit Chadda (the release approvers) are told at
//    once, and again every DRIVE_REMIND_HOURS while it stays there.
//  - The clock starts afresh only after the drive has come down below DRIVE_CLEAR_USED_GB, so a drive that sways
//    around 470 GB is not told every ten minutes.
//  - The last telling is kept in app_settings and claimed in one UPDATE, so a restart, a release or a second
//    server never tells twice within the six hours.
import {statfs} from 'node:fs/promises';

export const DRIVE_PATH='/home';
export const DRIVE_ALERT_USED_GB=470;
export const DRIVE_CLEAR_USED_GB=460;
export const DRIVE_REMIND_HOURS=6;
export const DRIVE_CHECK_MINUTES=10;
export const DRIVE_STATE_KEY='drive_space_alert';
const GB=1024*1024*1024;
const SCHEMA="CREATE TABLE IF NOT EXISTS app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";
const SEED_SQL="INSERT INTO app_settings(setting_key,setting_value) VALUES($1,'{}'::jsonb) ON CONFLICT (setting_key) DO NOTHING";
const READ_SQL='SELECT setting_value FROM app_settings WHERE setting_key=$1';
const PATCH_SQL='UPDATE app_settings SET setting_value=setting_value||$2::jsonb,updated_at=NOW() WHERE setting_key=$1';
// Takes the telling for this server only when nobody told within the last DRIVE_REMIND_HOURS ($3 = that moment).
const CLAIM_SQL=`UPDATE app_settings SET setting_value=setting_value||$2::jsonb,updated_at=NOW()
 WHERE setting_key=$1 AND (COALESCE(setting_value->>'toldAt','')='' OR (setting_value->>'toldAt')::timestamptz<=$3::timestamptz)
 RETURNING setting_key`;

const round=value=>Math.round(value*10)/10;
// Size, use and free space of the drive in GB as `df` shows them (1 GB = 1024 MB here, as in the Azure portal).
export function driveFigures(stats){
 const size=Number(stats?.bsize),blocks=Number(stats?.blocks),free=Number(stats?.bfree),available=Number(stats?.bavail);
 if(!(size>0)||!(blocks>0)||!(free>=0))return null;
 return {totalGb:round(blocks*size/GB),usedGb:round((blocks-free)*size/GB),freeGb:round((Number.isFinite(available)?available:free)*size/GB)};
}
const istClock=at=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));

export function driveAlertMessage({totalGb,usedGb,freeGb},aboveSince,first){
 return [
  `⚠️ Server drive nearly full: ${usedGb} GB of ${totalGb} GB used, ${freeGb} GB free (alert line ${DRIVE_ALERT_USED_GB} GB).`,
  `${first?'Crossed':'Above'} ${DRIVE_ALERT_USED_GB} GB since ${istClock(aboveSince)} IST.`,
  'Pulse-II, its test slot and Pulse share this drive. When it is full, releases fail at the upload (Kudu 409) and files cannot be saved.',
  'What fills it: Azure portal > App Service plan > File system storage.',
  `Told again every ${DRIVE_REMIND_HOURS} hours while it stays above ${DRIVE_ALERT_USED_GB} GB.`,
 ].join('\n');
}

// read(): {totalGb,usedGb,freeGb} or null. alert(message,key): tells the people. live: is this the live server?
export function createDriveSpaceAlert({pool,read=async()=>driveFigures(await statfs(DRIVE_PATH)),now=()=>Date.now(),alert=async()=>{},live=true}){
 let schema=null,timer=null,running=false,last=null;
 const ensure=()=>schema??=pool.query(SCHEMA).then(()=>pool.query(SEED_SQL,[DRIVE_STATE_KEY])).catch(error=>{schema=null;throw error;});
 const readState=async()=>(await pool.query(READ_SQL,[DRIVE_STATE_KEY])).rows[0]?.setting_value||{};
 const patch=value=>pool.query(PATCH_SQL,[DRIVE_STATE_KEY,JSON.stringify(value)]);

 async function tick(){
  if(!live)return {skipped:'not the live server'};
  if(running)return {skipped:'running'};
  running=true;
  try{
   const at=new Date(now()).toISOString();
   let space=null;
   try{space=await read();}catch{space=null;}
   if(!space){last={readAt:at,error:'The drive size could not be read.'};return {skipped:'unreadable'};}
   last={...space,readAt:at};
   await ensure();
   const state=await readState();
   if(space.usedGb<DRIVE_ALERT_USED_GB){
    // Back below the line: the next crossing is told at once, but only once the drive has really come down.
    const clear=space.usedGb<DRIVE_CLEAR_USED_GB;
    await patch({...space,readAt:at,aboveSince:null,...(clear?{toldAt:null}:{})});
    return {ok:true,above:false};
   }
   const aboveSince=state.aboveSince||at,first=!state.toldAt;
   const since=new Date(now()-DRIVE_REMIND_HOURS*60*60*1000).toISOString();
   const claimed=(await pool.query(CLAIM_SQL,[DRIVE_STATE_KEY,JSON.stringify({...space,readAt:at,aboveSince,toldAt:at}),since])).rows.length>0;
   if(!claimed){await patch({...space,readAt:at,aboveSince});return {ok:true,above:true};}
   try{await alert(driveAlertMessage(space,aboveSince,first),`drive-space:${at.slice(0,16)}`);}catch{/* an alert that cannot be sent never stops the check */}
   return {ok:true,above:true,told:true};
  }finally{running=false;}
 }
 return {
  tick,
  status:()=>({running:Boolean(timer),live,alertGb:DRIVE_ALERT_USED_GB,remindHours:DRIVE_REMIND_HOURS,last}),
  start(){
   if(timer||!live)return;
   const run=()=>{tick().catch(error=>console.error('Drive space check failed:',error?.message||error));};
   run();
   timer=setInterval(run,DRIVE_CHECK_MINUTES*60*1000);timer.unref?.();
  },
  stop(){if(timer)clearInterval(timer);timer=null;},
 };
}
