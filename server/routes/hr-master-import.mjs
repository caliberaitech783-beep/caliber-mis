// HR's all-sites Excel becomes the Employee Master: look at the changes first, then apply them.
// The rules are in shared/hr-employee-master.mjs. The browser sends the rows of the sheet; they are read
// again here, so what is applied never depends on what the browser worked out.
import {createHash} from 'node:crypto';
import {readHrMasterSheet,planHrMaster,HR_MASTER_EXISTING_FIELDS,HR_MASTER_MAX_LINES,EMPLOYEE_MASTER_OWNER_KEY,HR_MASTER_OWNER} from '../../shared/hr-employee-master.mjs';
import {employeeMasterOwner,OWNER_SAVE_SQL} from '../services/employee-master-owner.mjs';

// Only the fields the plan reads, never the whole record.
export const HR_MASTER_EXISTING_SQL=`SELECT id,master_name,jsonb_build_object(${HR_MASTER_EXISTING_FIELDS.map(field=>`'${field}',record_data->'${field}'`).join(',')}) AS record_data
 FROM master_records WHERE master_name IN('Employee master','ERP Employee master') ORDER BY id`;
const UPDATE_SQL=`UPDATE master_records m SET master_name='Employee master',
 record_data=m.record_data||v.d||jsonb_build_object('employeeMasterRevision',COALESCE((m.record_data->>'employeeMasterRevision')::bigint,0)+1)
 FROM jsonb_to_recordset($1::jsonb) AS v(id bigint,d jsonb) WHERE m.id=v.id`;
const INSERT_SQL="INSERT INTO master_records(master_name,record_data) SELECT 'Employee master',d FROM jsonb_array_elements($1::jsonb) AS d";
const NOT_LISTED_SQL=`UPDATE master_records SET record_data=record_data||jsonb_build_object('hrListed',false,'hrLeft',false,'hrNotListedAt',$2::text,
 'employeeMasterRevision',COALESCE((record_data->>'employeeMasterRevision')::bigint,0)+1) WHERE id=ANY($1::bigint[])`;
const SETTINGS_SCHEMA="CREATE TABLE IF NOT EXISTS app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";
const CHUNK=500;

const fail=(status,message,extra={})=>Object.assign(new Error(message),{status,extra});
const fileNameOf=body=>String(body?.fileName||'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,200);
// The same file against the same master always gives the same key, so Apply can tell that nothing moved since the preview.
export const hrMasterPlanKey=(plan,applySites)=>createHash('sha256').update(JSON.stringify([plan.summary,applySites])).digest('hex').slice(0,32);

function readSheet(body){
 const rows=body?.rows;
 if(!Array.isArray(rows)||!rows.length)throw fail(400,"Choose HR's master Excel.");
 if(rows.length>HR_MASTER_MAX_LINES+100)throw fail(400,`HR's master holds more than ${HR_MASTER_MAX_LINES.toLocaleString('en-IN')} lines.`);
 const sheet=readHrMasterSheet(rows);
 if(!sheet.lines)throw fail(400,"HR's master has no employee lines.");
 if(sheet.problems.length)throw fail(422,`${sheet.problems.length.toLocaleString('en-IN')} line(s) in HR's master cannot be placed. Nothing was changed. Correct the file and choose it again.`,{problems:sheet.problems.slice(0,500),problemCount:sheet.problems.length,lines:sheet.lines});
 return sheet;
}

// The first import takes HR's site for everyone. A later one keeps the site Pulse-II holds unless it is asked to take HR's.
async function planFor(db,sheet,body,owner){
 const first=!owner,applySites=first||body?.applySites===true;
 const existing=(await db.query(HR_MASTER_EXISTING_SQL)).rows;
 return {first,applySites,plan:planHrMaster(existing,sheet.records,{applySites,fileName:fileNameOf(body)})};
}

export async function applyHrMaster(pool,sheet,body,{by=''}={}){
 await pool.query(SETTINGS_SCHEMA);
 const owner=await employeeMasterOwner(pool),client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(709224109)');
  const {first,applySites,plan}=await planFor(client,sheet,body,owner);
  if(hrMasterPlanKey(plan,applySites)!==String(body?.planKey||''))throw fail(409,'Employee Master changed after the preview. Look at the changes again, then apply.');
  const now=new Date().toISOString();
  for(let at=0;at<plan.updates.length;at+=CHUNK)await client.query(UPDATE_SQL,[JSON.stringify(plan.updates.slice(at,at+CHUNK).map(row=>({id:row.id,d:row.patch})))]);
  for(let at=0;at<plan.inserts.length;at+=CHUNK)await client.query(INSERT_SQL,[JSON.stringify(plan.inserts.slice(at,at+CHUNK))]);
  if(plan.notListedIds.length)await client.query(NOT_LISTED_SQL,[plan.notListedIds,now]);
  const note={owner:HR_MASTER_OWNER,since:owner?.since||now,lastImportAt:now,by:String(by||'').slice(0,120),fileName:fileNameOf(body),lines:sheet.lines};
  await client.query(OWNER_SAVE_SQL,[EMPLOYEE_MASTER_OWNER_KEY,JSON.stringify(note)]);
  await client.query('COMMIT');
  return {applied:true,first,applySites,summary:plan.summary,owner:note};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{client.release();}
}

export function registerHrMasterImport(app,{pool,requireSession,requireAdministrator}){
 const protect=[requireSession,requireAdministrator];
 const wrap=handler=>async(req,res,next)=>{
  try{await handler(req,res);}
  catch(error){if(error.status)return res.status(error.status).json({error:error.message,...error.extra});next(error);}
 };
 // Who maintains Employee Master today, for the note on the page.
 app.get('/api/employee-master/hr-import',...protect,wrap(async(req,res)=>{
  res.set('Cache-Control','no-store').json({owner:await employeeMasterOwner(pool)});
 }));
 // Nothing is written: the counts and the lists of what Apply would change.
 app.post('/api/employee-master/hr-import/preview',...protect,wrap(async(req,res)=>{
  const sheet=readSheet(req.body),owner=await employeeMasterOwner(pool);
  const {first,applySites,plan}=await planFor(pool,sheet,req.body,owner);
  res.set('Cache-Control','no-store').json({lines:sheet.lines,first,applySites,owner,summary:plan.summary,lists:plan.lists,planKey:hrMasterPlanKey(plan,applySites)});
 }));
 app.post('/api/employee-master/hr-import/apply',...protect,wrap(async(req,res)=>{
  const sheet=readSheet(req.body);
  const result=await applyHrMaster(pool,sheet,req.body,{by:req.session?.login||req.session?.name||''});
  req.audit={eventType:'Master data',module:'Employee master',action:'Apply HR master',targetType:'Employee master',targetReference:fileNameOf(req.body)||'HR master',
   details:{lines:result.summary.lines,updated:result.summary.updated,added:result.summary.added,siteChanged:result.summary.siteChanged,notListed:result.summary.notListed,left:result.summary.left}};
  res.json(result);
 }));
}
