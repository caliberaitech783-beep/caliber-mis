import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import express from 'express';import {importEmployees,normalizeEmployee,registerEmployeeMaster} from '../server/routes/employee-master.mjs';
test('employee import maps Caliber ID without login creation, preserves driver references and rejects duplicate IDs',async()=>{const db=new PGlite();try{await db.exec("CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)");await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Users & employees',$1),('ERP Employee master',$2)",[JSON.stringify({login:'unchanged'}),JSON.stringify({employeeId:'CMPL5625',erpEmployeeCode:'5625',name:'OLD',currentLocation:'SASTI',site:'SASTI'})]);const client={query:(s,a)=>s.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(s,a),release(){}};const pool={connect:async()=>client};const rows=[{caliberId:'CMPL5625',employeeCode:'5625',name:'PINTU',currentLocation:'JAYANT OB'},{caliberId:'CMPL16560',employeeCode:'16560',name:'MADAN',currentLocation:'MAJRI'}];assert.deepEqual(await importEmployees(pool,rows),{added:1,updated:1,total:2});const record=(await db.query('SELECT * FROM master_records WHERE id=2')).rows[0];assert.equal(record.master_name,'Employee master');assert.equal(record.record_data.caliberId,'CMPL5625');
assert.equal(record.record_data.name,'PINTU');
assert.equal(record.record_data.currentLocation,'SASTI');
assert.equal(record.record_data.site,'SASTI');
const newEmployee=(await db.query('SELECT record_data FROM master_records WHERE id=3')).rows[0].record_data;
assert.equal(newEmployee.currentLocation,'MAJRI');
assert.equal(newEmployee.site,'MAJRI');assert.equal((await db.query("SELECT record_data FROM master_records WHERE master_name='Users & employees'")).rows[0].record_data.login,'unchanged');await assert.rejects(()=>importEmployees(pool,[rows[0],rows[0]]),/Duplicate/);assert.throws(()=>normalizeEmployee({caliberId:'A'}),/required/);}finally{await db.close()}});

test('signed-in users can update only employee current location',async()=>{
 const db=new PGlite();
 const app=express();
 app.use(express.json());
 const query=(sql,params)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,params);
 registerEmployeeMaster(app,{
   pool:{query,connect:async()=>({query,release(){}})},
   requireSession:(req,res,next)=>req.headers.authorization==='Bearer user'?next():res.sendStatus(401),
   requireAdministrator:(_req,res)=>res.sendStatus(403)
 });
 const server=app.listen(0);
 try{
   await db.exec("CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)");
   await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Employee master',$1)",[
     JSON.stringify({caliberId:'CMPL4179',name:'Test employee',currentLocation:'SASTI',panNo:'private',employeeMasterRevision:1})
   ]);
   const base='http://127.0.0.1:'+server.address().port+'/api/employee-master';
   const headers={Authorization:'Bearer user','Content-Type':'application/json'};
   const update={method:'PUT',headers,body:JSON.stringify({currentLocation:'MAJRI',revision:1,name:'Changed'})};
   assert.equal((await fetch(base+'/location/1',{...update,headers:{'Content-Type':'application/json'}})).status,401);
   assert.equal((await fetch(base+'/1',update)).status,403);
   const lookup=await fetch(base+'/location?employeeId=4179',{headers});
   assert.deepEqual(await lookup.json(),{id:'1',employeeId:'CMPL4179',name:'Test employee',currentLocation:'SASTI',revision:1});
   const saved=await fetch(base+'/location/1',update);
   assert.deepEqual(await saved.json(),{id:'1',employeeId:'CMPL4179',name:'Test employee',currentLocation:'MAJRI',revision:2});
   assert.equal((await fetch(base+'/location/1',update)).status,409);
   const {rows:[{record_data:record}]}=await db.query('SELECT record_data FROM master_records');
   assert.equal(record.site,'MAJRI');
   assert.equal(record.panNo,'private');
 }finally{
   await new Promise(resolve=>server.close(resolve));
   await db.close();
 }
});
