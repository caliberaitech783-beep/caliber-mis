import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerErpEmployees} from '../erp-employee-source.mjs';

test('VLB and ELB lookup accepts Employee ID and new Caliber ID, with no Oracle call for master matches',async()=>{
  const db=new PGlite();let server,oracleReads=0;
  try{
    await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
    for(const row of [
      {caliberId:'CMPL3228',employeeId:'CMPL3228',employeeCode:'3228',name:'Driver One'},
      {caliberId:'CMPL1602',employeeId:'CMPL1602',caliberCode:'CMLL9000',name:'Operator Two'},
      {employeeId:'CMPL12769',name:'Legacy Employee'},
      {caliberId:'CMPL5555',caliberCode:'CMLL9999',name:'Duplicate One'},
      {caliberId:'CMPL6666',caliberCode:'CMLL9999',name:'Duplicate Two'},
    ])await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Employee master',$1)",[JSON.stringify(row)]);
    const app=express();app.use(express.json());
    registerErpEmployees(app,{getSiteScope:async()=>({sites:null}),pool:{query:(...args)=>db.query(...args)},config:null,requireSession:(r,s,n)=>n(),requireAdministrator:(r,s,n)=>n(),readSource:async()=>{oracleReads++;throw Error('Unexpected Oracle read')}});
    server=app.listen(0);const lookup=async id=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/log-books/employee-lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caliberId:id})});return {status:r.status,body:await r.json()}};
    for(const id of ['CMPL3228','cmll3228','3228']){
      const r=await lookup(id);assert.equal(r.status,200);assert.equal(r.body.id,'1');assert.equal(r.body.name,'Driver One');assert.equal(r.body.employeeId,'CMPL3228');assert.equal(r.body.caliberCode,'CMLL3228');
    }
    for(const id of ['CMPL1602','CMLL9000']){
      const r=await lookup(id);assert.equal(r.status,200);assert.equal(r.body.id,'2');assert.equal(r.body.name,'Operator Two');
    }
    assert.equal((await lookup('CMLL12769')).body.name,'Legacy Employee');
    assert.equal((await lookup('CMLL9999')).status,409,'ambiguous IDs must not pick an employee');
    assert.notEqual((await lookup('CMLL1602')).status,200,'custom Caliber ID replaces the default alias');
    assert.notEqual((await lookup('CMLL0000')).status,200,'unknown ID must not select an unrelated employee');
    assert.equal(oracleReads,0);
  }finally{if(server)await new Promise(r=>server.close(r));await db.close()}
});
