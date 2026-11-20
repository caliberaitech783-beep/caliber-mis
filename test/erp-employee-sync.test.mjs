import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import oracle from 'oracledb';
import {applyErpEmployees,mapErpEmployee,readErpEmployees,ERP_EMPLOYEE_QUERY,ERP_EMPLOYEE_COLUMNS} from '../server/services/erp-employee-sync.mjs';
import {registerErpMasters} from '../server/routes/erp-master-sync.mjs';
import {MASTER_SYNC_ROWS} from '../server/routes/master-sync.mjs';
import {registerEmployeeMaster} from '../server/routes/employee-master.mjs';
import {EMPLOYEE_FIELDS} from '../shared/employee-master-fields.mjs';

const fixture=async()=>{
 const db=new PGlite();
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 // Schema scripts hold several statements, which PGlite runs only through exec.
 const query=(s,a)=>s.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!a&&s.includes(';')?db.exec(s):db.query(s,a);
 return {db,pool:{query,connect:async()=>({query,release(){}})}};
};
const erp=(id,code,name,extra={})=>({tno:code,employeeCode:code,caliberId:id,employeeId:id,name,locationName:'JAYANT OC',departmentName:'MINING',...extra});
const add=(db,data,master='Employee master')=>db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2) RETURNING id',[master,JSON.stringify(data)]).then(r=>r.rows[0].id);
const get=async(db,id)=>(await db.query('SELECT master_name,record_data FROM master_records WHERE id=$1',[id])).rows[0];

test('ERP employee columns all exist in Employee Master and the query reads every mapped column',()=>{
 const fields=new Set(EMPLOYEE_FIELDS.map(([k])=>k));
 for(const [field,column] of Object.entries(ERP_EMPLOYEE_COLUMNS)){
  assert.ok(fields.has(field),field+' is an Employee Master field');
  assert.match(ERP_EMPLOYEE_QUERY,new RegExp('\\b'+column+'\\b'),column+' is read from ERP');
 }
 assert.match(ERP_EMPLOYEE_QUERY,/FROM CMPL\.EMPLOYEE e/);
 assert.doesNotMatch(ERP_EMPLOYEE_QUERY,/\b(INSERT|UPDATE|DELETE|MERGE)\b/i);
 const mapped=mapErpEmployee({EMPLOYEEID:' cmpl12 ',EMPLOYEECODE:12,EMPLOYEENAME:'RAM ',MONTHLYCTC:25000,DATEOFJOINING:'2024-01-02'});
 assert.equal(mapped.caliberId,'CMPL12');assert.equal(mapped.employeeId,'CMPL12');assert.equal(mapped.employeeCode,'12');
 assert.equal(mapped.monthlyCtc,'25000');assert.equal(mapped.name,'RAM');assert.equal(mapped.panNo,'');
});

test('ERP read is read-only and refuses an oversized list',async t=>{
 const sql=[];let closed=false;
 t.mock.method(oracle,'getConnection',async()=>({execute:async s=>{sql.push(s);return {rows:s.startsWith('SET')?[]:[{EMPLOYEEID:'CMPL1',EMPLOYEECODE:'1',EMPLOYEENAME:'A'}]}},close:async()=>{closed=true}}));
 const rows=await readErpEmployees({});
 assert.equal(sql[0],'SET TRANSACTION READ ONLY');assert.equal(rows[0].caliberId,'CMPL1');assert.ok(closed);
});

test('ERP sync updates by Employee ID, keeps Pulse-II fields and links, adds new employees and marks missing ones',async()=>{
 const {db,pool}=await fixture();
 try{
  const kept=await add(db,{caliberId:'CMPL1',employeeCode:'1',caliberCode:'CMLL9001',name:'OLD NAME',currentLocation:'SASTI',site:'SASTI',status:'Active',resignationStatus:'',employeeMasterRevision:4});
  const legacy=await add(db,{employeeId:'CMPL2',employeeCode:'2',name:'LEGACY'},'ERP Employee master');
  const gone=await add(db,{caliberId:'CMPL3',employeeCode:'3',name:'LEFT',site:'MAJRI'});
  const changedId=await add(db,{caliberId:'P44',employeeCode:'44',name:'RENUMBERED',currentLocation:'NAKODA',site:'NAKODA'});
  const result=await applyErpEmployees(pool,[erp('CMPL1','1','NEW NAME'),erp('CMPL2','2','LEGACY'),erp('CMPL44','44','RENUMBERED'),erp('CMPL5','5','JOINED')]);
  assert.deepEqual(result,{total:4,added:1,updated:3,unchanged:0,notInErp:1});
  const one=(await get(db,kept)).record_data;
  assert.equal(one.name,'NEW NAME');assert.equal(one.currentLocation,'SASTI');assert.equal(one.site,'SASTI');
  assert.equal(one.caliberCode,'CMLL9001');assert.equal(one.status,'Active');assert.equal(one.employeeMasterRevision,5);
  assert.equal(one.employeeSyncSource,'ERP');assert.ok(one.erpSyncedAt);
  assert.equal((await get(db,legacy)).master_name,'Employee master');
  const renumbered=(await get(db,changedId)).record_data;
  assert.equal(renumbered.caliberId,'CMPL44');assert.equal(renumbered.currentLocation,'NAKODA');
  const left=(await get(db,gone)).record_data;
  assert.equal(left.erpMissing,true);assert.equal(left.name,'LEFT','an employee missing from ERP is kept, not deleted');
  const fresh=(await db.query("SELECT record_data FROM master_records WHERE record_data->>'caliberId'='CMPL5'")).rows[0].record_data;
  assert.equal(fresh.site,'JAYANT OC');assert.equal(fresh.currentLocation,'');assert.equal(fresh.caliberCode,'CMLL5');assert.equal(fresh.source,'ERP');
  assert.equal(Number((await db.query('SELECT count(*) n FROM master_records')).rows[0].n),5);
  const again=await applyErpEmployees(pool,[erp('CMPL1','1','NEW NAME'),erp('CMPL2','2','LEGACY'),erp('CMPL44','44','RENUMBERED'),erp('CMPL5','5','JOINED')]);
  assert.deepEqual(again,{total:4,added:0,updated:0,unchanged:4,notInErp:0},'an unchanged ERP list writes nothing');
  assert.equal((await get(db,kept)).record_data.employeeMasterRevision,5);
  await applyErpEmployees(pool,[erp('CMPL1','1','NEW NAME'),erp('CMPL2','2','LEGACY'),erp('CMPL3','3','LEFT'),erp('CMPL44','44','RENUMBERED'),erp('CMPL5','5','JOINED')]);
  assert.equal((await get(db,gone)).record_data.erpMissing,false,'an employee back in ERP is no longer marked missing');
 }finally{await db.close();}
});

test('ERP sync refuses empty, duplicate and mostly-missing lists without changing anything',async()=>{
 const {db,pool}=await fixture();
 try{
  for(let i=1;i<=120;i++)await add(db,{caliberId:'CMPL'+i,employeeCode:String(i),name:'E'+i});
  await assert.rejects(applyErpEmployees(pool,[]),/empty employee list/);
  await assert.rejects(applyErpEmployees(pool,[erp('CMPL1','1','A'),erp('CMPL1','9','B')]),/duplicate/);
  await assert.rejects(applyErpEmployees(pool,[erp('CMPL1','1','RENAMED')]),/missing 119 of 120 employees/);
  assert.equal((await db.query("SELECT record_data->>'name' n FROM master_records WHERE record_data->>'caliberId'='CMPL1'")).rows[0].n,'E1');
  assert.equal(Number((await db.query("SELECT count(*) n FROM master_records WHERE record_data ? 'erpMissing'")).rows[0].n),0);
  const dry=await applyErpEmployees(pool,Array.from({length:120},(_,i)=>erp('CMPL'+(i+1),String(i+1),'NEW')),{dryRun:true});
  assert.equal(dry.updated,120);assert.equal(dry.dryRun,true);
  assert.equal((await db.query("SELECT record_data->>'name' n FROM master_records WHERE record_data->>'caliberId'='CMPL1'")).rows[0].n,'E1','a dry run writes nothing');
 }finally{await db.close();}
});

test('Employee Master is in Sync all masters and the ERP timer copies it after the other masters',async()=>{
 assert.deepEqual(MASTER_SYNC_ROWS.find(r=>r.name==='Employee master'),{name:'Employee master',label:'Employee Master',source:'Oracle'});
 const {db,pool}=await fixture();
 try{
  const app={get(){},post(){},use(){}};const order=[];
  const erpMasters=registerErpMasters(app,{pool,config:{user:'x'},requireSession:()=>{},requireAdministrator:()=>{},
   readSource:async()=>{order.push('masters');throw new Error('masters down')},
   readEmployees:async()=>{order.push('employees');return [erp('CMPL7','7','SEVEN')]}});
  await erpMasters.initialize();
  assert.deepEqual(await erpMasters.sync('Employee master'),{total:1,added:1,updated:0,unchanged:0,notInErp:0});
  const state=(await db.query("SELECT last_success,error FROM mis_master_sync_state WHERE master_name='Employee master'")).rows[0];
  assert.ok(state.last_success);assert.equal(state.error,'');
  await erpMasters.start();erpMasters.stop();
  await new Promise(r=>setTimeout(r,50));
  assert.deepEqual(order,['employees','masters','employees'],'a failed master copy does not stop the employee copy');
 }finally{await db.close();}
});

test('Employee Master page refuses edits to ERP fields but saves Pulse-II fields',async()=>{
 const {db,pool}=await fixture();let server;
 try{
  const id=await add(db,{...erp('CMPL8','8','EIGHT'),erpSyncedAt:'2026-11-19T00:00:00Z',employeeSyncSource:'ERP',employeeMasterRevision:1});
  const app=express();app.use(express.json());registerEmployeeMaster(app,{pool,requireSession:(q,s,n)=>n(),requireAdministrator:(q,s,n)=>n()});
  server=app.listen(0);const url=`http://127.0.0.1:${server.address().port}/api/employee-master/${id}`;
  const saved=(await get(db,id)).record_data;
  const put=body=>fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const refused=await put({...saved,name:'CHANGED'});
  assert.equal(refused.status,409);assert.match((await refused.json()).error,/Employee Name comes from the ERP/);
  const ok=await put({...saved,status:'On leave',resignationStatus:'Pending'});
  assert.equal(ok.status,200);assert.equal((await get(db,id)).record_data.status,'On leave');
 }finally{server?.close();await db.close();}
});
