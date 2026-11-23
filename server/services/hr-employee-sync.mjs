// Employee Master and Employee Transfer, copied from HR (hrpulse.cmll.in) (owner, 23 Nov 2026).
// Owner, later the same day: HR Pulse is the final authority for Employee Master and Pulse-II copies every change
// within a minute. That replaces his morning order "do not sync Employee Master, sync only Employee Transfer".
// The whole-list copy below is what a person looks at (Preview) and applies once on Sync all masters; after that
// server/services/hr-employee-minute-copy.mjs takes the changes every minute.
//
// HR serves both, read only, at /api/integrations/mis/employees and /transfers (caliber-hr repo,
// server/mis-employee-sync.mjs). Pulse-II signs in with HR_SYNC_KEY, the same value as HR's MIS_SYNC_KEY.
//
// Employee Master: HR's lines go through exactly the rules of HR's master Excel (shared/hr-employee-master.mjs):
// a person is found by the number of the Employee ID, takes HR's name, department, designation, category and status,
// a person HR marks LEFT or who is not on HR's list stays but is never matched on a card, and nothing is deleted.
// A line HR holds that cannot be placed (no usable ID, a number on two lines, a site that is not ours) is left out
// and its people are left as they are. The site Pulse-II holds is kept, as on a later Excel import; a site
// changes through a transfer (below) or an approved move.
// An hourly copy is not looked at by anyone, so it stops itself when HR's list would take many people off
// (HR_SYNC_LIMITS). Then Preview on Sync all masters shows the change, and Apply there writes it.
//
// Employee Transfer: a transfer HR has approved moves the worker in Pulse-II from the transfer date, as an approved
// move (server/routes/employee-site-move.mjs applyEmployeeSiteMove): it is kept in the site history and on the
// Employee site moves register, and HR's master and the Excel import never move the site back. Each HR transfer
// is applied once (hr_transfer_sync). One whose employee is not in Employee Master yet, or whose site is not one
// of ours, waits and is tried again every hour.
import {readHrMasterSheet,employeeNumber,recordNumber,hrSiteName} from '../../shared/hr-employee-master.mjs';
import {applyHrMaster,planFor,hrMasterPlanKey} from '../routes/hr-master-import.mjs';
import {employeeMasterOwner} from './employee-master-owner.mjs';
import {applyEmployeeSiteMove,EMPLOYEE_SITE_MOVE_SCHEMA} from '../routes/employee-site-move.mjs';
import {employeeSiteOn,sameSite,isBookDate} from '../../shared/employee-site-moves.mjs';
import {slashedId} from '../../shared/hr-employee-changes.mjs';

export const HR_SYNC_SOURCE='hrpulse.cmll.in';
export const HR_EMPLOYEE_MASTER='Employee master';
export const HR_EMPLOYEE_TRANSFER='Employee transfer';
export const HR_SYNC_FILE='HR Pulse sync';
// Above these, an hourly or Sync-button copy stops and waits for Preview and Apply.
export const HR_SYNC_LIMITS={notListed:200,left:300};
export const HR_TRANSFER_SYNC_SCHEMA=`CREATE TABLE IF NOT EXISTS hr_transfer_sync(hr_id TEXT PRIMARY KEY,record_data JSONB NOT NULL,outcome TEXT NOT NULL,employee_id BIGINT,synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
const LIST_LIMIT=300;
const TRANSFER_EMPLOYEES_SQL=`SELECT id,jsonb_build_object('caliberId',record_data->'caliberId','employeeId',record_data->'employeeId','caliberCode',record_data->'caliberCode',
 'name',record_data->'name','employee',record_data->'employee','site',record_data->'site','location',record_data->'location','currentLocation',record_data->'currentLocation',
 'siteMoves',record_data->'siteMoves') AS record_data FROM master_records WHERE master_name='Employee master' ORDER BY id`;
const SHEET_HEADER=['EMPLOYEE ID','NAME','REGION','SITE / OFFICE','DEPARTMENT','DESIGNATION','CATEGORY','STATUS'];

const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=value=>value===null||value===undefined?'':String(value).trim();

// HR's lines as the rows of HR's master Excel, so the Excel import's reader takes them as they are.
export function hrEmployeeSheet(employees){
 if(!Array.isArray(employees))throw fail(502,'HR returned no Employee Master. Nothing was changed.');
 // An ID with a slash between digits ("CMLL6665/1") is written as it is but can never be read as 66651: the sheet
 // reader then lists the line as "No usable Employee ID" and leaves it out.
 return [SHEET_HEADER,...employees.map(row=>[slashedId(row.employeeId)?'ID '+text(row.employeeId):row.employeeId,row.name,row.region,row.site,row.department,row.designation,row.category,row.status].map(text))];
}

// Stops a copy nobody looked at when HR's list would take many people off it at once (a half-loaded HR list).
export function hrSyncGuard(plan,{first}={}){
 const {notListed,left}=plan.summary;
 if(first)throw fail(409,"HR's master has not been applied in Pulse-II yet. Open Preview, check it and apply.");
 if(notListed>HR_SYNC_LIMITS.notListed||left>HR_SYNC_LIMITS.left)throw fail(409,`Stopped: this copy would take ${notListed.toLocaleString('en-IN')} people off HR's list and mark ${left.toLocaleString('en-IN')} LEFT. Nothing was changed. Open Preview, check and apply.`);
}

const trim=lists=>Object.fromEntries(Object.entries(lists).map(([key,rows])=>[key,rows.slice(0,LIST_LIMIT)]));

// Works out every HR transfer without writing. `employees`: Employee master lines ({id, record_data}); `done`: the
// HR transfer ids already applied. Transfers of one worker are taken in date order.
export function planHrTransfers(transfers,employees,done=new Set()){
 const byNumber=new Map();
 for(const row of employees){const number=recordNumber(row.record_data);if(number&&!byNumber.has(number))byNumber.set(number,row);}
 const sites=new Map(),items=[];
 const ordered=[...(Array.isArray(transfers)?transfers:[])].sort((a,b)=>text(a.transferDate).localeCompare(text(b.transferDate))||text(a.approvedAt).localeCompare(text(b.approvedAt)));
 for(const transfer of ordered){
  const id=text(transfer.id),number=employeeNumber(transfer.employeeId),to=hrSiteName(transfer.toSite),date=text(transfer.transferDate).slice(0,10);
  const base={id,code:text(transfer.code),employeeId:text(transfer.employeeId),name:text(transfer.name),fromSite:text(transfer.fromSite),toSite:text(transfer.toSite),transferDate:date};
  if(!id)continue;
  if(done.has(id)){items.push({...base,outcome:'Already in Pulse-II'});continue;}
  const employee=number&&byNumber.get(number);
  if(!employee){items.push({...base,outcome:'Waiting: not in Employee Master'});continue;}
  if(!to){items.push({...base,outcome:'Waiting: To site is not a Pulse-II site'});continue;}
  if(!isBookDate(date)){items.push({...base,outcome:'Waiting: no transfer date'});continue;}
  const record=employee.record_data,held=sites.get(String(employee.id));
  const now=held&&date>=held.date?held.site:employeeSiteOn(record,date);
  const moves=!sameSite(now,to);
  if(moves&&(!held||date>=held.date))sites.set(String(employee.id),{site:to,date});
  items.push({...base,employeeRecordId:String(employee.id),to,from:now,outcome:moves?'Will move':'Already at that site'});
 }
 const count=outcome=>items.filter(item=>item.outcome===outcome).length;
 return {items,summary:{transfers:items.length,move:count('Will move'),atSite:count('Already at that site'),done:count('Already in Pulse-II'),waiting:items.filter(item=>item.outcome.startsWith('Waiting')).length}};
}

export function createHrEmployeeSync({pool,key=process.env.HR_SYNC_KEY,base=process.env.HR_SYNC_URL||'https://hr-api-cmll-783.azurewebsites.net',request=fetch}={}){
 const configured=()=>typeof key==='string'&&key.length>=32;
 let schema=null;
 const ensure=()=>schema??=pool.query(`${HR_TRANSFER_SYNC_SCHEMA};${EMPLOYEE_SITE_MOVE_SCHEMA}`).catch(error=>{schema=null;throw error;});
 async function read(what){
  if(!configured())throw fail(503,'HR connection is not set up (HR_SYNC_KEY).');
  let response;
  try{response=await request(new URL('/api/integrations/mis/'+what,base),{headers:{'X-MIS-Sync-Key':key,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(60_000)});}
  catch{throw fail(502,'HR did not answer. Existing data retained.');}
  const body=await response.json().catch(()=>null);
  if(!response.ok||!body)throw fail(502,`HR refused the copy (${response.status}${body?.error?': '+body.error:''}). Existing data retained.`);
  return body;
 }
 // A site move made here with an OTP on a card, told to HR Pulse (caliber-hr server/mis-site-move.mjs).
 async function sendSiteMove(move){
  if(!configured())throw fail(503,'HR connection is not set up (HR_SYNC_KEY).');
  let response;
  try{response=await request(new URL('/api/integrations/mis/site-move',base),{method:'POST',headers:{'X-MIS-Sync-Key':key,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(move),redirect:'error',signal:AbortSignal.timeout(30_000)});}
  catch{throw fail(502,'HR Pulse did not answer.');}
  const body=await response.json().catch(()=>null);
  if(!response.ok||!body)throw fail(502,`HR Pulse refused the site move (${response.status}${body?.error?': '+body.error:''}).`);
  return body;
 }
 const sheetOf=async()=>{const data=await read('employees');return readHrMasterSheet(hrEmployeeSheet(data.employees),{leaveOut:true});};
 const leftOut=sheet=>({lines:sheet.problems.length,problems:sheet.problems.slice(0,LIST_LIMIT)});

 async function previewEmployees(){
  const sheet=await sheetOf(),owner=await employeeMasterOwner(pool);
  const {first,applySites,plan}=await planFor(pool,sheet,{fileName:HR_SYNC_FILE},owner);
  let stop='';try{hrSyncGuard(plan,{first});}catch(error){stop=error.message;}
  return {master:HR_EMPLOYEE_MASTER,lines:sheet.lines,first,applySites,summary:plan.summary,lists:trim(plan.lists),leftOut:leftOut(sheet),planKey:hrMasterPlanKey(plan,applySites),stop};
 }
 // planKey: Apply after a Preview someone looked at. Without it the copy runs under hrSyncGuard.
 async function syncEmployees({by='',planKey}={}){
  const sheet=await sheetOf(),body={fileName:HR_SYNC_FILE,leaveOutProblemLines:true,...(planKey?{planKey}:{})};
  const result=await applyHrMaster(pool,sheet,body,{by,guard:planKey?null:hrSyncGuard});
  return {...result,linesLeftOut:sheet.problems.length};
 }

 async function transferPlan(client){
  const [{transfers},employees,done]=await Promise.all([read('transfers'),client.query(TRANSFER_EMPLOYEES_SQL),client.query('SELECT hr_id FROM hr_transfer_sync')]);
  return {transfers,plan:planHrTransfers(transfers,employees.rows,new Set(done.rows.map(row=>row.hr_id)))};
 }
 async function previewTransfers(){
  await ensure();
  const {plan}=await transferPlan(pool);
  return {master:HR_EMPLOYEE_TRANSFER,summary:plan.summary,items:plan.items.filter(item=>item.outcome!=='Already in Pulse-II').slice(-LIST_LIMIT).reverse()};
 }
 async function syncTransfers({by=''}={}){
  await ensure();
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(709224110)');
   const {transfers,plan}=await transferPlan(client),byId=new Map(transfers.map(row=>[text(row.id),row]));
   let moved=0,atSite=0,failed=0;
   for(const item of plan.items){
    if(!['Will move','Already at that site'].includes(item.outcome))continue;
    // One transfer that cannot be applied waits for the next hour; the others go on.
    await client.query('SAVEPOINT hr_transfer');
    let result;
    try{result=await applyEmployeeSiteMove(client,{employeeId:item.employeeRecordId,to:item.to,fromDate:item.transferDate,
     requestedBy:'hr-transfer',requestedName:`HR transfer ${item.code||item.id}${by?' (sync by '+by+')':''}`,approvedBy:['HR Pulse'],card:{hrTransfer:item.code||item.id}});}
    catch(error){if(!error.status)throw error;await client.query('ROLLBACK TO SAVEPOINT hr_transfer');failed++;continue;}
    const outcome=result.move?'Moved':'Already at that site';
    if(result.move)moved++;else atSite++;
    await client.query('INSERT INTO hr_transfer_sync(hr_id,record_data,outcome,employee_id) VALUES($1,$2::jsonb,$3,$4) ON CONFLICT(hr_id) DO NOTHING',[item.id,JSON.stringify(byId.get(item.id)||item),outcome,item.employeeRecordId]);
   }
   await client.query('COMMIT');
   return {summary:{...plan.summary,moved,atSite,failed}};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
 }

 return {
  configured,
  // What changed in HR Pulse's Employee Master after change number `after`, and the whole list (read only).
  changes:after=>read('employee-changes?after='+encodeURIComponent(/^\d{1,18}$/.test(String(after??''))?String(after):'0')),
  employees:()=>read('employees'),
  // The approved transfers HR holds, for a cheap look before the whole transfer copy.
  transfers:()=>read('transfers'),
  // The site machines' punches of up to 31 days (caliber-hr server/mis-biometric-punches.mjs), for Attendance Sheet Mismatch.
  biometricPunches:({from,to})=>read('biometric-punches?'+new URLSearchParams({from,to})),
  sendSiteMove,
  async count(name){
   if(name!==HR_EMPLOYEE_TRANSFER)return null;
   await ensure();return Number((await pool.query('SELECT count(*) n FROM hr_transfer_sync')).rows[0].n);
  },
  preview:name=>name===HR_EMPLOYEE_MASTER?previewEmployees():name===HR_EMPLOYEE_TRANSFER?previewTransfers():Promise.reject(fail(400,'Unknown master.')),
  sync:(name,{by,planKey}={})=>name===HR_EMPLOYEE_MASTER?syncEmployees({by,planKey}):name===HR_EMPLOYEE_TRANSFER?syncTransfers({by}):Promise.reject(fail(400,'Unknown master.')),
 };
}
