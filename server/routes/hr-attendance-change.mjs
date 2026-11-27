// A change HR Pulse makes to trip card attendance is made here, with an OTP (owner, 27 Nov 2026).
// Rules: shared/hr-attendance-change.mjs. HR Pulse calls these with the user's Pulse HR grant (requireHrAttendance):
//   POST /api/integrations/hr/attendance/change         {site,date,shift,employeeId,mark,reason} → the OTP goes to RHR;
//   POST /api/integrations/hr/attendance/change/verify  {id,otp} → the change is made in Pulse-II;
//   GET  /api/integrations/hr/attendance/changes?from=&to=  the changes of the dates (made, and waiting for an OTP).
// mark: present (a Present entry, kind 'hr', in mis_shift_attendance), absent (the card stays, only its attendance is not
// counted) or card (an earlier HR change is taken back). One person, site, date and shift has one live change.
// The OTP goes to the RHR of the site's region (Level 3 on Masters › Attendance approval): six digits, 10 minutes, single
// use, five wrong attempts, one request a minute. A day the Directors locked is not changed; it is unlocked first.
import {randomUUID} from 'node:crypto';
import {generateOtp,hashOtp,otpExpiresAt,checkOtpAttempt,resendTooSoon,OTP_TTL_MINUTES} from '../../shared/otp-approval.mjs';
import {HR_PRESENT_KIND,HR_PRESENT_REASON,hrChangeInput,hrChangeOtpMessage,hrChangeDoneMessage,presentRemarks} from '../../shared/hr-attendance-change.mjs';
import {ATTENDANCE_LOCKED_SQLSTATE,approversFor,siteKey,siteLabel,siteRegion} from '../../shared/attendance-approval.mjs';
import {employeeNumber} from '../../shared/hr-employee-master.mjs';
import {siteAllowed} from '../../shared/log-book-access.mjs';

export const HR_ATTENDANCE_CHANGE_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_hr_attendance_changes(id UUID PRIMARY KEY,site_key TEXT NOT NULL,site TEXT NOT NULL,book_date DATE NOT NULL,shift TEXT NOT NULL,
  person TEXT NOT NULL,employee_id TEXT NOT NULL,employee_name TEXT,employee_record BIGINT,mark TEXT NOT NULL CHECK(mark IN ('present','absent','card')),reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,requested_name TEXT,sent_to TEXT[] NOT NULL,channels TEXT[] NOT NULL DEFAULT '{}',otp_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'sent',requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),used_at TIMESTAMPTZ,used_by TEXT,
  replaced_at TIMESTAMPTZ,replaced_by UUID);
 CREATE INDEX IF NOT EXISTS mis_hr_attendance_changes_day ON mis_hr_attendance_changes(book_date,site_key);
 CREATE INDEX IF NOT EXISTS mis_hr_attendance_changes_duty ON mis_hr_attendance_changes(site_key,book_date,shift,person,requested_at DESC);`;

const EMPLOYEE_LISTS=['Employee master','ERP Employee master','C-Dir Employee master','Users & employees'];
const fail=(status,message)=>Object.assign(new Error(message),{status});
const lower=value=>String(value||'').trim().toLowerCase();
const clean=(value,max)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,max);
const text=value=>String(value??'').trim();
// The number of a master line, read like recordNumber() (CMPL123 = CMLL123 = 123): the first ID field that holds one.
const numberOf=field=>`NULLIF(substring(regexp_replace(upper(COALESCE(record_data->>'${field}','')),'[[:space:]/-]','','g') from '^(?:CMPL|CMLL)?0*([1-9][0-9]{0,8})$'),'')`;
const RECORD_NUMBER=`COALESCE(${numberOf('caliberId')},${numberOf('employeeId')},${numberOf('caliberCode')})`;
// The live "absent" changes of the dates, as the report rules read them (hrAbsences).
const LIVE_ABSENT_SQL=`SELECT id::text AS id,site_key AS "siteKey",book_date::text AS date,shift,person,COALESCE(NULLIF(requested_name,''),requested_by) AS by,reason,used_at AS at
 FROM mis_hr_attendance_changes WHERE mark='absent' AND status='used' AND replaced_at IS NULL AND book_date BETWEEN $1::date AND $2::date ORDER BY book_date,site_key,shift,person`;
// Asked before a table that may not be there yet is read, so a failed read never spoils the caller's transaction.
const hasTable=async(db,name)=>Boolean((await db.query('SELECT to_regclass($1) IS NOT NULL AS has',[name])).rows[0]?.has);
// Read inside a report's own snapshot. A database that has no such table yet has no change.
export async function readHrAbsences(db,{from,to}){
 if(!await hasTable(db,'mis_hr_attendance_changes'))return [];
 return (await db.query(LIVE_ABSENT_SQL,[from,to])).rows.map(r=>({...r,at:r.at?new Date(r.at).toISOString():''}));
}

// approvers: () => the Attendance approval list ([{level,scope,login}]); the RHR of the site's region gets the OTP.
// deliverOtp: ({logins,message,otp,eventKey}) => {sentTo,channels,failures}. sendText: Telegram text to a chat.
export function createHrAttendanceChange({pool,approvers=async()=>[],deliverOtp=null,sendText=null,ensure=async()=>{},now=()=>Date.now(),today=undefined,log=console.error}){
 const iso=()=>new Date(now()).toISOString();
 const publicChange=row=>row&&{id:row.id,site:row.site,siteKey:row.site_key,date:row.date||String(row.book_date).slice(0,10),shift:row.shift,employeeId:row.employee_id,employeeName:row.employee_name||'',
  mark:row.mark,reason:row.reason,status:row.status,live:row.status==='used'&&!row.replaced_at&&row.mark!=='card',requestedBy:row.requested_name||row.requested_by,requestedAt:row.requested_at,
  sentTo:row.sent_to||[],channels:row.channels||[],expiresAt:row.expires_at,usedAt:row.used_at||null};
 const dutyArgs=change=>[change.siteKey,change.date,change.shift,change.person];
 const DUTY=`site_key=$1 AND book_date=$2::date AND shift=$3 AND person=$4`;

 // The Directors locked this site's day (server/routes/attendance-approval.mjs keeps its raw spellings).
 async function dayLocked(db,change){
  if(!await hasTable(db,'mis_attendance_locked_sites'))return false;
  const {rows}=await db.query(`SELECT site FROM mis_attendance_locked_sites WHERE book_date=$1::date`,[change.date]);
  return rows.some(r=>siteKey(r.site)===change.siteKey);
 }
 // The person in Employee Master (the authority), with every list line that holds the same number: a card may be
 // linked to the ERP, C-Dir or Users line of the person.
 async function personOf(db,change){
  const {rows}=await db.query(`SELECT id::text AS id,master_name,record_data->>'name' AS name,record_data->>'caliberId' AS caliber,record_data->>'employeeId' AS employee
   FROM master_records WHERE master_name=ANY($2::text[]) AND ${RECORD_NUMBER}=$1 ORDER BY id`,[change.person,EMPLOYEE_LISTS]);
  const own=rows.filter(r=>r.master_name==='Employee master');
  if(!own.length)throw fail(404,`No employee with the number ${change.person} is in Employee Master. Add the person in HR Pulse first.`);
  if(own.length>1)throw fail(409,`${own.length} lines of Employee Master hold the number ${change.person}. Correct that in HR Pulse first.`);
  return {record:own[0].id,name:text(own[0].name),employeeId:text(own[0].caliber||own[0].employee)||change.employee,ids:rows.map(r=>r.id)};
 }
 // What Pulse-II holds for the person at that site on that date: a card (any shift), the Present entries of the shift.
 async function held(db,change,person){
  const cards=(await db.query(`SELECT site,data->>'caliberId' AS caliber,data->>'employeeId' AS employee,data->'operatorSplit'->>'secondOperatorId' AS second,
    data->'operatorSplit'->>'secondOperatorCaliberId' AS second_caliber FROM mis_log_books
   WHERE deleted_at IS NULL AND book_type IN ('vehicle','equipment','lmv') AND book_date=$1::date`,[change.date])).rows;
  const mine=c=>siteKey(c.site)===change.siteKey&&([c.caliber,c.second_caliber].some(v=>employeeNumber(v)===change.person)||[c.employee,c.second].some(v=>v&&person.ids.includes(String(v))));
  const entries=(await db.query(`SELECT site,kind FROM mis_shift_attendance WHERE book_date=$1::date AND shift=$2 AND employee_id=ANY($3::bigint[])`,[change.date,change.shift,person.ids])).rows.filter(r=>siteKey(r.site)===change.siteKey);
  const live=(await db.query(`SELECT id,mark FROM mis_hr_attendance_changes WHERE ${DUTY} AND status='used' AND replaced_at IS NULL AND mark<>'card' ORDER BY used_at DESC LIMIT 1`,dutyArgs(change))).rows[0]||null;
  return {card:cards.some(mine),entry:entries.length>0,hrEntry:entries.some(r=>r.kind===HR_PRESENT_KIND),live};
 }
 function refuse(change,person,state){
  const who=`${person.name||person.employeeId} (${person.employeeId})`,when=`${siteLabel(change.site)} · ${change.date.slice(8,10)}-${change.date.slice(5,7)}-${change.date.slice(0,4)} · ${change.shift}`;
  if(change.mark==='absent'){
   if(state.live?.mark==='absent')throw fail(409,`${who} is already marked absent from HR Pulse · ${when}.`);
   if(!state.card&&!state.entry)throw fail(409,`Pulse-II holds no trip card and no Present entry of ${who} · ${when}. There is nothing to mark absent.`);
  }
  if(change.mark==='present'){
   if(state.live?.mark==='absent')throw fail(409,`${who} was marked absent from HR Pulse · ${when}. Choose "as the trip card says" to take that back.`);
   if(state.entry)throw fail(409,`${who} already has a Present entry in Pulse-II · ${when}.`);
  }
  if(change.mark==='card'&&!state.live&&!state.hrEntry)throw fail(409,`HR Pulse changed nothing for ${who} · ${when}. There is nothing to take back.`);
 }
 const lockedError=change=>fail(423,`Attendance of ${siteLabel(change.site)} on ${change.date.slice(8,10)}-${change.date.slice(5,7)}-${change.date.slice(0,4)} is locked after the Directors approved it. Ask RHR to unlock the day on Masters › Attendance approval first.`);

 // HR Pulse asks; the RHR of the region gets the OTP. Nothing changes yet.
 async function request({input,scope=null,actor,actorName}){
  const change=hrChangeInput(input,today?{today:today()}:{});
  if(!siteAllowed(scope,change.site))throw fail(403,'This site is outside your assigned access.');
  if(!deliverOtp)throw fail(503,'OTP delivery is not set up on this server.');
  await ensure();
  const person=await personOf(pool,change);
  if(await dayLocked(pool,change))throw lockedError(change);
  refuse(change,person,await held(pool,change,person));
  const label=siteLabel(change.site),rhr=approversFor(await approvers(),label,3);
  if(!rhr.length)throw fail(409,'No RHR is set for '+label+' on Masters › Attendance approval, so the OTP cannot be sent.');
  const waiting=(await pool.query(`SELECT id,requested_at FROM mis_hr_attendance_changes WHERE ${DUTY} AND status='sent' ORDER BY requested_at DESC LIMIT 1`,dutyArgs(change))).rows[0];
  if(waiting&&resendTooSoon(waiting.requested_at,{now:now()}))throw fail(429,'An OTP was sent to RHR less than a minute ago. Wait before asking again.');
  const id=randomUUID(),otp=generateOtp(),by=lower(actor)||'hr-pulse',requestedName=clean(actorName,80)||by;
  const message=hrChangeOtpMessage({site:label,region:siteRegion(label),date:change.date,shift:change.shift,employeeId:person.employeeId,employeeName:person.name,mark:change.mark,requestedBy:requestedName,reason:change.reason,otp,minutes:OTP_TTL_MINUTES});
  const delivery=await deliverOtp({logins:rhr,message,otp,eventKey:'hr-attendance-change-otp:'+id});
  if(!delivery?.sentTo?.length)throw fail(409,('RHR of '+label+' has no Telegram or mobile registered. '+(delivery?.failures||[]).join(' ')).trim());
  if(waiting)await pool.query("UPDATE mis_hr_attendance_changes SET status='cancelled' WHERE id=$1 AND status='sent'",[waiting.id]);
  const saved=(await pool.query(`INSERT INTO mis_hr_attendance_changes(id,site_key,site,book_date,shift,person,employee_id,employee_name,employee_record,mark,reason,requested_by,requested_name,sent_to,channels,otp_hash,expires_at,requested_at)
   VALUES($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *,book_date::text AS date`,
   [id,change.siteKey,label,change.date,change.shift,change.person,person.employeeId,person.name,person.record,change.mark,change.reason,by,requestedName,delivery.sentTo,delivery.channels||[],hashOtp(id,otp),otpExpiresAt(now()),iso()])).rows[0];
  return publicChange(saved);
 }

 // The OTP entered in HR Pulse. Right: the change is made in Pulse-II; wrong: counted, five at most.
 async function verify({id,otp,scope=null,actor}){
  if(!/^[0-9a-f-]{36}$/i.test(String(id||'')))throw fail(400,'Invalid OTP reference.');
  await ensure();
  const who=lower(actor)||'hr-pulse',at=iso();
  const client=await pool.connect();
  let row,done;
  try{
   await client.query('BEGIN');
   row=(await client.query('SELECT *,book_date::text AS date FROM mis_hr_attendance_changes WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(row&&!siteAllowed(scope,row.site)){await client.query('ROLLBACK');throw fail(403,'This site is outside your assigned access.');}
   const check=checkOtpAttempt(row,otp,{now:now()});
   if(!check.ok){
    if(row&&check.status!=='missing'&&(check.status!==row.status||(check.attempts??row.attempts)!==row.attempts))await client.query('UPDATE mis_hr_attendance_changes SET status=$2,attempts=$3 WHERE id=$1',[row.id,check.status,check.attempts??row.attempts]);
    await client.query('COMMIT');
    throw fail(check.status==='missing'?404:400,check.message);
   }
   const change={siteKey:row.site_key,site:row.site,date:row.date,shift:row.shift,person:row.person,mark:row.mark,reason:row.reason};
   if(await dayLocked(client,change)){await client.query("UPDATE mis_hr_attendance_changes SET status='cancelled' WHERE id=$1",[row.id]);await client.query('COMMIT');throw lockedError(change);}
   // One live change per duty: whatever HR Pulse set before is replaced by this one.
   await client.query(`UPDATE mis_hr_attendance_changes SET replaced_at=$5,replaced_by=$6 WHERE ${DUTY} AND status='used' AND replaced_at IS NULL`,[...dutyArgs(change),at,row.id]);
   const person=await personOf(client,change);
   // A Present entry HR Pulse made earlier goes with every new change; "present" writes it again below.
   await client.query(`DELETE FROM mis_shift_attendance WHERE book_date=$1::date AND shift=$2 AND kind=$3 AND employee_id=ANY($4::bigint[]) AND site=$5`,[change.date,change.shift,HR_PRESENT_KIND,person.ids,change.siteKey]);
   if(change.mark==='present'){
    const made=await client.query(`INSERT INTO mis_shift_attendance(book_date,site,shift,employee_id,asset_id,kind,reason,remarks,recorded_by)
     VALUES($1::date,$2,$3,$4::bigint,NULL,$5,$6,$7,$8) ON CONFLICT (book_date,site,shift,employee_id) DO NOTHING`,
     [change.date,change.siteKey,change.shift,person.record,HR_PRESENT_KIND,HR_PRESENT_REASON,presentRemarks({by:row.requested_name||row.requested_by,reason:row.reason,approvedBy:row.sent_to||[]}),'hr-pulse:'+who]);
    if(!made.rowCount){await client.query('ROLLBACK');throw fail(409,`${person.name||person.employeeId} already has a Present entry in Pulse-II for this shift. Nothing was changed; ask for a new OTP if a change is still needed.`);}
   }
   done=(await client.query("UPDATE mis_hr_attendance_changes SET status='used',used_at=$2,used_by=$3,attempts=$4 WHERE id=$1 RETURNING *,book_date::text AS date",[row.id,at,who,check.attempts])).rows[0];
   await client.query('COMMIT');
  }catch(error){
   await client.query('ROLLBACK').catch(()=>{});
   // The lock triggers of a day the Directors approved (a Present entry of that day).
   if(error?.code===ATTENDANCE_LOCKED_SQLSTATE)throw fail(423,error.message);
   throw error;
  }finally{client.release();}
  void tell([...(done.sent_to||[]),...approversFor(await approvers().catch(()=>[]),done.site,1)],hrChangeDoneMessage({site:done.site,date:done.date,shift:done.shift,employeeId:done.employee_id,employeeName:done.employee_name,
   mark:done.mark,requestedBy:done.requested_name||done.requested_by,reason:done.reason,approvedBy:done.sent_to||[]})).catch(error=>log('HR attendance change message failed:',error?.message));
  return publicChange(done);
 }
 async function tell(logins,message){
  const list=[...new Set(logins.map(lower).filter(Boolean))];
  if(!sendText||!list.length)return;
  const chats=(await pool.query('SELECT chat_id FROM mis_telegram_links WHERE lower(login_name)=ANY($1::text[])',[list])).rows;
  for(const chat of chats){try{await sendText(String(chat.chat_id),message,{});}catch{/* the next one is tried */}}
 }

 // The changes of the dates for HR Pulse's screen: made (live or since replaced) and those still waiting for an OTP.
 async function list({from,to,scope=null}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(from||''))||!/^\d{4}-\d{2}-\d{2}$/.test(String(to||''))||to<from)throw fail(400,'Choose the dates.');
  await ensure();
  const {rows}=await pool.query(`SELECT *,book_date::text AS date FROM mis_hr_attendance_changes WHERE book_date BETWEEN $1::date AND $2::date
   AND (status='used' OR (status='sent' AND expires_at>$3)) ORDER BY book_date,site_key,shift,person,requested_at LIMIT 5001`,[from,to,iso()]);
  return rows.filter(r=>siteAllowed(scope,r.site)).map(publicChange);
 }
 return {request,verify,list,absences:range=>readHrAbsences(pool,range)};
}

// requireHr: the Pulse HR grant check (requireHrAttendance()); it sets req.logBookScope and req.securitySession.
export function registerHrAttendanceChange(app,{changes,requireHr}){
 const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}};
 const actorOf=req=>{const p=req.securitySession||{},identity=p.login||p.username||p.email||p.userId||p.id;return {actor:clean(identity,120),actorName:clean(p.name||p.displayName||identity,80)};};
 app.post('/api/integrations/hr/attendance/change',requireHr,wrap(async(req,res)=>{
  const who=actorOf(req);
  req.audit={eventType:'Approval',module:'Attendance from HR Pulse',action:'Ask RHR for the attendance change OTP',targetType:'Duty',
   targetReference:clean([req.body?.site,req.body?.date,req.body?.shift,req.body?.employeeId].filter(Boolean).join(' '),160),details:{mark:clean(req.body?.mark,20),reason:clean(req.body?.reason,500),hrUser:who.actor}};
  res.status(201).json(await changes.request({input:req.body,scope:req.logBookScope,...who}));
 }));
 app.post('/api/integrations/hr/attendance/change/verify',requireHr,wrap(async(req,res)=>{
  const who=actorOf(req);
  req.audit={eventType:'Approval',module:'Attendance from HR Pulse',action:'Attendance changed from HR Pulse with OTP',targetType:'Duty',targetReference:clean(req.body?.id,60),details:{hrUser:who.actor}};
  const done=await changes.verify({id:req.body?.id,otp:req.body?.otp,scope:req.logBookScope,actor:who.actor});
  req.audit.targetReference=clean([done.site,done.date,done.shift,done.employeeId].join(' '),160);req.audit.details={...req.audit.details,mark:done.mark,reason:done.reason,otpFrom:done.sentTo};
  res.json(done);
 }));
 app.get('/api/integrations/hr/attendance/changes',requireHr,wrap(async(req,res)=>{
  res.json({changes:await changes.list({from:req.query.from,to:req.query.to,scope:req.logBookScope})});
 }));
}
