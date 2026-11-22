// A Form Master (owner, 23 Nov 2026): the lines that link an A Form no., a CMLL id and a site.
// The rules are in shared/a-form-master.mjs. HR's Excel is looked at first (nothing written), then applied; one
// line can also be typed or removed on the page. The lines live in master_records, so every change raises the
// master-data revision and the scan reads the new lines on its next card.
// The routes sit under /api/employee-master, so the Employee Master right decides who may open them.
import {createHash} from 'node:crypto';
import {A_FORM_MASTER,A_FORM_MAX_LINES,readAFormSheet,planAFormMaster,aFormLine,aFormKeys,aFormEmployeeId} from '../../shared/a-form-master.mjs';
import {employeeNumber,hrSiteName} from '../../shared/hr-employee-master.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {readAFormPeople} from '../services/a-form-people-index.mjs';
import {preferredPeople,aFormSharedAt} from '../../shared/a-form-people.mjs';

const LINES_SQL='SELECT id,record_data FROM master_records WHERE master_name=$1 ORDER BY id';
const INSERT_SQL='INSERT INTO master_records(master_name,record_data) SELECT $1,d FROM jsonb_array_elements($2::jsonb) AS d';
const UPDATE_SQL='UPDATE master_records m SET record_data=v.d FROM jsonb_to_recordset($2::jsonb) AS v(id bigint,d jsonb) WHERE m.id=v.id AND m.master_name=$1';
const DELETE_SQL='DELETE FROM master_records WHERE master_name=$1 AND id=ANY($2::bigint[])';
const CHUNK=500,PAGE=100;

const fail=(status,message,extra={})=>Object.assign(new Error(message),{status,extra});
const fileNameOf=body=>String(body?.fileName||'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,200);
// The same file against the same master always gives the same key, so Apply can tell that nothing moved since the preview.
export const aFormPlanKey=plan=>createHash('sha256').update(JSON.stringify(plan.summary)).digest('hex').slice(0,32);

function readSheet(body){
 const rows=body?.rows;
 if(!Array.isArray(rows)||!rows.length)throw fail(400,'Choose the A Form Excel.');
 if(rows.length>A_FORM_MAX_LINES+100)throw fail(400,`The A Form Excel holds more than ${A_FORM_MAX_LINES.toLocaleString('en-IN')} lines.`);
 const sheet=readAFormSheet(rows);
 if(!sheet.records.length)throw fail(422,'No line of the A Form Excel can be placed. Nothing was changed.',{problems:sheet.problems.slice(0,500),problemCount:sheet.problems.length,lines:sheet.lines});
 return sheet;
}
// Who Employee Master holds where, only to tell how many lines have no effect yet.
const employeesOf=people=>[...people.byNumber.values()].flat().filter(person=>person.master==='Employee master').flatMap(person=>person.siteKeys.map(siteKey=>({number:person.number,siteKey,listed:person.listed})));
const personAt=(people,number)=>preferredPeople((people.byNumber.get(number)||[]).filter(person=>person.listed))[0]||null;

export async function applyAFormMaster(pool,sheet,body){
 // The employee lists are read before the transaction: the shared copy's revision check must not run inside it.
 const employees=employeesOf(await readAFormPeople(pool)),client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(709224110)');
  const existing=(await client.query(LINES_SQL,[A_FORM_MASTER])).rows;
  const plan=planAFormMaster(existing,sheet.records,{fileName:fileNameOf(body),employees});
  if(aFormPlanKey(plan)!==String(body?.planKey||''))throw fail(409,'A Form Master changed after the preview. Look at the changes again, then apply.');
  for(let at=0;at<plan.updates.length;at+=CHUNK)await client.query(UPDATE_SQL,[A_FORM_MASTER,JSON.stringify(plan.updates.slice(at,at+CHUNK).map(row=>({id:row.id,d:row.data})))]);
  for(let at=0;at<plan.inserts.length;at+=CHUNK)await client.query(INSERT_SQL,[A_FORM_MASTER,JSON.stringify(plan.inserts.slice(at,at+CHUNK))]);
  if(plan.deleteIds.length)await client.query(DELETE_SQL,[A_FORM_MASTER,plan.deleteIds]);
  await client.query('COMMIT');
  return {applied:true,summary:plan.summary};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{client.release();}
}

export function registerAFormMaster(app,{pool,requireSession,requireAdministrator}){
 const protect=[requireSession,requireAdministrator];
 const wrap=handler=>async(req,res,next)=>{
  try{await handler(req,res);}
  catch(error){if(error.status)return res.status(error.status).json({error:error.message,...error.extra});next(error);}
 };
 // The three columns, with the name and the site Employee Master holds for that CMLL id.
 app.get('/api/employee-master/a-form',...protect,wrap(async(req,res)=>{
  const people=await readAFormPeople(pool),rows=(await pool.query(LINES_SQL,[A_FORM_MASTER])).rows;
  const wantSite=canonicalSiteName(hrSiteName(req.query.site)||req.query.site||''),q=String(req.query.q||'').trim().toUpperCase().slice(0,60),only=String(req.query.only||'');
  const lines=rows.map(row=>{
   const data=row.record_data||{},number=employeeNumber(data.employeeId),siteKey=canonicalSiteName(data.site),person=personAt(people,number),keys=aFormKeys(data.aFormNo);
   const shared=aFormSharedAt(people,siteKey,keys);
   const state=!person?'Not in Employee Master':!person.siteKeys.includes(siteKey)?'Employee Master holds '+(person.siteLabel||'another site'):!keys.length?'No A Form no.':shared?'A Form no. is on two people':'Linked';
   return {id:String(row.id),aFormNo:String(data.aFormNo||''),employeeId:number?aFormEmployeeId(number):String(data.employeeId||''),site:String(data.site||''),siteKey,name:person?.name||'',designation:person?.designation||'',state};
  });
  const sites=[...new Map(lines.map(line=>[line.siteKey,line.site])).values()].sort((a,b)=>a.localeCompare(b));
  const counts={lines:lines.length,withForm:lines.filter(line=>line.aFormNo&&line.state!=='No A Form no.').length,linked:lines.filter(line=>line.state==='Linked').length,noForm:lines.filter(line=>line.state==='No A Form no.').length,toCheck:lines.filter(line=>!['Linked','No A Form no.'].includes(line.state)).length};
  const shown=lines.filter(line=>(!wantSite||line.siteKey===wantSite)&&(!q||line.aFormNo.toUpperCase().includes(q)||line.employeeId.includes(q)||line.name.toUpperCase().includes(q))&&(only==='check'?!['Linked','No A Form no.'].includes(line.state):only==='blank'?line.state==='No A Form no.':true))
   .sort((a,b)=>a.site.localeCompare(b.site)||Number(employeeNumber(a.employeeId))-Number(employeeNumber(b.employeeId)));
  const all=req.query.export==='1',page=Math.max(0,Math.min(100000,parseInt(req.query.page)||0));
  res.set('Cache-Control','no-store').json({lines:(all?shown:shown.slice(page*PAGE,page*PAGE+PAGE)).map(({siteKey,...line})=>line),total:shown.length,page,pageSize:PAGE,sites,counts});
 }));
 // Nothing is written: the counts of what Apply would change, and the lines that are left out.
 app.post('/api/employee-master/a-form/preview',...protect,wrap(async(req,res)=>{
  const sheet=readSheet(req.body),existing=(await pool.query(LINES_SQL,[A_FORM_MASTER])).rows;
  const plan=planAFormMaster(existing,sheet.records,{fileName:fileNameOf(req.body),employees:employeesOf(await readAFormPeople(pool))});
  res.set('Cache-Control','no-store').json({lines:sheet.lines,problems:sheet.problems.slice(0,500),problemCount:sheet.problems.length,summary:plan.summary,lists:{shared:plan.lists.shared.slice(0,500),removed:plan.lists.removed.slice(0,500)},planKey:aFormPlanKey(plan)});
 }));
 app.post('/api/employee-master/a-form/apply',...protect,wrap(async(req,res)=>{
  const sheet=readSheet(req.body),result=await applyAFormMaster(pool,sheet,req.body);
  req.audit={eventType:'Master data',module:'A Form master',action:'Apply A Form Excel',targetType:'A Form master',targetReference:fileNameOf(req.body)||'A Form Excel',
   details:{lines:result.summary.lines,added:result.summary.added,changed:result.summary.changed,removed:result.summary.removed,linesLeftOut:sheet.problems.length}};
  res.json(result);
 }));
 // One line typed on the page: a new line, or the A Form no. of the line that CMLL id already has at that site.
 app.post('/api/employee-master/a-form/line',...protect,wrap(async(req,res)=>{
  const line=aFormLine(req.body),client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(709224110)');
   const held=(await client.query(LINES_SQL,[A_FORM_MASTER])).rows.find(row=>employeeNumber(row.record_data?.employeeId)===line.number&&canonicalSiteName(row.record_data?.site)===line.siteKey);
   const data={...line.data,updatedAt:new Date().toISOString(),updatedBy:String(req.session?.login||req.session?.name||'').slice(0,120)};
   if(held)await client.query(UPDATE_SQL,[A_FORM_MASTER,JSON.stringify([{id:held.id,d:{...held.record_data,...data}}])]);
   else await client.query(INSERT_SQL,[A_FORM_MASTER,JSON.stringify([data])]);
   await client.query('COMMIT');
   req.audit={eventType:'Master data',module:'A Form master',action:held?'Change A Form line':'Add A Form line',targetType:'A Form master',targetReference:line.data.employeeId+' · '+line.data.site,details:{aFormNo:line.data.aFormNo,before:held?.record_data?.aFormNo||''}};
   res.json({saved:true,changed:Boolean(held)});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
 }));
 app.delete('/api/employee-master/a-form/line/:id',...protect,wrap(async(req,res)=>{
  if(!/^\d{1,18}$/.test(req.params.id))throw fail(400,'Invalid line.');
  const removed=(await pool.query('DELETE FROM master_records WHERE master_name=$1 AND id=$2 RETURNING record_data',[A_FORM_MASTER,req.params.id])).rows[0];
  if(!removed)throw fail(404,'This line is no longer in A Form Master.');
  req.audit={eventType:'Master data',module:'A Form master',action:'Remove A Form line',targetType:'A Form master',targetReference:String(removed.record_data?.employeeId||'')+' · '+String(removed.record_data?.site||''),details:{aFormNo:removed.record_data?.aFormNo||''}};
  res.json({removed:true});
 }));
}
