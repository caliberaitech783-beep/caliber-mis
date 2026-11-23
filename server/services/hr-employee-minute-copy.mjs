// Employee Master copied from HR Pulse every minute (owner, 23 Nov 2026: "Pulse HR is now the final authority for
// employee master ... any data entered in Pulse HR should be auto synchronized on minute to minute basis").
//
// Every minute Pulse-II asks HR Pulse one small question, "what changed after number N?", and applies only those
// people (shared/hr-employee-changes.mjs has the rules). When nothing changed, nothing is read from the database.
//  - It starts only after a person has looked at the whole Preview on Sync all masters and applied it.
//  - It stops by itself when one minute would switch off more than HR_COPY_STOP_LIMIT people, and waits for a
//    person to look at the Preview again. Nothing of that minute is applied.
//  - A change that could put a wrong person on a number is held; an administrator can accept a changed name.
//  - One server at a time runs it (a database lock), and the owner is told on Telegram when it stops, holds a
//    change, or has not been able to copy for HR_COPY_SILENT_MINUTES.
//  - Every night, from HR_MATCH_HOUR in India, both whole lists are matched once: whatever the minute copy missed
//    is corrected, and the result ("the same" or what was corrected) is kept for the screen and told on Telegram
//    when the lists were not the same. A site HR Pulse has no line for (Lalpeth) is left as it is.
import {planHrChanges,HR_CHANGE_EXISTING_FIELDS,HR_COPY_STOP_LIMIT,nameKey} from '../../shared/hr-employee-changes.mjs';
import {recordNumber,employeeNumber,hrSiteName} from '../../shared/hr-employee-master.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {applyEmployeeSiteMove,EMPLOYEE_SITE_MOVE_SCHEMA} from '../routes/employee-site-move.mjs';

export const HR_COPY_STATE_KEY='hr_employee_copy';
export const HR_COPY_INTERVAL_MS=60*1000;
export const HR_COPY_SILENT_MINUTES=10;
// While no server can reach HR Pulse (the key is missing), the people are told again this often.
export const HR_COPY_DISCONNECTED_REMIND_MINUTES=60;
export const HR_COPY_NOT_CONNECTED='Pulse-II is not connected to HR Pulse: the server setting HR_SYNC_KEY is missing. Nothing is being copied.';
// A Refresh at a card reads HR Pulse's whole list; several presses within this time share one read.
export const HR_REFRESH_KEEP_MS=20*1000;
// What is held for a number and changes nothing for it: the person at the card is sent to HR.
export const HR_REFRESH_BLOCKS=['bad-id','two-lines','no-name','other-name','old-person'];
// The nightly match of both whole lists: once a day, from 02:00 in India; after a failure it is tried again every 15 minutes.
export const HR_MATCH_HOUR=2;
export const HR_MATCH_RETRY_MINUTES=15;
const MAX_ROUNDS=5,HELD_LIMIT=200,CHUNK=500;
const SETTINGS_SCHEMA="CREATE TABLE IF NOT EXISTS app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";
const READ_SQL='SELECT setting_value FROM app_settings WHERE setting_key=$1';
const SAVE_SQL=`INSERT INTO app_settings (setting_key,setting_value,updated_at) VALUES ($1,$2::jsonb,NOW())
 ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()`;
// The number of an Employee ID in the database, read like employeeNumber() (CMPL123 = CMLL123 = 123).
const numberOf=field=>`NULLIF(substring(regexp_replace(upper(COALESCE(record_data->>'${field}','')),'[[:space:]/-]','','g') from '^(?:CMPL|CMLL)?0*([1-9][0-9]{0,8})$'),'')`;
// Only the fields the plan reads, and only the people asked for: never the whole master (about 44 MB).
export const EXISTING_FOR_SQL=`SELECT id,master_name,jsonb_build_object(${HR_CHANGE_EXISTING_FIELDS.map(field=>`'${field}',record_data->'${field}'`).join(',')}) AS record_data
 FROM master_records WHERE master_name IN('Employee master','ERP Employee master')
 AND COALESCE(${numberOf('caliberId')},${numberOf('employeeId')},${numberOf('caliberCode')})=ANY($1::text[]) ORDER BY id`;
// The people Pulse-II lists as on HR's list, with their site: the other half of the nightly match.
export const LISTED_SQL=`SELECT COALESCE(${numberOf('caliberId')},${numberOf('employeeId')},${numberOf('caliberCode')}) AS number,
 COALESCE(NULLIF(record_data->>'site',''),NULLIF(record_data->>'currentLocation',''),record_data->>'location','') AS site
 FROM master_records WHERE master_name IN('Employee master','ERP Employee master') AND COALESCE(record_data->>'hrListed','')<>'false'`;
const UPDATE_SQL=`UPDATE master_records m SET master_name='Employee master',
 record_data=m.record_data||v.d||jsonb_build_object('employeeMasterRevision',COALESCE((m.record_data->>'employeeMasterRevision')::bigint,0)+1)
 FROM jsonb_to_recordset($1::jsonb) AS v(id bigint,d jsonb) WHERE m.id=v.id`;
const INSERT_SQL="INSERT INTO master_records(master_name,record_data) SELECT 'Employee master',d FROM jsonb_array_elements($1::jsonb) AS d";
const OFF_SQL=`UPDATE master_records SET record_data=record_data||jsonb_build_object('hrListed',false,'hrLeft',false,'hrNotListedAt',$2::text,
 'employeeMasterRevision',COALESCE((record_data->>'employeeMasterRevision')::bigint,0)+1) WHERE id=ANY($1::bigint[])`;

const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=value=>value===null||value===undefined?'':String(value).trim();
const count=value=>Number(value||0).toLocaleString('en-IN');
export const istDate=at=>new Date(at+5.5*60*60*1000).toISOString().slice(0,10);
export const istHour=at=>new Date(at+5.5*60*60*1000).getUTCHours();
// Is the nightly match due? Once per India day, from HR_MATCH_HOUR, and not within HR_MATCH_RETRY_MINUTES of a try that
// failed. Not on the day the copy was started or started again: a person has just looked at the whole Preview.
export const matchDue=(state,at)=>state?.started===true&&!state.stopped&&istHour(at)>=HR_MATCH_HOUR&&state.lastMatch?.day!==istDate(at)
 &&istDate(Date.parse(state.resumedAt||state.startedAt||0))!==istDate(at)
 &&!(state.matchTriedAt&&at-Date.parse(state.matchTriedAt)<HR_MATCH_RETRY_MINUTES*60*1000);
const istClock=at=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));

// live: is this the live server (server/services/health-report.mjs, isLiveSlot)? Only it tells that its key is missing.
export function createHrEmployeeMinuteCopy({pool,hr,now=()=>Date.now(),alert=async()=>{},live=true}){
 let schema=null,running=false,timer=null,first=null,matching=null,keyMissingSince=0;
 const ensure=()=>schema??=pool.query(SETTINGS_SCHEMA).then(()=>pool.query(EMPLOYEE_SITE_MOVE_SCHEMA)).catch(error=>{schema=null;throw error;});
 const iso=()=>new Date(now()).toISOString();
 const readState=async()=>{await ensure();return (await pool.query(READ_SQL,[HR_COPY_STATE_KEY])).rows[0]?.setting_value||{};};
 const saveState=async patch=>{const state={...await readState(),...patch};await pool.query(SAVE_SQL,[HR_COPY_STATE_KEY,JSON.stringify(state)]);return state;};
 const tell=async(key,message)=>{try{await alert(message,key);}catch{/* an alert that cannot be sent never stops the copy */}};

 // Plans and writes the changes of these people in one transaction. decide(plan) may refuse (the stop).
 async function copyPeople(numbers,lines,{accepted={},decide=()=>''}={}){
  const wanted=[...new Set(numbers.map(value=>employeeNumber(value)).filter(Boolean))],asked=new Set(wanted);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   // The same lock as every other writer of Employee Master (HR's Excel, an approved site move).
   await client.query('SELECT pg_advisory_xact_lock(709224109)');
   const existing=(await client.query(EXISTING_FOR_SQL,[wanted])).rows.filter(row=>asked.has(recordNumber(row.record_data)));
   const at=iso(),plan=planHrChanges(existing,wanted,lines,{now:at,accepted});
   const refusal=decide(plan);
   if(refusal){await client.query('ROLLBACK');return {plan,refusal,notMoved:[]};}
   for(let from=0;from<plan.updates.length;from+=CHUNK)await client.query(UPDATE_SQL,[JSON.stringify(plan.updates.slice(from,from+CHUNK).map(row=>({id:row.id,d:row.patch})))]);
   for(let from=0;from<plan.inserts.length;from+=CHUNK)await client.query(INSERT_SQL,[JSON.stringify(plan.inserts.slice(from,from+CHUNK))]);
   if(plan.offIds.length)await client.query(OFF_SQL,[plan.offIds,at]);
   // Another site in HR Pulse: a dated move from today, kept in the site history and on the register of moves.
   const notMoved=[];
   for(const move of plan.moves){
    await client.query('SAVEPOINT hr_copy_move');
    try{await applyEmployeeSiteMove(client,{employeeId:move.id,to:move.to,fromDate:istDate(now()),requestedBy:'hr-master',requestedName:'HR Pulse Employee Master',approvedBy:['HR Pulse'],card:{hrMaster:true},at});}
    catch(error){if(!error.status)throw error;await client.query('ROLLBACK TO SAVEPOINT hr_copy_move');notMoved.push({number:move.number,employeeId:move.employeeId,name:move.name,reason:'site-not-moved',detail:`The site could not be moved to ${move.to}: ${error.message}`});}
   }
   await client.query('COMMIT');
   return {plan,refusal:'',notMoved};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
 }

 // The held list after a copy: the people looked at are replaced by what is held for them now.
 const heldAfter=(before,looked,nowHeld,at)=>{
  const kept=(Array.isArray(before)?before:[]).filter(item=>!looked.includes(item.number));
  const since=new Map((Array.isArray(before)?before:[]).map(item=>[item.number+'|'+item.reason,item.since]));
  return [...kept,...nowHeld.map(item=>({...item,since:since.get(item.number+'|'+item.reason)||at}))].slice(-HELD_LIMIT);
 };

 // This server has no key for HR Pulse (the Azure setting HR_SYNC_KEY), so it can copy nothing.
 // On 23 Nov 2026 a release moved that key off the live server: the copy stood still for 22 minutes, Refresh at a
 // card could not ask HR Pulse, and nobody was told, because a server without the key simply skipped its minute.
 // Only the live server speaks (the test slot is never told about), and it speaks for itself: once it has been
 // without the key for HR_COPY_SILENT_MINUTES the release approvers are told on Telegram, and again every
 // HR_COPY_DISCONNECTED_REMIND_MINUTES while it lasts. The other slot may still be copying Employee Master at that
 // moment; Refresh at a card is answered by the live server, so it is told all the same, and the message says which.
 // It never touches lastRunAt, which would make a server that has the key skip its own minute.
 async function notConnected(){
  if(hr.configured()){keyMissingSince=0;return {skipped:'connected'};}
  if(!live)return {skipped:'not connected'};
  if(!keyMissingSince)keyMissingSince=now();
  if(now()-keyMissingSince<HR_COPY_SILENT_MINUTES*60*1000)return {skipped:'not connected'};
  const state=await readState();
  // Before the copy from HR Pulse was ever started there is no connection to lose.
  if(!state.started)return {skipped:'not connected'};
  const told=Date.parse(state.disconnected?.toldAt);
  if(Number.isFinite(told)&&now()-told<HR_COPY_DISCONNECTED_REMIND_MINUTES*60*1000)return {skipped:'not connected'};
  const toldAt=iso(),copied=Date.parse(state.lastOkAt),copying=Number.isFinite(copied)&&now()-copied<HR_COPY_SILENT_MINUTES*60*1000;
  await saveState({disconnected:{since:new Date(keyMissingSince).toISOString(),toldAt},...(copying?{}:{error:HR_COPY_NOT_CONNECTED})});
  await tell(`hr-employee-copy:not-connected:${toldAt.slice(0,16)}`,`⛔ The live server of Pulse-II has not been connected to HR Pulse since ${istClock(keyMissingSince)} IST. Refresh at a card cannot ask HR Pulse${copying?'. Employee Master is still being copied by the other server':', and Employee Master changes and transfers are not coming'}.\nCause: the server setting HR_SYNC_KEY is missing on the live server. It must be saved on both slots and kept with each slot (Azure, App Service settings).`);
  return {skipped:'not connected',told:true};
 }
 // The live server copied again: a later loss of the key is a new one, told afresh.
 const connectedAgain=state=>live&&state.disconnected?{disconnected:null}:{};

 async function tick(){
  if(running)return {skipped:'running'};
  if(!hr.configured())return {skipped:'not connected'};
  keyMissingSince=0;
  let state=await readState();
  if(!state.started)return {skipped:'not started'};
  if(state.stopped)return {skipped:'stopped'};
  running=true;
  // One server at a time: the others see the lock taken and leave this minute to it.
  const guard=await pool.connect();let locked=false;
  try{
   locked=(await guard.query('SELECT pg_try_advisory_lock(709224112) AS ok')).rows[0]?.ok!==false;
   if(!locked)return {skipped:'another server'};
   state=await readState();
   if(state.lastRunAt&&now()-Date.parse(state.lastRunAt)<HR_COPY_INTERVAL_MS-15000)return {skipped:'recent'};
   const at=iso();
   // Once a night both whole lists are matched, before this minute's changes.
   if(matchDue(state,now())){await match({by:'Nightly match'}).catch(()=>{});state=await readState();if(state.stopped)return {skipped:'stopped'};}
   let after=text(state.seq)||'0',latest=after,feed,rounds=0;
   const numbers=new Set(),lines=[];
   do{
    feed=await hr.changes(after);
    if(feed.ready===false){await saveState({lastRunAt:at,error:"HR Pulse's change list is not ready yet. The nightly match of both lists still runs."});return {ok:false,notReady:true};}
    for(const number of feed.numbers||[])numbers.add(String(number));
    lines.push(...(feed.employees||[]));
    latest=text(feed.latest)||after;after=latest;rounds++;
   }while(feed.more&&rounds<MAX_ROUNDS);
   if(!numbers.size){await saveState({lastRunAt:at,lastOkAt:at,seq:latest,error:'',failingSince:null,failureTold:false,...connectedAgain(state)});return {ok:true,changed:0};}
   const {plan,refusal,notMoved}=await copyPeople([...numbers],lines,{accepted:state.accepted||{},
    decide:made=>made.summary.switchedOff>HR_COPY_STOP_LIMIT?`This minute's changes from HR Pulse would switch off ${count(made.summary.switchedOff)} people (removed ${count(made.summary.removed)}, marked LEFT ${count(made.summary.left)}). Nothing was applied. Open Preview on Sync all masters, check and apply.`:''});
   if(refusal){
    await saveState({lastRunAt:at,stopped:{at,reason:refusal,switchedOff:plan.summary.switchedOff},error:''});
    await tell(`hr-employee-copy:stopped:${at}`,`⛔ Pulse-II stopped the Employee Master copy from HR Pulse at ${istClock(at)} IST.\n${refusal}`);
    return {ok:false,stopped:true,summary:plan.summary};
   }
   const nowHeld=[...plan.held,...notMoved],before=Array.isArray(state.held)?state.held:[];
   const held=heldAfter(before,[...numbers].map(value=>employeeNumber(value)),nowHeld,at);
   const fresh=nowHeld.filter(item=>!before.some(old=>old.number===item.number&&old.reason===item.reason));
   const wrote=plan.updates.length+plan.inserts.length+plan.offIds.length+plan.moves.length>0;
   await saveState({lastRunAt:at,lastOkAt:at,seq:latest,held,error:'',failingSince:null,failureTold:false,...connectedAgain(state),...(wrote?{lastChangeAt:at,lastSummary:plan.summary}:{})});
   if(fresh.length)await tell(`hr-employee-copy:held:${at}`,`⚠️ Employee Master copy from HR Pulse: ${count(fresh.length)} change${fresh.length===1?' is':'s are'} held for a person to look at (Sync all masters).\n${fresh.slice(0,5).map(item=>`${item.employeeId} ${item.name}: ${item.detail}`).join('\n')}`);
   return {ok:true,changed:numbers.size,summary:plan.summary,held:nowHeld.length};
  }catch(error){
   const at=iso(),since=state.failingSince||at,message=error?.status?error.message:'The copy from HR Pulse failed. Existing data retained.';
   const silent=now()-Date.parse(since)>=HR_COPY_SILENT_MINUTES*60*1000;
   await saveState({lastRunAt:at,error:message,failingSince:since,...(silent&&!state.failureTold?{failureTold:true}:{})}).catch(()=>{});
   if(silent&&!state.failureTold)await tell(`hr-employee-copy:silent:${since}`,`⚠️ Pulse-II has not been able to copy Employee Master from HR Pulse since ${istClock(since)} IST.\n${message}`);
   return {ok:false,error:message};
  }finally{
   if(locked)await guard.query('SELECT pg_advisory_unlock(709224112)').catch(()=>{});
   guard.release();running=false;
  }
 }

 // Both whole lists matched: HR Pulse's people, and the people Pulse-II lists at the sites HR Pulse covers. What the
 // minute copy missed is corrected by the same rules. `force`: a person asked for it now.
 async function match({by='',force=false}={}){
  if(!hr.configured())throw fail(503,'HR connection is not set up (HR_SYNC_KEY).');
  const state=await readState();
  if(!state.started)throw fail(409,'Employee Master is not being copied yet. Open Preview on its line and apply it first.');
  if(state.stopped)throw fail(409,'The copy is stopped. Open Preview on the Employee Master line, check and apply.');
  if(matching)return matching;
  return matching=(async()=>{
   const at=iso(),day=istDate(now());
   try{
    const lines=(await hr.employees()).employees||[];
    if(!lines.length)throw fail(502,'HR Pulse returned no Employee Master. Nothing was changed.');
    const covered=new Set(lines.map(line=>canonicalSiteName(hrSiteName(line.site))).filter(Boolean));
    const numbers=new Set(lines.map(line=>employeeNumber(line.employeeId)).filter(Boolean)),hrPeople=numbers.size;
    let listedHere=0;
    // A site of ours that HR Pulse has no line for is not covered by it: its people are left as they are.
    for(const row of (await pool.query(LISTED_SQL)).rows){if(row.number&&covered.has(canonicalSiteName(text(row.site)))){listedHere++;numbers.add(String(row.number));}}
    const {plan,refusal,notMoved}=await copyPeople([...numbers],lines,{accepted:state.accepted||{},
     decide:made=>made.summary.switchedOff>HR_COPY_STOP_LIMIT?`The match of both lists would switch off ${count(made.summary.switchedOff)} people (removed ${count(made.summary.removed)}, marked LEFT ${count(made.summary.left)}). Nothing was applied. Open Preview on Sync all masters, check and apply.`:''});
    if(refusal){
     await saveState({matchTriedAt:at,stopped:{at,reason:refusal,switchedOff:plan.summary.switchedOff},lastMatch:{at,day,by:text(by).slice(0,120),stopped:true,hrLines:lines.length,hrPeople,listedHere}});
     await tell(`hr-employee-copy:stopped:${at}`,`⛔ Pulse-II stopped the Employee Master copy from HR Pulse at ${istClock(at)} IST.\n${refusal}`);
     return {ok:false,stopped:true,summary:plan.summary};
    }
    const nowHeld=[...plan.held,...notMoved],held=heldAfter(state.held,[...numbers],nowHeld,at),s=plan.summary;
    const corrected=s.added+s.updated+s.removed+s.left+s.moved,same=corrected===0;
    const lastMatch={at,day,by:text(by).slice(0,120),same,hrLines:lines.length,hrPeople,listedHere,summary:s,held:nowHeld.length};
    await saveState({matchTriedAt:at,lastMatch,held,...(same?{}:{lastChangeAt:at,lastSummary:s})});
    if(!same&&!force)await tell(`hr-employee-copy:match:${day}`,`⚠️ Employee Master, nightly match with HR Pulse (${day}): the two lists were not the same. Corrected in Pulse-II: ${count(s.added)} added, ${count(s.updated)} updated, ${count(s.removed)} removed, ${count(s.left)} marked LEFT, ${count(s.moved)} moved. Held for a person: ${count(nowHeld.length)}.`);
    return {ok:true,...lastMatch};
   }catch(error){
    await saveState({matchTriedAt:at,matchError:error?.status?error.message:'The match with HR Pulse failed. Existing data retained.'}).catch(()=>{});
    throw error;
   }
  })().finally(()=>{matching=null;});
 }

 // A person has looked at the whole Preview and applied it: the minute copy starts, or starts again after a stop.
 const start=async({by=''}={})=>{const at=iso(),state=await readState();return saveState({started:true,startedAt:state.startedAt||at,startedBy:state.startedBy||text(by).slice(0,120),stopped:null,resumedAt:state.stopped?at:state.resumedAt||null,error:'',failingSince:null,failureTold:false});};

 // An administrator has looked at a changed name and accepts it: that person is copied now, from HR Pulse's list.
 async function accept(number,{by=''}={}){
  const wanted=employeeNumber(number);
  if(!wanted)throw fail(400,'Choose a held change.');
  const state=await readState(),item=(state.held||[]).find(entry=>entry.number===wanted);
  if(!item)throw fail(404,'This change is no longer held.');
  if(!['other-name','old-person'].includes(item.reason))throw fail(409,'This one is corrected in HR Pulse; it cannot be accepted here.');
  const lines=((await hr.employees()).employees||[]).filter(line=>employeeNumber(line.employeeId)===wanted);
  if(lines.length!==1)throw fail(409,lines.length?`CMLL${wanted} is on ${lines.length} lines in HR Pulse. It has to be corrected there.`:`HR Pulse no longer holds CMLL${wanted}.`);
  const accepted={...(state.accepted||{}),[wanted]:nameKey(lines[0].name)};
  const {plan,notMoved}=await copyPeople([wanted],lines,{accepted});
  const at=iso(),held=heldAfter(state.held,[wanted],[...plan.held,...notMoved],at);
  await saveState({accepted,held,lastChangeAt:at,acceptedBy:text(by).slice(0,120)});
  return {accepted:true,name:text(lines[0].name),stillHeld:held.some(entry=>entry.number===wanted)};
 }

 // One person now, asked for at a card (owner, 23 Nov 2026: "ID not found. Please contact your HR team. And there one
 // refresh button should be there. If [it] is added and then the refresh button is done and it is showing from HR
 // Pulse, then it should allow to move further"). The rules are the minute copy's own, for that number alone, on HR
 // Pulse's list as it is at this moment: the person at the card does not wait for the minute, and Refresh works
 // before the minute copy has been started or while it is stopped (the stop is about many people at once).
 // A number HR Pulse does not hold changes nothing here: a Refresh never switches anyone off.
 let list=null;
 const hrLines=()=>{
  if(!list||now()-list.at>=HR_REFRESH_KEEP_MS){
   const mine={at:now(),lines:hr.employees().then(data=>Array.isArray(data?.employees)?data.employees:[])};
   mine.lines.catch(()=>{if(list===mine)list=null;});
   list=mine;
  }
  return list.lines;
 };
 async function person(number,{by=''}={}){
  const wanted=employeeNumber(number);
  if(!wanted)throw fail(400,'Enter a valid Employee ID or Caliber ID.');
  if(!hr.configured())throw fail(503,'HR Pulse is not connected to Pulse-II yet, so it could not be asked.');
  const lines=(await hrLines()).filter(line=>employeeNumber(line.employeeId)===wanted);
  if(!lines.length)return {found:false,changed:false,blocked:null};
  const state=await readState();
  const {plan,notMoved}=await copyPeople([wanted],lines,{accepted:state.accepted||{}});
  const at=iso(),nowHeld=[...plan.held,...notMoved],before=Array.isArray(state.held)?state.held:[];
  const changed=plan.updates.length+plan.inserts.length+plan.offIds.length+plan.moves.length>0;
  // What is held shows on Sync all masters, as after a minute's copy; nothing is written when nothing is new.
  if(changed||nowHeld.length||before.some(item=>item.number===wanted))await saveState({held:heldAfter(before,[wanted],nowHeld,at),...(changed?{lastChangeAt:at,lastRefreshBy:text(by).slice(0,120)}:{})});
  return {found:true,changed,added:plan.inserts.length>0,blocked:nowHeld.find(item=>HR_REFRESH_BLOCKS.includes(item.reason))||null,held:nowHeld};
 }

 const status=async()=>{
  const state=await readState();
  return {started:state.started===true,startedAt:state.startedAt||null,lastRunAt:state.lastRunAt||null,lastOkAt:state.lastOkAt||null,lastChangeAt:state.lastChangeAt||null,lastSummary:state.lastSummary||null,
   held:Array.isArray(state.held)?state.held:[],stopped:state.stopped||null,error:text(state.error),stopLimit:HR_COPY_STOP_LIMIT,everySeconds:HR_COPY_INTERVAL_MS/1000,connected:hr.configured(),
   lastMatch:state.lastMatch||null,matchHour:HR_MATCH_HOUR};
 };
 const run=()=>void tick().catch(error=>console.error('Employee Master copy from HR Pulse failed',error?.message));
 return {tick,start,accept,person,match,notConnected,status,
  startTimer({firstDelayMs=90*1000}={}){if(timer||first)return;first=setTimeout(()=>{first=null;run();timer=setInterval(run,HR_COPY_INTERVAL_MS);timer.unref?.();},firstDelayMs);first.unref?.();},
  stopTimer(){clearTimeout(first);clearInterval(timer);first=null;timer=null;}};
}
