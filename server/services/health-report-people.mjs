// People who get the A25 speed report besides the owner (owner, 16 Nov 2026: "PULSE USER" sheet, "add this in
// automation"). The list lives in app_settings, not in this public code: each entry is a Pulse-II login or a mobile
// number, matched like A01's people (resolveRecipients). Telegram cannot write to a number by itself, so each person
// must once press Connect my Telegram on the Telegram Integration page; the Automation Centre shows who has.
import {resolveRecipients} from '../routes/equipment-pulse-mismatch.mjs';
import {ownerTelegramLogins} from './release-otp-delivery.mjs';

export const HEALTH_REPORT_PEOPLE_KEY='health_report_people';
const MAX_PEOPLE=30;
const loginOf=value=>String(value??'').trim().toLowerCase();

export function normalizeHealthReportPeople(input={}){
 const raw=Array.isArray(input.people)?input.people:String(input.people??'').split(/[,;\n]+/);
 const seen=new Map();
 for(const entry of raw.map(item=>String(item??'').trim().replace(/\s+/g,' ').slice(0,60)).filter(Boolean))if(!seen.has(entry.toLowerCase()))seen.set(entry.toLowerCase(),entry);
 const people=[...seen.values()].slice(0,MAX_PEOPLE);
 return {people};
}
export async function readHealthReportPeople(pool){
 try{return normalizeHealthReportPeople((await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[HEALTH_REPORT_PEOPLE_KEY])).rows[0]?.setting_value||{});}
 catch{return normalizeHealthReportPeople({});}
}
export async function writeHealthReportPeople(pool,input){
 const settings=normalizeHealthReportPeople(input);
 await pool.query('INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()',
  [HEALTH_REPORT_PEOPLE_KEY,JSON.stringify(settings)]);
 return settings;
}
// Every login that gets the report: the owner's logins and the logins of the saved people.
export async function healthReportLogins(pool){
 const [owner,{people}]=await Promise.all([ownerTelegramLogins(pool).catch(()=>[]),readHealthReportPeople(pool)]);
 const extra=people.length?(await resolveRecipients(pool,people)).logins:[];
 return [...new Set([...owner,...extra].map(loginOf).filter(Boolean))];
}
// For the settings tab: each saved person, the login(s) found for them and whether they have connected Telegram.
export async function healthReportPeopleCheck(pool,settings){
 const {people}=settings||await readHealthReportPeople(pool);
 const resolved=people.length?(await resolveRecipients(pool,people)).people:[];
 const linked=new Set((await pool.query('SELECT login_name FROM mis_telegram_links').catch(()=>({rows:[]}))).rows.map(row=>loginOf(row.login_name)));
 const owner=await ownerTelegramLogins(pool).catch(()=>[]);
 return {
  owner:owner.map(login=>({login,telegramLinked:linked.has(login)})),
  people:resolved.map(person=>{
   const ready=person.logins.some(name=>linked.has(name));
   return {entry:person.entry,logins:person.logins,telegramLinked:ready,
    note:!person.logins.length?'No Pulse-II user has this mobile number. Add it to the Users & employees record, or enter the login.'
     :(person.mobile?'Pulse-II login '+person.logins.join(', ')+'. ':'')+(ready?'Telegram connected.':'Telegram not connected yet: press Connect my Telegram on the Telegram Integration page.')};
  }),
 };
}
