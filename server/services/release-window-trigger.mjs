// Backup trigger for the production release windows (12:00, 15:00, 18:00, 00:00 IST).
// GitHub starts timed workflow runs late or not at all, so Pulse-II, which runs all
// day, starts the release workflow itself in each window with the choice
// "Scheduled window now". The workflow then runs the same checks as a timed run
// (scripts/release-window.sh): nothing new on main, or past the window's hour,
// deploys nothing. A duplicate start in one window is therefore harmless.
//
// It runs only when the Azure setting MIS_RELEASE_DISPATCH_TOKEN holds a GitHub
// fine-grained token for this repository with "Actions: read and write". Server
// instances share one claim per window in app_settings, so one start is sent.
export const RELEASE_TRIGGER_SETTING_KEY='release_window_trigger';
export const BACKUP_CHOICE='Scheduled window now (backup trigger: releases only in the hour after a window)';
const WINDOWS=[0,720,900,1080]; // minutes after IST midnight
const START_AFTER=1,STOP_AFTER=20; // minutes after the window start in which a start is sent

// The window due at this moment, as "YYYY-MM-DD HH:MM IST", or null.
export function dueWindow(now=Date.now()){
 const ist=new Date(now+330*60000),minute=ist.getUTCHours()*60+ist.getUTCMinutes();
 const start=WINDOWS.filter(w=>w<=minute).pop(),since=minute-start;
 if(since<START_AFTER||since>STOP_AFTER)return null;
 return `${ist.toISOString().slice(0,10)} ${String(start/60).padStart(2,'0')}:00 IST`;
}

export function createReleaseWindowTrigger({pool,token,repository='caliberaitech783-beep/caliber-mis',workflowFile='main_caliber-mis-783.yml',fetchImpl=fetch,now=()=>Date.now(),log=console}){
 const state={configured:Boolean(token),last:null};
 // Claims the window for this instance. A failed start may be claimed again.
 const claim=async window=>(await pool.query(`INSERT INTO app_settings (setting_key,setting_value,updated_at) VALUES ($1,$2::jsonb,NOW())
   ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()
   WHERE app_settings.setting_value->>'window' IS DISTINCT FROM $3 OR app_settings.setting_value->>'status'='failed'
   RETURNING setting_key`,[RELEASE_TRIGGER_SETTING_KEY,JSON.stringify({window,status:'starting',at:new Date(now()).toISOString()}),window])).rowCount>0;
 const record=value=>pool.query(`UPDATE app_settings SET setting_value=$2::jsonb,updated_at=NOW() WHERE setting_key=$1`,[RELEASE_TRIGGER_SETTING_KEY,JSON.stringify(value)]);
 async function tick(){
  const window=dueWindow(now());
  if(!token||!window||!await claim(window))return null;
  let status='failed',httpStatus=0;
  try{
   const response=await fetchImpl(`https://api.github.com/repos/${repository}/actions/workflows/${workflowFile}/dispatches`,{
    method:'POST',signal:AbortSignal.timeout(20000),
    headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'pulse-ii-release-window','content-type':'application/json'},
    body:JSON.stringify({ref:'main',inputs:{when:BACKUP_CHOICE}}),
   });
   httpStatus=response.status;
   if(response.status===204)status='started';
  }catch(error){log.error?.('Release window trigger could not reach GitHub.',error.message);}
  const result={window,status,httpStatus,at:new Date(now()).toISOString()};
  state.last=result;
  await record(result);
  (status==='started'?log.log:log.error)?.call(log,`Release window ${window}: workflow start ${status} (HTTP ${httpStatus}).`);
  return result;
 }
 return {tick,state};
}
