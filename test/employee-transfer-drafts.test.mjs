import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {CDIR_DELETION_SCHEMA} from '../server/routes/cdir-deletion.mjs';
import {EMPLOYEE_TRANSFER_SCHEMA,registerEmployeeTransfers,restoreDraftDetails} from '../server/routes/employee-transfer.mjs';
import {employeeTransferDraftTerms} from '../shared/employee-transfer-terms.mjs';
import {CDIR_MASTERS} from '../shared/cdir-masters.mjs';

const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('a draft restores only the details the user changed',()=>{
  assert.deepEqual(restoreDraftDetails({name:'A',department:'HR',reportingTo:'X'},{base:{name:'A',department:'OPS',reportingTo:'X'},record:{name:'A',department:'OPS',reportingTo:'Y'}}),{name:'A',department:'HR',reportingTo:'Y'});
  assert.equal(employeeTransferDraftTerms({reason:'Promotion'}).terms.transferType,'');
  assert.match(employeeTransferDraftTerms({reason:'Because'}).error,/reason/);
  assert.match(employeeTransferDraftTerms({remarks:'x'.repeat(2001)}).error,/2000/);
  assert.deepEqual(employeeTransferDraftTerms({assets:['SIM','Car']}).terms.assets,['SIM']);
});

test('HTTP drafts and attachments stay with their owner until the transfer is submitted',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`CREATE TABLE master_records(id SERIAL PRIMARY KEY,master_name TEXT,record_data JSONB,created_at TIMESTAMPTZ DEFAULT NOW());CREATE TABLE notices(recipient TEXT,reference TEXT,message TEXT);${EMPLOYEE_TRANSFER_SCHEMA}${CDIR_DELETION_SCHEMA}`);
  const client={query:(...args)=>db.query(...args),release(){}};const pool={...client,connect:async()=>client};
  const insert=async(master,record)=>(await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2) RETURNING id',[master,JSON.stringify(record)])).rows[0].id;
  for(const name of ['Majri OC','Jayant OC','Sasti OC'])await insert(CDIR_MASTERS.site,{name});await insert(CDIR_MASTERS.category,{code:'A'});
  const id=await insert(CDIR_MASTERS.employee,{name:'EMPLOYEE ONE',empId:'E001',site:'Majri OC',category:'A',department:'MANAGEMENT',designation:'DIRECTOR',status:'ACTIVE',reportingTo:'OLD BOSS'});
  const session={hr:{role:'normal',assignedRole:'HR User',login:'hr',name:'HR'},hr2:{role:'normal',assignedRole:'HR User',login:'hr2',name:'HR Two'},destination:{role:'super',login:'destination',permissions:{adminLevel:'Manager',managerRoles:['Project Manager']}},other:{role:'super',login:'other',permissions:{adminLevel:'Manager',managerRoles:['Project Manager']}}};
  const users={destination:{managerSites:'Jayant OC'},other:{managerSites:'Sasti OC'}};
  const masters=async(names,connection=client)=>{const {rows}=await connection.query('SELECT master_name,record_data FROM master_records WHERE master_name=ANY($1::text[])',[names]);return Object.fromEntries(names.map(name=>[name,rows.filter(r=>r.master_name===name).map(r=>r.record_data)]));};
  const app=express();app.use(express.json({limit:'20mb'}));registerEmployeeTransfers(app,{pool,requireSession:(req,res,next)=>{req.session=session[req.headers['x-user']];if(!req.session)return res.status(401).json({error:'Sign in'});next();},loadViewer:async s=>users[s.login]||{},loadMasters:masters,pmLogins:async(db,site)=>site==='Majri OC'?['source']:site==='Jayant OC'?['destination']:[],notify:async()=>{}});
  app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const raw=(user,path,method='GET',body)=>fetch(`http://127.0.0.1:${server.address().port}/api/cdir/employee-transfers${path}`,{method,headers:{'x-user':user,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const call=async(...args)=>{const response=await raw(...args);return {status:response.status,body:await response.json()};};

  const first=(await call('hr','/lookup?empId=E001')).body;assert.equal(first.draft,null);
  assert.equal((await call('hr','/files','POST',{filename:'order.png',base64:Buffer.from('<script>').toString('base64')})).status,400);
  const file=await call('hr','/files','POST',{filename:'order.png',base64:PNG});assert.equal(file.status,201);assert.equal(file.body.bytes,Buffer.from(PNG,'base64').length);
  assert.equal((await raw('hr2',`/files/${file.body.id}`)).status,404);
  assert.equal((await call('hr2',`/files/${file.body.id}`,'DELETE')).status,404);
  assert.equal((await raw('hr',`/files/${file.body.id}`)).status,200);

  const draft={employeeRecordId:first.employeeRecordId,record:{...first.record,reportingTo:'NEW BOSS'},terms:{destination:'Jayant OC',reason:'Promotion',remarks:'Half filled'},fileIds:[file.body.id]};
  assert.equal((await call('hr','/drafts','PUT',{...draft,terms:{reason:'Because'}})).status,400);
  assert.equal((await call('hr2','/drafts','PUT',draft)).status,400);
  const saved=await call('hr','/drafts','PUT',draft);assert.equal(saved.status,200,JSON.stringify(saved.body));
  assert.equal((await call('hr','/drafts','PUT',draft)).body.id,saved.body.id);
  assert.deepEqual((await call('hr','/drafts')).body.drafts.map(row=>[row.empId,row.destination]),[['E001','Jayant OC']]);
  assert.equal((await call('hr2','/drafts')).body.drafts.length,0);
  assert.equal((await call('hr2','/lookup?empId=E001')).body.draft,null);

  await db.query("UPDATE master_records SET record_data=record_data||'{\"department\":\"HR\"}'::jsonb WHERE id=$1",[id]);
  const back=(await call('hr','/lookup?empId=E001')).body;
  assert.equal(back.draft.terms.reason,'Promotion');assert.equal(back.draft.terms.remarks,'Half filled');assert.deepEqual(back.draft.files.map(row=>row.filename),['order.png']);
  assert.equal(back.draftRecord.reportingTo,'NEW BOSS');assert.equal(back.draftRecord.department,'HR');

  const request={employeeRecordId:back.employeeRecordId,revision:back.revision,record:back.draftRecord,destination:'Jayant OC',effectiveDate:'2026-11-04',transfer:{transferType:'Permanent',reason:'Promotion',relievingDate:'2026-11-03'},remarks:'Half filled',fileIds:[file.body.id]};
  assert.equal((await call('hr2','','POST',{...request,revision:back.revision})).status,400);
  const created=await call('hr','','POST',request);assert.equal(created.status,201,JSON.stringify(created.body));
  assert.equal((await call('hr','/drafts')).body.drafts.length,0);
  const record=(await db.query('SELECT record_data FROM employee_transfers WHERE id=$1',[created.body.id])).rows[0].record_data;
  assert.deepEqual(record.attachments.map(row=>row.filename),['order.png']);
  const fromDestination=await raw('destination',`/files/${file.body.id}`);assert.equal(fromDestination.status,200);assert.deepEqual(Buffer.from(await fromDestination.arrayBuffer()),Buffer.from(PNG,'base64'));
  assert.equal((await raw('other',`/files/${file.body.id}`)).status,404);
  assert.equal((await call('hr',`/files/${file.body.id}`,'DELETE')).status,404);
  assert.equal((await call('hr','','POST',{...request,fileIds:['1','2','3','4','5','6']})).status,400);

  const later=await call('hr','/drafts','PUT',{employeeRecordId:back.employeeRecordId,record:back.record,terms:{}});
  assert.equal((await call('hr2',`/drafts/${later.body.id}`,'DELETE')).status,404);
  assert.equal((await call('hr',`/drafts/${later.body.id}`,'DELETE')).status,200);
  assert.equal((await call('hr',`/drafts/${later.body.id}`,'DELETE')).status,404);
});

test('transfer form offers Save draft, a draft list and file attachments',()=>{
  const ui=readFileSync(new URL('../src/employee-transfer.jsx',import.meta.url),'utf8');
  for(const text of ['Save draft','Your drafts','Draft saved','Attach file','type="file"','employee-transfers/drafts','employee-transfers/files','fileIds:files.map'])assert.ok(ui.includes(text),text);
});
