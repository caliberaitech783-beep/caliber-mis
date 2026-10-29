import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {normalizeScannedTime,validScannedTime} from '../scan-clock.mjs';
import {scanTimeInput} from '../src/scan-time-input.mjs';
import {matchesEmployeeReference,employeeReferenceVariants} from '../employee-identity.mjs';
import {extractCard} from '../scan-extraction.mjs';
import {aFields,reconcile} from '../gemini-hybrid.mjs';
import {registerErpEmployees} from '../erp-employee-source.mjs';
import {userSiteScope} from '../region-scope.mjs';
import {cleanTripCell} from '../trip-row-vision.mjs';

const person={employeeId:'CMPL3228',caliberId:'CMPL3228',caliberCode:'CMLL3228',employeeCode:'83',name:'AADIKA PRASAD YADAV',site:'POUNI OB'};
test('explicit single-minute notation becomes HH:MM without guessing blank or invalid times',()=>{
 for(const [input,expected] of [['12: 02','12:02'],['12: 2','12:02'],['12:2','12:02'],['7:5','07:05'],[' 7 : 05 ','07:05'],['0:0','00:00'],['23:9','23:09'],['7.5','07:05']]){
  assert.equal(normalizeScannedTime(input),expected);assert.equal(scanTimeInput(input),expected);assert.equal(validScannedTime(input),true);
 }
 for(const input of ['12','2','24:2','12:60','12:?','12:234','12:2x','12:2:3']){assert.equal(normalizeScannedTime(input),input);assert.equal(validScannedTime(input),false);}
 assert.equal(normalizeScannedTime(null),null);assert.equal(scanTimeInput(null),'');assert.equal(normalizeScannedTime(''),'');
 assert.equal(cleanTripCell('time','12: 2'),'12:02');
});
test('Gemini output formats time cells while preserving original rows and unreadable evidence',()=>{
 const fields=Object.fromEntries(aFields('vehicle').map(key=>[key,{value:null,status:'missing'}]));fields.machineSummary=[];
 const trips={p:true,r:[[1,'V12','12: 2','7:5'],[2,'V12',null,'12:60']]},original=JSON.stringify(trips);
 const result=reconcile(fields,trips,'vehicle');
 assert.equal(result.rows[0].loadingTime,'12:02');assert.equal(result.rows[0].unloadingTime,'07:05');
 assert.equal(result.rows[1].loadingTime,'');assert.equal(result.rows[1].unloadingTime,'12:60');
 assert.ok(!result.issues.some(issue=>issue.startsWith('Trip 1: check')));assert.ok(result.issues.includes('Trip 2: check loading time.'));assert.ok(result.issues.includes('Trip 2: check unloading time.'));
 assert.equal(JSON.stringify(trips),original);
 const draft=extractCard('Site: POUNI OB\n1 V12 12: 2 12: 9','vehicle',[]).draft;
 assert.equal(draft.trips.length,1);assert.equal(draft.trips[0].loadingTime,'12:02');assert.equal(draft.trips[0].unloadingTime,'12:09');
});
test('numeric references match actual Employee/Caliber IDs and preserve leading zeroes and explicit prefixes',()=>{
 for(const input of ['3228','CMPL3228','CMLL3228'])assert.equal(matchesEmployeeReference(person,input),true);
 assert.equal(matchesEmployeeReference(person,'83'),false,'an internal ERP code is not this person’s Employee ID');
 assert.equal(matchesEmployeeReference(person,'003228'),false);
 assert.deepEqual(employeeReferenceVariants('003228'),['003228','CMPL003228','CMLL003228']);
 const distinct={...person,caliberCode:'CMLL9000'};assert.equal(matchesEmployeeReference(distinct,'9000'),true);assert.equal(matchesEmployeeReference(distinct,'CMLL3228'),false);assert.equal(distinct.employeeId,'CMPL3228');
});
const records=[{id:1,master_name:'Employee master',record_data:person},{id:2,master_name:'Employee master',record_data:{employeeId:'CMPL5311',name:'Operator 5311',site:person.site}},{id:3,master_name:'Employee master',record_data:{...person,site:'Jayant OC',name:'Other location'}}];
test('numeric IDs in driver/operator boxes fill the correct master record for VLB and ELB, not another location',()=>{
 for(const kind of ['vehicle','equipment'])for(const code of ['3228','CMPL3228','CMLL3228']){
  const draft=extractCard('Site: POUNI OB\n'+(kind==='vehicle'?'Driver':'Operator')+' Name: '+code,kind,records).draft;
  assert.equal(draft.employeeId,'1');
 }
 assert.equal(extractCard('Site: POUNI OB\nDriver Name: 5311','vehicle',records).draft.employeeId,'2');
 assert.equal(extractCard('Site: Sasti OC\nDriver Name: 3228','vehicle',records).draft.employeeId,'');
 const duplicate={id:4,master_name:'Employee master',record_data:{...person,employeeId:'CMPL7777',caliberId:'CMPL7777',caliberCode:'CMLL3228'}};
 assert.equal(extractCard('Site: POUNI OB\nDriver Name: 3228','vehicle',[...records,duplicate]).draft.employeeId,'');
 assert.equal(extractCard('Site: POUNI OB\nDriver Name: CMPL3228','vehicle',[...records,duplicate]).draft.employeeId,'1');
});
test('lookup resolves numeric IDs from the selected location locally without ERP access, rejects duplicates and wrong sites',async t=>{
 const db=new PGlite();await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 for(const record of records)await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2)',[record.master_name,JSON.stringify(record.record_data)]);
 let erpReads=0;const app=express();app.use(express.json());registerErpEmployees(app,{pool:{query:(...args)=>db.query(...args)},config:null,requireSession:(req,res,next)=>{req.session={};next()},requireAdministrator:(req,res,next)=>next(),getSiteScope:async()=>userSiteScope({site:person.site}),readSource:async()=>{erpReads++;throw Error('Unexpected ERP access')}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.close()});
 const lookup=async(code,location=person.site)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/log-books/employee-lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caliberId:code,location})});return {status:response.status,body:await response.json()}};
 for(const code of ['3228','CMPL3228','CMLL3228']){const result=await lookup(code);assert.equal(result.status,200);assert.equal(result.body.name,person.name);assert.equal(result.body.employeeId,'CMPL3228');assert.equal(result.body.caliberCode,'CMLL3228');}
 assert.equal((await lookup('5311')).body.name,'Operator 5311');assert.equal((await lookup('3228','Jayant OC')).status,403);
 assert.equal((await lookup('9998')).status,503);assert.equal(erpReads,0);
 await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2)',['Employee master',JSON.stringify({...person,caliberId:'CMPL7777',employeeId:'CMPL7777',caliberCode:'CMLL3228'})]);
 assert.equal((await lookup('3228')).status,409);assert.equal((await lookup('CMPL3228')).status,200);
 const original=(await db.query('SELECT record_data FROM master_records WHERE id=1')).rows[0].record_data;assert.deepEqual(original,person);
});
