// VTC Master and OD Master (owner, 28 Nov 2026; rule shared/attendance-masters.mjs, screen src/attendance-masters.jsx).
//
//  GET    /api/attendance-masters?kind=vtc|od&month=YYYY-MM   the records of the month at the sites of the login
//  GET    /api/attendance-masters/people?site=…              the drivers and operators of a site, for the form
//  POST   /api/attendance-masters                            one record per ticked person (all saved or none)
//  PUT    /api/attendance-masters/:id                        change dates or details of one record
//  DELETE /api/attendance-masters/:id                        remove one record, with a reason
//  …/api/integrations/hr/vtc                                  VTC approved in HR Pulse (see registerAttendanceMasters)
//
// Every record writes its arrived days (From to the earlier of To and today, India) into mis_shift_attendance as VTC
// Training or OD, in TRAINING_SHIFT, marked with master_id, so attendance and the HR feed count them with no change of
// their own. A day still to come is written on its own date by the timer below (every five minutes, on every server: the
// insert is idempotent). A day the Directors locked refuses the write (SQLSTATE CA423, answered 423); unlock it first.
// A record replaces a Present — 0 trips or a VTC Training of Shift A that day, as VTC Training does; it never replaces
// another record's day, because two records of one person may not share a day.
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {siteAllowed,requireLogBookSite,employeeAtLocation,logBookSiteScope} from '../../shared/log-book-access.mjs';
import {displaySiteName,REGION_DATA} from '../../shared/region-scope.mjs';
import {drivesOrOperates,employeeDesignation,employeeLeft} from '../../shared/caliber-id-check.mjs';
import {employeeIdentity} from '../../shared/employee-identity.mjs';
import {employeeNumber} from '../../shared/hr-employee-master.mjs';
import {hrSiteKey} from './hr-attendance-access.mjs';
import {SHIFT_ATTENDANCE_SCHEMA} from './shift-attendance.mjs';
import {TRAINING_SHIFT,indiaToday} from '../../shared/vtc-training.mjs';
import {MASTER_KINDS,MASTER_MAX_PEOPLE,checkMasterEntry,masterRemarks,arrivedDays,monthRange,monthView,masterStatus,siteSummary,overlaps} from '../../shared/attendance-masters.mjs';

export const ATTENDANCE_MASTERS_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_attendance_masters(
  id BIGSERIAL PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('vtc','od')),site TEXT NOT NULL,employee_id BIGINT NOT NULL,
  caliber_code TEXT NOT NULL DEFAULT '',employee_name TEXT NOT NULL DEFAULT '',designation TEXT NOT NULL DEFAULT '',
  book_kind TEXT NOT NULL DEFAULT 'vehicle',from_date DATE NOT NULL,to_date DATE NOT NULL,details JSONB NOT NULL DEFAULT '{}'::jsonb,
  remarks TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL,created_name TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,updated_name TEXT,updated_at TIMESTAMPTZ,deleted_by TEXT,deleted_name TEXT,deleted_at TIMESTAMPTZ,delete_reason TEXT);
 CREATE INDEX IF NOT EXISTS mis_attendance_masters_live ON mis_attendance_masters(from_date,to_date) WHERE deleted_at IS NULL;
 CREATE INDEX IF NOT EXISTS mis_attendance_masters_person ON mis_attendance_masters(employee_id) WHERE deleted_at IS NULL;
 ALTER TABLE mis_attendance_masters ADD COLUMN IF NOT EXISTS hr_request TEXT;
 CREATE UNIQUE INDEX IF NOT EXISTS mis_attendance_masters_hr_request ON mis_attendance_masters(hr_request) WHERE deleted_at IS NULL AND hr_request IS NOT NULL;`;
// mis_shift_attendance is busy: its master_id column is added only when it is missing, waiting at most 5 s for the lock.
const COLUMN_SQL="SELECT 1 FROM information_schema.columns WHERE table_name='mis_shift_attendance' AND column_name='master_id'";
const ADD_COLUMN_SQL='ALTER TABLE mis_shift_attendance ADD COLUMN IF NOT EXISTS master_id BIGINT';

const EMPLOYEE_LISTS=['Employee master','ERP Employee master','C-Dir Employee master','Users & employees'];
const LIST_ORDER=new Map(EMPLOYEE_LISTS.map((name,at)=>[name,at]));
const text=value=>String(value??'').trim();
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const idOk=value=>/^[1-9]\d{0,17}$/.test(String(value??''));
// The number of a master line (CMPL123 = CMLL123 = 123): the first ID field that holds one, as in hr-attendance-change.
const numberOf=field=>`NULLIF(substring(regexp_replace(upper(COALESCE(record_data->>'${field}','')),'[[:space:]/-]','','g') from '^(?:CMPL|CMLL)?0*([1-9][0-9]{0,8})$'),'')`;
const RECORD_NUMBER=`COALESCE(${numberOf('caliberId')},${numberOf('employeeId')},${numberOf('caliberCode')})`;
const isDriverText=designation=>/DRIVER/i.test(String(designation||''));
const personOf=(row)=>{const e=row.record_data||{},who=employeeIdentity(e);
 return {id:String(row.id),list:row.master_name,caliberCode:who.caliberCode||who.employeeId,name:text(e.employee||e.employeeName||e.name),designation:employeeDesignation(e),record:e};};
const recordOut=(row,today)=>{
 const record={id:String(row.id),kind:row.kind,site:displaySiteName(row.site)||row.site,siteKey:canonicalSiteName(row.site),employeeId:String(row.employee_id),
  caliberCode:row.caliber_code,name:row.employee_name,designation:row.designation,role:row.book_kind==='equipment'?'Operator':'Driver',
  from:row.from,to:row.to,details:row.details||{},createdBy:row.created_name||row.created_by,createdAt:row.created_at,updatedBy:row.updated_name||row.updated_by||'',updatedAt:row.updated_at||null};
 return {...record,status:masterStatus(record,today)};
};
const SELECT_COLUMNS=`id,kind,site,employee_id,caliber_code,employee_name,designation,book_kind,from_date::text AS "from",to_date::text AS "to",details,created_by,created_name,created_at,updated_by,updated_name,updated_at`;

// The arrived days of a record into attendance. Only a day that is free, a Present — 0 trips / VTC Training of the
// shift, or this record's own day is written; a day whose entry already says the same is left alone (so a locked day
// is never touched by an unchanged save).
const WRITE_DAYS_SQL=`INSERT INTO mis_shift_attendance (book_date,site,shift,employee_id,asset_id,kind,reason,remarks,recorded_by,master_id)
 SELECT d::date,$2,$3,$4,NULL,$5,$6,$7,$8,$9 FROM unnest($1::date[]) AS d
 ON CONFLICT (book_date,site,shift,employee_id) DO UPDATE SET asset_id=NULL,kind=EXCLUDED.kind,reason=EXCLUDED.reason,remarks=EXCLUDED.remarks,
  recorded_by=EXCLUDED.recorded_by,master_id=EXCLUDED.master_id
 WHERE (mis_shift_attendance.master_id IS NULL OR mis_shift_attendance.master_id=EXCLUDED.master_id)
  AND (mis_shift_attendance.master_id IS DISTINCT FROM EXCLUDED.master_id OR mis_shift_attendance.reason<>EXCLUDED.reason
   OR mis_shift_attendance.remarks<>EXCLUDED.remarks OR mis_shift_attendance.kind<>EXCLUDED.kind OR mis_shift_attendance.asset_id IS NOT NULL)`;
// A record's own days that are no longer its days (dates or site changed, or the record removed). A day that a
// Present — 0 trips or a card entry took over since keeps that entry: only the record's own reason is removed.
const DROP_DAYS_SQL=`DELETE FROM mis_shift_attendance WHERE master_id=$1 AND reason=$2 AND NOT (site=$3 AND book_date=ANY($4::date[]))`;
// The timer: every arrived day of the live records of the last three days that has no entry yet.
const FILL_DAYS_SQL=`INSERT INTO mis_shift_attendance (book_date,site,shift,employee_id,asset_id,kind,reason,remarks,recorded_by,master_id)
 SELECT d::date,m.site,$2,m.employee_id,NULL,m.book_kind,CASE m.kind WHEN 'vtc' THEN $3 ELSE $4 END,m.remarks,m.created_by,m.id
 FROM mis_attendance_masters m CROSS JOIN LATERAL generate_series(GREATEST(m.from_date,$1::date-2),LEAST(m.to_date,$1::date),interval '1 day') AS d
 WHERE m.deleted_at IS NULL AND m.from_date<=$1::date AND m.to_date>=$1::date-2
 ON CONFLICT (book_date,site,shift,employee_id) DO NOTHING`;

export function registerAttendanceMasters(app,{pool,requireSession,requireAdministrator,getSiteScope=async session=>logBookSiteScope(session),today=()=>indiaToday(),timerMs=5*60_000,requireHr=null}){
 let schema=null;
 const ensureSchema=()=>schema??=(async()=>{
  await pool.query(SHIFT_ATTENDANCE_SCHEMA+ATTENDANCE_MASTERS_SCHEMA);
  if(!(await pool.query(COLUMN_SQL)).rows.length){
   const client=await pool.connect();
   try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");await client.query(ADD_COLUMN_SQL);await client.query('COMMIT');}
   catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
   finally{client.release();}
  }
 })().catch(error=>{schema=null;throw error;});
 const transaction=async fn=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}};
 const wrap=fn=>async(req,res,next)=>{try{await ensureSchema();res.set('Cache-Control','no-store');req.logBookScope=await getSiteScope(req.session);await fn(req,res)}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}};
 const protect=[requireSession,requireAdministrator];
 const login=req=>text(req.session?.login||req.session?.name).toLowerCase(),nameOf=req=>text(req.session?.name||req.session?.login);
 const kindOf=value=>MASTER_KINDS[value]?value:fail('Choose VTC or OD.');
 const mySites=scope=>REGION_DATA.flatMap(region=>region.sites).filter(site=>siteAllowed(scope,site));

 // The people of the employee lists: one line per person (Employee master first), drivers and operators only.
 const readPeople=async(client,ids=null)=>{
  const {rows}=await client.query(`SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[])${ids?' AND id=ANY($2::bigint[])':''}`,ids?[EMPLOYEE_LISTS,ids]:[EMPLOYEE_LISTS]);
  return rows.sort((a,b)=>(LIST_ORDER.get(a.master_name)??9)-(LIST_ORDER.get(b.master_name)??9)).map(personOf);
 };

 app.get('/api/attendance-masters',...protect,wrap(async(req,res)=>{
  const kind=kindOf(req.query.kind),now=today(),month=monthRange(req.query.month)?req.query.month:now.slice(0,7),range=monthRange(month);
  // Opening the page writes the days that arrived too, so the muster never waits for the timer.
  await fill();
  const {rows}=await pool.query(`SELECT ${SELECT_COLUMNS} FROM mis_attendance_masters WHERE deleted_at IS NULL AND kind=$1 AND from_date<=$3::date AND to_date>=$2::date ORDER BY site,employee_name,from_date,id`,[kind,range.from,range.to]);
  const records=rows.filter(row=>siteAllowed(req.logBookScope,row.site)).map(row=>{const record=recordOut(row,now);return {...record,month:monthView(record,month,now)};});
  const summary=siteSummary(records,month,{today:now,isDriver:record=>record.role==='Driver'});
  res.json({kind,month,today:now,records,...summary,sites:summary.sites,siteOptions:mySites(req.logBookScope)});
 }));

 app.get('/api/attendance-masters/people',...protect,wrap(async(req,res)=>{
  const site=canonicalSiteName(req.query.site);
  if(!site)fail('Choose a site.');
  requireLogBookSite(req.logBookScope,req.query.site);
  const seen=new Set(),people=[];
  for(const person of await readPeople(pool)){
   if(!employeeAtLocation(person.record,site)||employeeLeft(person.record)||!drivesOrOperates(person.record))continue;
   const key=person.caliberCode||person.id;if(seen.has(key))continue;seen.add(key);
   people.push({id:person.id,caliberCode:person.caliberCode,name:person.name,designation:person.designation,role:isDriverText(person.designation)?'Driver':'Operator'});
  }
  res.json({site:displaySiteName(req.query.site)||req.query.site,people:people.sort((a,b)=>a.name.localeCompare(b.name))});
 }));

 // The checks every save makes: the site is the login's, each person is a driver or operator of the site, and no
 // other record of that person shares a day.
 const checkPeople=async(client,req,{site,ids,from,to,except=null})=>{
  requireLogBookSite(req.logBookScope,site);
  const siteKey=canonicalSiteName(site);
  const people=await readPeople(client,ids),chosen=new Map();
  for(const id of ids){
   const person=people.find(p=>p.id===id);
   if(!person||!employeeAtLocation(person.record,siteKey)||employeeLeft(person.record)||!drivesOrOperates(person.record))continue;
   chosen.set(id,person);
  }
  const refused=ids.filter(id=>!chosen.has(id));
  if(refused.length)fail(refused.length===1&&ids.length===1?'Choose a driver or operator of this site.':`${refused.length} of the chosen people are not drivers or operators of this site. Nothing was saved; remove them and save again.`);
  const {rows}=await client.query(`SELECT id,kind,employee_id,employee_name,from_date::text AS "from",to_date::text AS "to" FROM mis_attendance_masters
   WHERE deleted_at IS NULL AND employee_id=ANY($1::bigint[]) AND from_date<=$3::date AND to_date>=$2::date AND ($4::bigint IS NULL OR id<>$4)`,[ids,from,to,except]);
  const clash=rows.find(row=>overlaps(row,{from,to}));
  if(clash)fail(`${clash.employee_name||'This person'} already has ${MASTER_KINDS[clash.kind].short} from ${clash.from} to ${clash.to}. Two entries of one person cannot share a day.`,409);
  return {siteKey,chosen};
 };
 const writeDays=async(client,row,by)=>{
  const days=arrivedDays({from:row.from,to:row.to},today());
  await client.query(DROP_DAYS_SQL,[row.id,MASTER_KINDS[row.kind].reason,row.site,days]);
  if(days.length)await client.query(WRITE_DAYS_SQL,[days,row.site,TRAINING_SHIFT,row.employee_id,row.book_kind,MASTER_KINDS[row.kind].reason,row.remarks,by,row.id]);
  return days.length;
 };

 app.post('/api/attendance-masters',...protect,wrap(async(req,res)=>{
  const kind=kindOf(req.body?.kind),entry=checkMasterEntry(kind,req.body||{},{today:today()});
  if(entry.error)fail(entry.error);
  const ids=[...new Set((Array.isArray(req.body?.employeeIds)?req.body.employeeIds:[]).map(String))];
  if(!ids.length||!ids.every(idOk))fail('Tick at least one driver or operator.');
  if(ids.length>MASTER_MAX_PEOPLE)fail(`Tick up to ${MASTER_MAX_PEOPLE} people at a time.`);
  if(typeof req.body?.site!=='string'||!canonicalSiteName(req.body.site))fail('Choose a site.');
  const saved=await transaction(async client=>{
   // One save at a time, so two saves of one person cannot both pass the day check.
   await client.query("SELECT pg_advisory_xact_lock(hashtext('mis-attendance-masters'))");
   const {siteKey,chosen}=await checkPeople(client,req,{site:req.body.site,ids,from:entry.from,to:entry.to});
   const remarks=masterRemarks(kind,entry.details),out=[];let days=0;
   for(const id of ids){
    const person=chosen.get(id);
    const {rows:[row]}=await client.query(`INSERT INTO mis_attendance_masters(kind,site,employee_id,caliber_code,employee_name,designation,book_kind,from_date,to_date,details,remarks,created_by,created_name)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${SELECT_COLUMNS},remarks`,
     [kind,siteKey,id,person.caliberCode,person.name,person.designation,isDriverText(person.designation)?'vehicle':'equipment',entry.from,entry.to,JSON.stringify(entry.details),remarks,login(req),nameOf(req)]);
    days+=await writeDays(client,row,login(req));out.push(recordOut(row,today()));
   }
   return {records:out,days};
  });
  res.json({saved:saved.records.length,presentDays:saved.days,records:saved.records});
 }));

 const readOne=async(client,id)=>{
  if(!idOk(id))fail('Record not found.',404);
  const {rows:[row]}=await client.query(`SELECT ${SELECT_COLUMNS},remarks FROM mis_attendance_masters WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,[id]);
  return row||fail('Record not found. It may have been removed.',404);
 };

 app.put('/api/attendance-masters/:id',...protect,wrap(async(req,res)=>{
  const record=await transaction(async client=>{
   await client.query("SELECT pg_advisory_xact_lock(hashtext('mis-attendance-masters'))");
   const old=await readOne(client,req.params.id);
   requireLogBookSite(req.logBookScope,old.site);
   const entry=checkMasterEntry(old.kind,req.body||{},{today:today()});
   if(entry.error)fail(entry.error);
   await checkPeople(client,req,{site:old.site,ids:[String(old.employee_id)],from:entry.from,to:entry.to,except:old.id});
   const {rows:[row]}=await client.query(`UPDATE mis_attendance_masters SET from_date=$2,to_date=$3,details=$4,remarks=$5,updated_by=$6,updated_name=$7,updated_at=NOW()
    WHERE id=$1 RETURNING ${SELECT_COLUMNS},remarks`,[old.id,entry.from,entry.to,JSON.stringify(entry.details),masterRemarks(old.kind,entry.details),login(req),nameOf(req)]);
   await writeDays(client,row,login(req));
   return recordOut(row,today());
  });
  res.json({record});
 }));

 app.delete('/api/attendance-masters/:id',...protect,wrap(async(req,res)=>{
  const reason=text(req.body?.reason??req.query?.reason);
  if(reason.length<5)fail('Write why this entry is removed.');
  await transaction(async client=>{
   const old=await readOne(client,req.params.id);
   requireLogBookSite(req.logBookScope,old.site);
   await client.query(DROP_DAYS_SQL,[old.id,MASTER_KINDS[old.kind].reason,'',[]]);
   await client.query('UPDATE mis_attendance_masters SET deleted_at=NOW(),deleted_by=$2,deleted_name=$3,delete_reason=$4 WHERE id=$1',[old.id,login(req),nameOf(req),reason.slice(0,1000)]);
  });
  res.json({removed:true});
 }));

 // VTC from HR Pulse (owner, 28 Nov 2026: "create the vtc here as new tab", with Form + approvals like OD). HR Pulse
 // keeps the request and its approvals (VTC Form / VTC approvals on Leave / OD / Gatepass); when the last approver
 // approves, HR Pulse puts it here, so the record lives in this VTC Master and its days are present like any other.
 // HR Pulse calls with the user's Pulse HR grant (requireHr: sets req.logBookScope and req.securitySession):
 //   GET  /api/integrations/hr/vtc?month=YYYY-MM          the VTC records of the month at the user's sites
 //   POST /api/integrations/hr/vtc/check                  {site,employee,fromDate,toDate,…}: would it be taken? (before approval)
 //   PUT  /api/integrations/hr/vtc                        {request,site,employee,fromDate,toDate,course,…}: the approved request
 //   POST /api/integrations/hr/vtc/remove                 {request,reason}: a request cancelled after approval
 // request is HR Pulse's request number: one record per request, so a repeated PUT changes it and never doubles it.
 // employee is the Caliber ID or its number (CMPL8812 = CMLL8812 = 8812), found in Employee Master.
 if(requireHr){
  const hrWrap=fn=>async(req,res,next)=>{try{await ensureSchema();res.set('Cache-Control','no-store');await fn(req,res)}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}};
  const hrActor=req=>{const p=req.securitySession||{},id=text(p.login||p.username||p.email||p.userId||p.id).slice(0,120);return {by:'hr:'+id.toLowerCase(),name:text(p.name||p.displayName||id).slice(0,80)};};
  const hrSite=value=>hrSiteKey(value)||fail('Choose a site of Pulse-II.');
  const hrRequest=value=>{const code=text(value);return code&&code.length<=80?code:fail('The HR Pulse request number is missing.');};
  // The Employee Master line of the number: exactly one, or the request waits for HR Pulse's master to be put right.
  const personByNumber=async(client,value)=>{
   const number=employeeNumber(value);
   if(!number)fail('Give the Caliber ID of the driver or operator.');
   const {rows}=await client.query(`SELECT id::text AS id FROM master_records WHERE master_name='Employee master' AND ${RECORD_NUMBER}=$1 ORDER BY id`,[number]);
   if(!rows.length)fail(`No employee with the number ${number} is in Employee Master.`,404);
   if(rows.length>1)fail(`${rows.length} lines of Employee Master hold the number ${number}. Correct that in HR Pulse first.`,409);
   return rows[0].id;
  };
  const hrEntry=body=>{const entry=checkMasterEntry('vtc',body||{},{today:today()});if(entry.error)fail(entry.error);return entry;};
  const outOf=row=>{const record=recordOut(row,today());return {...record,request:row.hr_request||''};};

  app.get('/api/integrations/hr/vtc',requireHr,hrWrap(async(req,res)=>{
   const now=today(),month=monthRange(req.query.month)?req.query.month:now.slice(0,7),range=monthRange(month);
   await fill();
   const {rows}=await pool.query(`SELECT ${SELECT_COLUMNS},hr_request FROM mis_attendance_masters WHERE deleted_at IS NULL AND kind='vtc' AND from_date<=$2::date AND to_date>=$1::date ORDER BY site,employee_name,from_date,id`,[range.from,range.to]);
   res.json({month,today:now,records:rows.filter(row=>siteAllowed(req.logBookScope,row.site)).map(row=>{const record=outOf(row);return {...record,month:monthView(record,month,now)};})});
  }));
  app.post('/api/integrations/hr/vtc/check',requireHr,hrWrap(async(req,res)=>{
   const entry=hrEntry(req.body),site=hrSite(req.body?.site);
   const request=text(req.body?.request);
   await transaction(async client=>{
    const id=await personByNumber(client,req.body?.employee);
    const own=request?(await client.query('SELECT id FROM mis_attendance_masters WHERE hr_request=$1 AND deleted_at IS NULL',[request])).rows[0]?.id:null;
    await checkPeople(client,req,{site,ids:[id],from:entry.from,to:entry.to,except:own||null});
   });
   res.json({ok:true});
  }));
  app.put('/api/integrations/hr/vtc',requireHr,hrWrap(async(req,res)=>{
   const entry=hrEntry(req.body),site=hrSite(req.body?.site),request=hrRequest(req.body?.request),who=hrActor(req);
   req.audit={eventType:'Approval',module:'VTC from HR Pulse',action:'Approved VTC request put in VTC Master',targetType:'VTC',targetReference:request.slice(0,160),details:{hrUser:who.by}};
   const record=await transaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext('mis-attendance-masters'))");
    const id=await personByNumber(client,req.body?.employee);
    const old=(await client.query(`SELECT ${SELECT_COLUMNS},remarks,hr_request FROM mis_attendance_masters WHERE hr_request=$1 AND deleted_at IS NULL FOR UPDATE`,[request])).rows[0];
    if(old&&String(old.employee_id)!==id)fail(`Request ${request} is already in VTC Master for ${old.employee_name}. Cancel it in HR Pulse and raise a new one.`,409);
    const {siteKey,chosen}=await checkPeople(client,req,{site,ids:[id],from:entry.from,to:entry.to,except:old?.id||null});
    const person=chosen.get(id),remarks=masterRemarks('vtc',entry.details)+' · HR Pulse '+request;
    const {rows:[row]}=old
     ?await client.query(`UPDATE mis_attendance_masters SET site=$2,from_date=$3,to_date=$4,details=$5,remarks=$6,updated_by=$7,updated_name=$8,updated_at=NOW() WHERE id=$1 RETURNING ${SELECT_COLUMNS},remarks,hr_request`,
       [old.id,siteKey,entry.from,entry.to,JSON.stringify(entry.details),remarks,who.by,who.name])
     :await client.query(`INSERT INTO mis_attendance_masters(kind,site,employee_id,caliber_code,employee_name,designation,book_kind,from_date,to_date,details,remarks,created_by,created_name,hr_request)
       VALUES('vtc',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${SELECT_COLUMNS},remarks,hr_request`,
       [siteKey,id,person.caliberCode,person.name,person.designation,isDriverText(person.designation)?'vehicle':'equipment',entry.from,entry.to,JSON.stringify(entry.details),remarks,who.by,who.name,request]);
    const days=await writeDays(client,row,who.by);
    return {...outOf(row),presentDays:days};
   });
   res.json({record,changed:Boolean(record.updatedAt)});
  }));
  app.post('/api/integrations/hr/vtc/remove',requireHr,hrWrap(async(req,res)=>{
   const request=hrRequest(req.body?.request),reason=text(req.body?.reason),who=hrActor(req);
   if(reason.length<5)fail('Write why the VTC is cancelled.');
   const removed=await transaction(async client=>{
    const old=(await client.query(`SELECT ${SELECT_COLUMNS} FROM mis_attendance_masters WHERE hr_request=$1 AND deleted_at IS NULL FOR UPDATE`,[request])).rows[0];
    if(!old)return false;
    requireLogBookSite(req.logBookScope,old.site);
    await client.query(DROP_DAYS_SQL,[old.id,MASTER_KINDS.vtc.reason,'',[]]);
    await client.query('UPDATE mis_attendance_masters SET deleted_at=NOW(),deleted_by=$2,deleted_name=$3,delete_reason=$4 WHERE id=$1',[old.id,who.by,who.name,('HR Pulse: '+reason).slice(0,1000)]);
    return true;
   });
   res.json({removed});
  }));
 }

 // The days that arrive: written within five minutes of midnight (India), at start and when the page is opened.
 // timerMs 0 (scheduled jobs off, tests) leaves only the page and the saves to write them.
 const fill=async()=>{
  try{await ensureSchema();await pool.query(FILL_DAYS_SQL,[today(),TRAINING_SHIFT,MASTER_KINDS.vtc.reason,MASTER_KINDS.od.reason]);}
  catch(error){console.warn('[attendance-masters] arriving days not written:',error?.message||error);}
 };
 let timer=null;
 if(timerMs>0){setTimeout(()=>void fill(),20_000).unref?.();timer=setInterval(()=>void fill(),timerMs);timer.unref?.();}
 return {fill,stop:()=>timer&&clearInterval(timer)};
}
