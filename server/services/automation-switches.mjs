import {isSingleReportPurpose} from '../../shared/whatsapp-template-catalog.mjs';

// One ON/OFF switch per automation on the Automation Centre page (A01, A02 ...).
// The switches are a master stop on top of each automation's own settings: when a switch is OFF
// nothing of that automation goes out on Telegram, WhatsApp or email; when it is ON the automation
// follows its own settings exactly as before. Every automation starts ON.
//
// The check sits where messages leave the application, not in each automation:
//  - the Pulse-II Telegram outbox and the approval-code sender look at the message's event key;
//  - the Pulse Telegram bot and WhatsApp senders look at the message purpose;
//  - the Audit Trail export and OEM email jobs ask for their own key.
// Switch states are read from app_settings and kept for 15 seconds, so a change made on another
// server instance is followed within that time.

export const AUTOMATION_SWITCHES_SETTING_KEY='automation_switches';
const CACHE_MS=15_000;

// Event key prefix of a Pulse-II Telegram outbox message -> automation key.
const EVENT_PREFIX={
 'equipment-mismatch':'equipment-mismatch','pulse-pending':'pulse-pending',
 'alias-otp':'alias-otp','alias-shadow':'alias-suspended','alias-weekly':'alias-weekly',
 'transfer-otp':'transfer-otp','equipment-otp':'equipment-otp','vlb-approval-otp':'vlb-approval-otp','employee-move-otp':'employee-move-otp','hr-employee-copy':'hr-employee-copy','drive-space':'drive-space',
 created:'mis-ticket',resolved:'mis-ticket','scan-batch-report':'scan-batch-report','health-report':'health-report',
};
// Pulse Telegram / WhatsApp message purpose -> automation key.
const PURPOSE={
 requestOpened:'request-opened',requestClosed:'request-closed',requestVerified:'request-verified',requestIdle:'request-idle',
 offRoadEscalation:'request-reminders',idleReminder:'request-reminders',dailyUpdate:'daily-update',
 consolidatedTicketReport:'crm-report',consolidatedRequestReport:'hierarchy-report',
 passwordResetOtp:'password-otp',logBookDeletionOtp:'deletion-otp',equipmentMismatch:'equipment-mismatch',
};

export function automationForEventKey(eventKey){
 const key=String(eventKey||''),prefix=key.split(':')[0];
 if(prefix==='vlb-alert')return key.includes('|not_closed:')?'vlb-batch-not-closed':key.includes('|not_created:')?'vlb-batch-not-created':null;
 return EVENT_PREFIX[prefix]||null;
}
export function automationForPurpose(purpose){
 const name=String(purpose||'');
 if(PURPOSE[name])return PURPOSE[name];
 return isSingleReportPurpose(name)?'hierarchy-report':null;
}

export function normalizeAutomationSwitches(value){
 const result={};
 for(const [key,entry] of Object.entries(value&&typeof value==='object'?value:{})){
  if(!/^[a-z0-9-]{1,60}$/.test(key)||!entry||typeof entry!=='object')continue;
  result[key]={enabled:entry.enabled!==false,changedBy:String(entry.changedBy||'').slice(0,120),changedAt:String(entry.changedAt||'').slice(0,40)};
 }
 return result;
}

let pool=null,cache=null,loadedAt=0,loading=null;
export function configureAutomationSwitches(options={}){pool=options.pool||null;cache=null;loadedAt=0;loading=null;}

export async function readAutomationSwitches(db=pool){
 if(!db)return {};
 const {rows}=await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[AUTOMATION_SWITCHES_SETTING_KEY]);
 return normalizeAutomationSwitches(rows[0]?.setting_value);
}

async function current(){
 if(!pool)return {};
 if(cache&&Date.now()-loadedAt<CACHE_MS)return cache;
 loading??=readAutomationSwitches(pool).then(value=>{cache=value;loadedAt=Date.now();return value;})
  // A failed read keeps the last known switches; with none known every automation stays ON.
  .catch(()=>cache||{}).finally(()=>{loading=null;});
 return loading;
}

export async function automationOn(key){
 if(!key)return true;
 return (await current())[key]?.enabled!==false;
}
export const automationOnForEventKey=async eventKey=>automationOn(automationForEventKey(eventKey));
export const automationOnForPurpose=async purpose=>automationOn(automationForPurpose(purpose));

export async function writeAutomationSwitch(db,{key,enabled,changedBy=''}){
 const switches=await readAutomationSwitches(db);
 switches[key]={enabled:Boolean(enabled),changedBy:String(changedBy||'').slice(0,120),changedAt:new Date().toISOString()};
 await db.query(`INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2::jsonb,NOW())
  ON CONFLICT(setting_key) DO UPDATE SET setting_value=app_settings.setting_value||EXCLUDED.setting_value,updated_at=NOW()`,
  [AUTOMATION_SWITCHES_SETTING_KEY,JSON.stringify({[key]:switches[key]})]);
 if(db===pool){cache={...(cache||{}),[key]:switches[key]};loadedAt=Date.now();}
 return switches;
}

export function switchedOffError(code){
 const error=new Error('Switched off in the Automation Centre.');
 error.code=code;error.status=409;error.automationSwitchedOff=true;
 return error;
}
