// Fetch from Pulse-II with OTP: the one way a worker's site changes (shared/employee-site-moves.mjs).
//
// A card for one site carries a driver or operator of another site. The person at the card asks for the move;
// a six-digit OTP goes to the Project Manager of the site the worker is leaving (the same rule as a vehicle
// transfer: the site that releases approves). On the OTP the worker's site changes from the card's date, the
// site is locked, and one line goes into the register of moves that HR reads.
import {randomUUID} from 'node:crypto';
import {logBookSiteScope,requireLogBookSite,employeeAtLocation,employeeOnHrList} from '../../shared/log-book-access.mjs';
import {employeeIdentity,employeeReferenceVariants} from '../../shared/employee-identity.mjs';
import {displaySiteName} from '../../shared/region-scope.mjs';
import {employeeSiteOn,planSiteMove,isBookDate} from '../../shared/employee-site-moves.mjs';
import {hrSiteName} from '../../shared/hr-employee-master.mjs';
import {employeeDesignation,employeeLeft} from '../../shared/caliber-id-check.mjs';
import {generateOtp,hashOtp,otpExpiresAt,checkOtpAttempt,resendTooSoon,otpFail,OTP_TTL_MINUTES} from '../../shared/otp-approval.mjs';
import {EMPLOYEE_FIND_SQL,fetchedEmployee} from './erp-employee-source.mjs';

export const EMPLOYEE_SITE_MOVE_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_employee_site_move_otps(
  id UUID PRIMARY KEY,employee_id BIGINT NOT NULL,employee_ref TEXT NOT NULL,employee_name TEXT NOT NULL DEFAULT '',
  from_site TEXT NOT NULL,to_site TEXT NOT NULL,from_date TEXT NOT NULL,card JSONB NOT NULL DEFAULT '{}',
  requested_by TEXT NOT NULL,requested_name TEXT NOT NULL DEFAULT '',requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_to TEXT[] NOT NULL,channels TEXT[] NOT NULL DEFAULT '{}',otp_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','used','expired','cancelled')),used_at TIMESTAMPTZ);
 CREATE INDEX IF NOT EXISTS mis_employee_site_move_live_otp ON mis_employee_site_move_otps(employee_id) WHERE status='sent';
 CREATE TABLE IF NOT EXISTS mis_employee_site_moves(
  id BIGSERIAL PRIMARY KEY,employee_id BIGINT NOT NULL,employee_ref TEXT NOT NULL,employee_name TEXT NOT NULL DEFAULT '',designation TEXT NOT NULL DEFAULT '',
  from_site TEXT NOT NULL,to_site TEXT NOT NULL,from_date TEXT NOT NULL,requested_by TEXT NOT NULL,requested_name TEXT NOT NULL DEFAULT '',
  approved_by TEXT[] NOT NULL,approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),card JSONB NOT NULL DEFAULT '{}',otp_id UUID);
 CREATE INDEX IF NOT EXISTS mis_employee_site_moves_recent ON mis_employee_site_moves(approved_at DESC);`;

const text=value=>String(value??'').trim();
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
const formatDate=value=>{const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:String(value||'')};
const siteName=site=>displaySiteName(site)||text(site);
// What the card says about itself, kept with the OTP and the register line. Nothing here is trusted for a check.
const cardOf=input=>Object.fromEntries(['batchId','cardId','door','cardNo','book'].map(key=>[key,text(input?.[key]).slice(0,80)]).filter(([,value])=>value));

export function siteMoveMessage({employeeId,name,designation,from,to,fromDate,requestedBy,door,otp}){
 return [
  'Caliber Pulse: site change of a driver / operator',
  `${employeeId} ${name}${designation?' ('+designation+')':''} is on a card at ${siteName(to)} but belongs to ${siteName(from)}.`,
  `Move: ${siteName(from)} -> ${siteName(to)}, from ${formatDate(fromDate)} (the card's date)${door?', vehicle / machine '+door:''}.`,
  `Requested by ${requestedBy}.`,
  `OTP ${otp}, valid ${OTP_TTL_MINUTES} minutes. Share it only if this person has moved to ${siteName(to)}.`,
  'On the OTP the site changes for salary and every record, and it does not change back by itself.',
 ].join('\n');
}

const UPDATE_EMPLOYEE_SQL="UPDATE master_records SET record_data=record_data||$2::jsonb||jsonb_build_object('employeeMasterRevision',COALESCE((record_data->>'employeeMasterRevision')::bigint,0)+1,'updatedAt',$3::text) WHERE id=$1 AND master_name='Employee master' RETURNING id,record_data";
const INSERT_MOVE_SQL='INSERT INTO mis_employee_site_moves(employee_id,employee_ref,employee_name,designation,from_site,to_site,from_date,requested_by,requested_name,approved_by,approved_at,card,otp_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13) RETURNING id';
const INSERT_OTP_SQL='INSERT INTO mis_employee_site_move_otps(id,employee_id,employee_ref,employee_name,from_site,to_site,from_date,card,requested_by,requested_name,sent_to,channels,otp_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14) RETURNING *';
const LIVE_OTP_SQL="SELECT * FROM mis_employee_site_move_otps WHERE employee_id=$1 AND to_site=$2 AND from_date=$3 AND status='sent' ORDER BY requested_at DESC LIMIT 1";
const REGISTER_SQL='SELECT id,employee_ref,employee_name,designation,from_site,to_site,from_date,requested_by,requested_name,approved_by,approved_at,card FROM mis_employee_site_moves ORDER BY approved_at DESC,id DESC LIMIT 5000';

// Moves the worker inside the caller's transaction. Returns the updated employee row and the move, or the row
// alone when the worker already belongs to that site on that date (nothing is written then).
export async function applyEmployeeSiteMove(client,{employeeId,to,fromDate,requestedBy,requestedName='',approvedBy=[],card={},otpId=null,at=new Date().toISOString()}){
 const row=(await client.query("SELECT id,record_data FROM master_records WHERE id=$1 AND master_name='Employee master' FOR UPDATE",[employeeId])).rows[0];
 if(!row)otpFail('This employee is no longer in Employee Master.',404);
 const plan=planSiteMove(row.record_data,{to,fromDate,at,by:requestedBy,approvedBy,card});
 if(!plan)return {row,move:null};
 const identity=employeeIdentity(row.record_data);
 const updated=(await client.query(UPDATE_EMPLOYEE_SQL,[row.id,JSON.stringify(plan.patch),at])).rows[0];
 const registerId=(await client.query(INSERT_MOVE_SQL,[row.id,identity.employeeId,text(row.record_data.name||row.record_data.employee),employeeDesignation(row.record_data),plan.move.from,plan.move.to,fromDate,text(requestedBy),text(requestedName),approvedBy,at,JSON.stringify(card||{}),otpId])).rows[0].id;
 return {row:updated,move:{...plan.move,id:String(registerId),latest:plan.latest}};
}

export function registerEmployeeSiteMoves(app,{pool,requireSession,requireAdministrator,getSiteScope=async session=>logBookSiteScope(session),pmLogins,deliver}){
 let schema=null;
 const ensureSchema=()=>schema??=pool.query(EMPLOYEE_SITE_MOVE_SCHEMA).catch(error=>{schema=null;throw error;});
 const transaction=async fn=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}};
 const wrap=fn=>async(req,res,next)=>{try{await ensureSchema();res.set('Cache-Control','no-store');await fn(req,res)}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}};
 const login=req=>text(req.session?.login||req.session?.name).toLowerCase();
 const publicOtp=row=>({id:row.id,expiresAt:row.expires_at,sentTo:row.sent_to,channels:row.channels,attempts:row.attempts,status:row.status});
 const protect=[requireSession,requireAdministrator];

 // Ask for the OTP. Nothing about the worker changes here.
 app.post('/api/log-books/employee-site-move',...protect,wrap(async(req,res)=>{
  if(typeof pmLogins!=='function'||typeof deliver!=='function')otpFail('OTP delivery is not set up on this server.',503);
  const scope=await getSiteScope(req.session),location=text(req.body?.location),bookDate=text(req.body?.bookDate);
  if(!hrSiteName(location))otpFail('Choose the site of the card.');
  requireLogBookSite(scope,location);
  if(!isBookDate(bookDate))otpFail('The card date is needed to move a worker to another site.');
  const reference=text(req.body?.caliberId).toUpperCase();
  if(!/^[A-Z0-9-]{1,40}$/.test(reference))otpFail('Enter a valid Employee ID or Caliber ID.');
  const listed=(await pool.query(EMPLOYEE_FIND_SQL,[employeeReferenceVariants(reference)])).rows.filter(row=>employeeOnHrList(row.record_data));
  if(!listed.length)otpFail("No employee on HR's list has this number. Check the card.",404);
  if(listed.length>1)otpFail('More than one employee has this number. Check Employee Master.',409);
  const row=listed[0],record=row.record_data,identity=employeeIdentity(record),name=text(record.name||record.employee),to=siteName(location);
  if(employeeLeft(record))otpFail('Employee Master says this person has left. Check the number on the card.',409);
  if(employeeAtLocation(record,location,bookDate))otpFail(`${name} already belongs to ${to} on this date. Press Fetch again.`,409);
  const from=employeeSiteOn(record,bookDate);
  if(!from)otpFail('This person has no site in Employee Master yet. Give the site on Employee Master first.',409);
  const live=(await pool.query(LIVE_OTP_SQL,[row.id,to,bookDate])).rows[0];
  if(live&&resendTooSoon(live.requested_at))otpFail('An OTP was sent less than a minute ago. Wait before asking again.',429);
  const logins=await pmLogins(pool,from);
  if(!logins.length)otpFail(`No Project Manager is assigned to ${siteName(from)}, so the OTP cannot be sent. Ask HR to correct the site in HR's master Excel.`,409);
  const id=randomUUID(),otp=generateOtp(),card=cardOf(req.body?.card),requestedName=text(req.session?.name||req.session?.login);
  const message=siteMoveMessage({employeeId:identity.employeeId,name,designation:employeeDesignation(record),from,to,fromDate:bookDate,requestedBy:requestedName||login(req),door:card.door,otp});
  const delivery=await deliver({logins,message,otp,eventKey:`employee-move-otp:${id}`});
  if(!delivery.sentTo.length)otpFail(`The Project Manager of ${siteName(from)} has no Telegram or mobile registered. ${(delivery.failures||[]).join(' ')}`.trim(),409);
  if(live)await pool.query("UPDATE mis_employee_site_move_otps SET status='cancelled' WHERE id=$1 AND status='sent'",[live.id]);
  const saved=(await pool.query(INSERT_OTP_SQL,[id,row.id,identity.employeeId,name,siteName(from),to,bookDate,JSON.stringify(card),login(req),requestedName,delivery.sentTo,delivery.channels,hashOtp(id,otp),otpExpiresAt()])).rows[0];
  req.audit={eventType:'Master data',module:'Employee master',action:'Ask for site move OTP',targetType:'Employee',targetReference:identity.employeeId,details:{from:siteName(from),to,fromDate:bookDate,sentTo:delivery.sentTo,channels:delivery.channels,card}};
  res.status(201).json({otp:publicOtp(saved),move:{employeeId:identity.employeeId,name,designation:employeeDesignation(record),from:siteName(from),to,fromDate:bookDate}});
 }));

 // Enter the OTP. A wrong code is counted and kept (the count is saved before the answer goes out).
 app.post('/api/log-books/employee-site-move/:otpId/verify',...protect,wrap(async(req,res)=>{
  if(!uuid(req.params.otpId))otpFail('Invalid OTP reference.');
  const scope=await getSiteScope(req.session);
  const result=await transaction(async client=>{
   const row=(await client.query('SELECT * FROM mis_employee_site_move_otps WHERE id=$1 FOR UPDATE',[req.params.otpId])).rows[0];
   if(row)requireLogBookSite(scope,row.to_site);
   const check=checkOtpAttempt(row,req.body?.otp);
   if(!check.ok){
    if(row&&check.status!=='missing'&&(check.status!==row.status||(check.attempts??row.attempts)!==row.attempts))await client.query('UPDATE mis_employee_site_move_otps SET status=$2,attempts=$3 WHERE id=$1',[row.id,check.status,check.attempts??row.attempts]);
    return {refused:check.message};
   }
   const outcome=await applyEmployeeSiteMove(client,{employeeId:row.employee_id,to:row.to_site,fromDate:row.from_date,requestedBy:row.requested_by,requestedName:row.requested_name,approvedBy:row.sent_to,card:row.card||{},otpId:row.id});
   await client.query("UPDATE mis_employee_site_move_otps SET status='used',used_at=NOW() WHERE id=$1",[row.id]);
   return {row,outcome};
  });
  if(result.refused)otpFail(result.refused,400);
  const {row,outcome}=result;
  req.audit={eventType:'Master data',module:'Employee master',action:'Move employee to another site by OTP',targetType:'Employee',targetReference:row.employee_ref,
   changedFields:outcome.move?[{field:'Site',before:outcome.move.from,after:outcome.move.to}]:[],details:{from:row.from_site,to:row.to_site,fromDate:row.from_date,approvedBy:row.sent_to,requestedBy:row.requested_by,card:row.card||{},alreadyThere:!outcome.move}};
  res.json({...fetchedEmployee(outcome.row),moved:outcome.move?{from:outcome.move.from,to:outcome.move.to,fromDate:outcome.move.fromDate,latest:outcome.move.latest}:null});
 }));

 // The register of moves for HR.
 app.get('/api/employee-master/site-moves',...protect,wrap(async(req,res)=>{
  const {rows}=await pool.query(REGISTER_SQL);
  res.json({moves:rows.map(row=>({id:String(row.id),employeeId:row.employee_ref,name:row.employee_name,designation:row.designation,from:row.from_site,to:row.to_site,fromDate:row.from_date,requestedBy:row.requested_name||row.requested_by,approvedBy:row.approved_by||[],approvedAt:row.approved_at,card:row.card||{}}))});
 }));
}
