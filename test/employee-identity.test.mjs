import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {suggestedCaliberId,employeeIdentity} from '../employee-identity.mjs';
import {normalizeEmployee,importEmployees,registerEmployeeMaster} from '../employee-master.mjs';
import {EMPLOYEE_FIELDS} from '../employee-master-fields.mjs';

test('Employee ID and Caliber ID are separate fields without changing existing employee references',()=>{
  assert.equal(EMPLOYEE_FIELDS.find(([key])=>key==='caliberId')[1],'Employee ID');
  assert.equal(EMPLOYEE_FIELDS.find(([key])=>key==='caliberCode')[1],'Caliber ID');
  assert.equal(suggestedCaliberId('CMPL3228'),'CMLL3228');
  assert.equal(suggestedCaliberId('0012'),'CMLL0012');
  assert.equal(suggestedCaliberId('OTHER'),'');
  const employee=normalizeEmployee({caliberId:'CMPL3228',employeeCode:'83',name:'Example'});
  assert.equal(employee.employeeId,'CMPL3228');assert.equal(employee.caliberId,'CMPL3228');
  assert.equal(employee.caliberCode,'CMLL3228');assert.equal(employee.employeeCode,'83');
  assert.equal(normalizeEmployee({...employee,caliberCode:'CMLL9000'}).caliberCode,'CMLL9000');
  assert.equal(employeeIdentity({employeeId:'CMPL3228'}).caliberCode,'CMLL3228');
});

test('legacy employees gain a Caliber ID in the register, search and export; imports retain the same record',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
    await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Employee master',$1)",[JSON.stringify({caliberId:'CMPL3228',employeeId:'CMPL3228',name:'Example'})]);
    const client={query:(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args),release(){}};
    const pool={query:(...args)=>db.query(...args),connect:async()=>client};
    let get;
    registerEmployeeMaster({get(path,...handlers){get=handlers.at(-1)},post(){},put(){},use(){}},{pool,requireSession(){},requireAdministrator(){}});
    let body;await get({query:{q:'CMLL3228',export:'1'}},{set(){return this},json(value){body=value}},error=>{throw error});
    assert.equal(body.total,1);assert.equal(body.records[0].caliberCode,'CMLL3228');
    assert.equal(body.records[0].caliberId,'CMPL3228');
    assert.equal((await importEmployees(pool,[{caliberId:'CMPL3228',caliberCode:'CMLL3228',name:'Updated'}])).updated,1);
    const rows=(await db.query('SELECT id,record_data FROM master_records')).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].id,1);assert.equal(rows[0].record_data.caliberCode,'CMLL3228');
  }finally{await db.close()}
});
