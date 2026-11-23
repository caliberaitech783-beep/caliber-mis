import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import {readHrMasterSheet,planHrMaster,employeeNumber,hrSiteName,HR_MASTER_EXISTING_FIELDS,EMPLOYEE_MASTER_OWNER_KEY,HR_MASTER_OWNER} from '../shared/hr-employee-master.mjs';
import {employeeAtLocation,employeeOnHrList} from '../shared/log-book-access.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {registerHrMasterImport,HR_MASTER_EXISTING_SQL} from '../server/routes/hr-master-import.mjs';
import {registerErpMasters} from '../server/routes/erp-master-sync.mjs';
import {registerErpEmployees} from '../server/routes/erp-employee-source.mjs';
import {registerMasterSync} from '../server/routes/master-sync.mjs';
import {employeeMasterOwner} from '../server/services/employee-master-owner.mjs';

const HEAD=['Serial No','EMPLOYEE ID','NAME','REGION','SITE / OFFICE','DEPARTMENT','DESIGNATION','CATEGORY','REPORTING TO','CONTACT','EMAIL','STATUS'];
const line=(id,name,site,status='ACTIVE',designation='TIPPER DRIVER')=>[1,id,name,'WCL',site,'PRODUCTION',designation,'TEMPORARY',null,'9000000000',null,status];
const sheetOf=(...lines)=>[HEAD,...lines];
const row=(id,data,master='Employee master')=>({id:String(id),master_name:master,record_data:data});

test("HR's two Dudhichua spellings are the two Dudhichua sites",()=>{
 assert.equal(canonicalSiteName('Dudhichua OB East'),canonicalSiteName('Dudhichua East OC'));
 assert.equal(canonicalSiteName('Dudhichua OB West'),canonicalSiteName('Dudhichua OC'));
 assert.notEqual(canonicalSiteName('Dudhichua OB East'),canonicalSiteName('Dudhichua OB West'));
 assert.equal(hrSiteName('Dudhichua OB East'),'Dudhichua East OC');
 assert.equal(hrSiteName('Dudhichua OB West'),'Dudhichua OC');
 assert.equal(hrSiteName('Gauri Pauni OB 2nd'),'Gauri Pauni OC (2nd)');
 assert.equal(hrSiteName('Majri OB'),'Majri OC');
 assert.equal(hrSiteName('Head Office'),'');
});

test('an Employee ID, a Caliber ID and the bare number are one person',()=>{
 for(const written of ['CMLL1726','CMPL1726','1726',' cmll 1726 ','CMLL-1726','01726'])assert.equal(employeeNumber(written),'1726',written);
 for(const written of ['','0','LEFT','IDPROBLEM','CMLLCMPL6665','CMLL','17A26'])assert.equal(employeeNumber(written),'',written);
});

test("HR's sheet is read below its title rows, and every line that cannot be placed is named",()=>{
 const good=readHrMasterSheet([['MASTER DATA'],[null],...sheetOf(line('CMLL100','RAM','Majri OB'),line(200,'SHYAM','Dudhichua OB East','LEFT'),[null,null,null],line('cmpl300','MOHAN','Jayant OB',''))]);
 assert.equal(good.problems.length,0);assert.equal(good.lines,3);
 assert.deepEqual(good.records.map(r=>[r.line,r.number,r.siteName,r.status,r.left]),[[4,'100','Majri OC','ACTIVE',false],[5,'200','Dudhichua East OC','LEFT',true],[7,'300','Jayant OC','',false]]);
 assert.equal(good.records[0].designation,'TIPPER DRIVER');assert.equal(good.records[0].department,'PRODUCTION');assert.equal(good.records[0].category,'TEMPORARY');

 const bad=readHrMasterSheet(sheetOf(line('LEFT','A','Majri OB'),line('0','B','Majri OB'),line(null,'C','Jayant OB'),line('CMLL5','','Sasti OB'),line('CMLL6','D','Head Office'),
  line('CMLL6665','E','Majri OB'),line('CMLL6665','F','Sasti OB'),line('CMLL7','G','Sasti OB')));
 assert.equal(bad.records.length,0,'a file with a problem line is refused as a whole');
 assert.equal(bad.lines,8);
 assert.deepEqual(bad.problems.map(p=>[p.line,p.employeeId,/No usable/.test(p.problem)?'id':/Name/.test(p.problem)?'name':/Site/.test(p.problem)?'site':'twice']),
  [[2,'LEFT','id'],[3,'0','id'],[4,'(blank)','id'],[5,'CMLL5','name'],[6,'CMLL6','site'],[7,'CMLL6665','twice'],[8,'CMLL6665','twice']]);
 assert.match(bad.problems[5].problem,/CMLL6665 is on 2 lines \(Majri OB and Sasti OB\)/);
 assert.throws(()=>readHrMasterSheet([['Name','Site'],['A','Majri OB']]),/EMPLOYEE ID, NAME and SITE/);
});

const existing=()=>[
 row(1,{caliberId:'CMPL100',name:'RAM OLD',site:'MAJRI OB',currentLocation:'MAJRI OB',status:'Resigned',resignationAcceptenceDate:'2025-01-25',currentDesignationName:'DRIVER VOLVO SCANIA'}),
 row(2,{caliberId:'200',caliberCode:'CMLL200',name:'SHYAM',site:'SASTI OB',status:'Active'}),
 row(3,{caliberId:'CMPL300',name:'MOHAN',site:'CMPL CHANDRAPUR',status:'Active'}),
 row(4,{caliberId:'CMPL400',name:'NOT ON LIST',site:'MAJRI OB',status:'Active'}),
 row(5,{caliberId:'CMPL12227',name:'ABC',site:'MAJRI OB',status:'Active'}),
 row(6,{caliberId:'CMPL21327',name:'TWIN',site:'MAJRI OB',status:'Active'}),
 row(7,{caliberId:'21327',name:'TWIN',site:'MAJRI OB',status:'Active'}),
 row(8,{caliberId:'CMPL500',name:'GONE',site:'DUDHICHUA EAST OB',status:'Active'}),
 row(9,{caliberId:'CMPL900',name:'OLD RESIGNED',site:'SASTI OB',status:'Resigned'}),
];
const hrFile=()=>readHrMasterSheet(sheetOf(line('CMLL100','RAM','Majri OB'),line('CMLL200','SHYAM','Majri OB'),line('CMLL300','MOHAN','Jayant OB'),line('CMLL600','NEW MAN','Sasti OB'),
 line('CMLL21327','TWIN','Majri OB'),line('CMLL500','GONE','Dudhichua OB East','LEFT'))).records;

test("the plan keeps every line, takes HR's details and marks the rest as not on HR's list",()=>{
 const plan=planHrMaster(existing(),hrFile(),{now:'2026-11-23T00:00:00.000Z',fileName:'hr.xlsx'});
 const patch=id=>plan.updates.find(u=>u.id===String(id))?.patch;
 // Same site written another way: no site change. Resigned in the old master, working on HR's list.
 assert.deepEqual({...patch(1),hrImportedAt:undefined,hrImportFile:undefined},{name:'RAM',hrCategory:'TEMPORARY',hrRegion:'WCL',hrSite:'Majri OB',hrStatus:'ACTIVE',status:'Active',hrListed:true,hrLeft:false,currentDepartmentName:'PRODUCTION',currentDesignationName:'TIPPER DRIVER',hrImportedAt:undefined,hrImportFile:undefined});
 assert.equal(patch(1).hrImportFile,'hr.xlsx');
 // Site taken from HR.
 assert.equal(patch(2).site,'Majri OC');assert.equal(patch(2).currentLocation,'Majri OC');
 assert.equal(patch(3).site,'Jayant OC');
 // The line written CMPL21327 is the person; the bare 21327 steps aside.
 assert.ok(patch(6));assert.equal(patch(7),undefined);
 // HR marks LEFT.
 assert.equal(patch(8).hrLeft,true);assert.equal(patch(8).status,'Left');
 assert.deepEqual(plan.inserts.map(r=>[r.caliberId,r.employeeId,r.caliberCode,r.name,r.site,r.currentLocation,r.hrListed,r.source]),[['CMPL600','CMPL600','CMLL600','NEW MAN','Sasti OC','Sasti OC',true,'HR master']]);
 assert.deepEqual(plan.notListedIds,['4','7','9'],'the dummy ID (5) is left alone');
 const s=plan.summary;
 assert.deepEqual([s.lines,s.updated,s.added,s.unchanged,s.siteChanged,s.siteKept,s.nameChanged,s.workingAgain,s.left,s.notListed,s.notListedAtSites,s.notListedWorking,s.notListedResigned,s.dummyKept],[6,5,1,0,2,0,1,1,1,3,3,2,1,1]);
 assert.deepEqual(s.sites.find(x=>x.site==='Majri OC'),{site:'Majri OC',listed:3,added:0,siteChanged:1,left:0,notListed:2});
 assert.deepEqual(plan.lists.siteChanged.map(r=>[r.employeeId,r.site,r.to]),[['200','SASTI OB','Majri OC'],['CMPL300','CMPL CHANDRAPUR','Jayant OC']]);
 assert.deepEqual(plan.lists.workingAgain.map(r=>[r.employeeId,r.resignedOn]),[['CMPL100','2025-01-25']]);
 assert.deepEqual(plan.lists.notListed.map(r=>r.employeeId),['CMPL400','21327','CMPL900']);
 for(const key of Object.keys(plan.updates[0].patch))assert.ok([...HR_MASTER_EXISTING_FIELDS,'hrImportedAt','hrImportFile'].includes(key),key+' is read back by the next plan');
});

test("a later import keeps the site held in Pulse-II unless it is asked to take HR's, and never moves an approved move",()=>{
 const held=[row(1,{caliberId:'CMPL100',name:'RAM',site:'Sasti OC',currentLocation:'Sasti OC',status:'Active',hrListed:true,hrLeft:false,hrCategory:'TEMPORARY',hrRegion:'WCL',hrSite:'Majri OB',hrStatus:'ACTIVE',currentDepartmentName:'PRODUCTION',currentDesignationName:'TIPPER DRIVER'}),
  row(2,{caliberId:'CMPL200',name:'SHYAM',site:'Sasti OC',status:'Active',hrListed:true,siteLockedAt:'2026-12-01T00:00:00.000Z'}),
  row(3,{caliberId:'CMPL300',name:'BACK AGAIN',site:'Sasti OC',status:'Active',hrListed:false})];
 const file=readHrMasterSheet(sheetOf(line('CMLL100','RAM','Majri OB'),line('CMLL200','SHYAM','Majri OB'),line('CMLL300','BACK AGAIN','Majri OB'))).records;
 const kept=planHrMaster(held,file,{applySites:false});
 assert.equal(kept.summary.unchanged,1,'nothing differs for 100 but the site, which is kept');
 assert.deepEqual(kept.lists.siteKept.map(r=>[r.employeeId,r.hrSite,r.reason]),[['CMPL100','Majri OC','Site held in Pulse-II kept'],['CMPL200','Majri OC','Site set by an approved move']]);
 assert.deepEqual(kept.lists.siteChanged.map(r=>r.employeeId),['CMPL300'],'someone who comes back onto the list takes the site of the file');
 const taken=planHrMaster(held,file,{applySites:true});
 assert.deepEqual(taken.lists.siteChanged.map(r=>r.employeeId),['CMPL100','CMPL300']);
 assert.deepEqual(taken.lists.siteKept.map(r=>r.employeeId),['CMPL200']);
 // The same file again changes nothing.
 const once=planHrMaster(existing(),hrFile());
 const after=existing().map(r=>({...r,record_data:{...r.record_data,...(once.updates.find(u=>u.id===r.id)?.patch||{}),...(once.notListedIds.includes(r.id)?{hrListed:false,hrLeft:false}:{})}}));
 const again=planHrMaster([...after,row(10,once.inserts[0])],hrFile(),{applySites:false});
 assert.deepEqual([again.updates.length,again.inserts.length,again.notListedIds.length,again.summary.unchanged,again.summary.alreadyNotListed],[0,0,0,6,3]);
});

test("a site of ours that is not in HR's file at all is left as it is",()=>{
 const plan=planHrMaster([...existing(),row(20,{caliberId:'CMPL2000',name:'LALPETH MAN',site:'LALPETH OB',status:'Active'}),row(21,{caliberId:'CMPL2001',name:'ELSEWHERE',site:'CMPL NAGPUR',status:'Active'})],hrFile());
 assert.deepEqual(plan.notListedIds,['4','7','9','21'],'the Lalpeth line is not marked; a line that is at no site of ours is');
 assert.deepEqual(plan.summary.sitesNotInFile,[{site:'Lalpeth OC',people:1}]);
 assert.equal(plan.summary.notListedAtSites,3);
});

test("a person who is not on HR's list, or whom HR marks LEFT, is at no site",()=>{
 const at=record=>employeeAtLocation(record,'Majri OC');
 assert.equal(at({site:'MAJRI OB'}),true);
 assert.equal(at({site:'Majri OC',hrListed:true,hrLeft:false}),true);
 assert.equal(at({site:'MAJRI OB',hrListed:false}),false);
 assert.equal(at({site:'Majri OC',hrListed:true,hrLeft:true}),false);
 assert.equal(employeeOnHrList({}),true);assert.equal(employeeOnHrList({hrListed:false}),false);
});

const fixture=async()=>{
 const db=new PGlite();
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 const query=(sql,params)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!params&&sql.includes(';')?db.exec(sql):db.query(sql,params);
 const pool={query,connect:async()=>({query,release(){}})};
 for(const r of existing())await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2)',[r.master_name,JSON.stringify({...r.record_data,panNo:'KEEP'+r.id,employeeMasterRevision:3})]);
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('C-Dir Employee master',$1)",[JSON.stringify({empId:'CMPL400',name:'STAFF',site:'Majri OC'})]);
 const app=express();app.use(express.json({limit:'5mb'}));
 const requireSession=(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.session={login:'owner'};next();};
 const requireAdministrator=(req,res,next)=>req.headers.authorization==='Bearer admin'?next():res.sendStatus(403);
 registerHrMasterImport(app,{pool,requireSession,requireAdministrator});
 registerErpEmployees(app,{pool,requireSession,requireAdministrator:(req,res,next)=>next(),getSiteScope:async()=>({sites:null,label:'All sites'})});
 const server=app.listen(0),base='http://127.0.0.1:'+server.address().port;
 const call=async(path,body,token='admin')=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>({}))};};
 const all=async()=>(await db.query('SELECT id,master_name,record_data FROM master_records ORDER BY id')).rows;
 return {db,pool,call,all,close:async()=>{server.close();await db.close();}};
};
const rows=()=>sheetOf(line('CMLL100','RAM','Majri OB'),line('CMLL200','SHYAM','Majri OB'),line('CMLL300','MOHAN','Jayant OB'),line('CMLL600','NEW MAN','Sasti OB'),line('CMLL21327','TWIN','Majri OB'),line('CMLL500','GONE','Dudhichua OB East','LEFT'));

test("the server reads only the fields the plan needs",()=>{
 for(const field of HR_MASTER_EXISTING_FIELDS)assert.ok(HR_MASTER_EXISTING_SQL.includes(`'${field}',record_data->'${field}'`),field);
 assert.doesNotMatch(HR_MASTER_EXISTING_SQL,/SELECT id,master_name,record_data\b/);
});

test("preview writes nothing; apply replaces Employee Master in place and makes HR's master the owner",async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.call('/api/employee-master/hr-import/preview',{rows:rows()},'user')).status,403);
  const before=JSON.stringify(await f.all());
  const refused=await f.call('/api/employee-master/hr-import/preview',{rows:sheetOf(line('LEFT','A','Majri OB'),line('CMLL100','RAM','Majri OB'))});
  assert.equal(refused.status,422);assert.equal(refused.body.problemCount,1);assert.equal(refused.body.problems[0].line,2);assert.match(refused.body.error,/Nothing was changed/);
  const preview=await f.call('/api/employee-master/hr-import/preview',{rows:rows(),fileName:'ALL_SITES_MASTER_DATA.xlsx'});
  assert.equal(preview.status,200);assert.equal(preview.body.first,true);assert.equal(preview.body.applySites,true);assert.equal(preview.body.owner,null);
  assert.deepEqual([preview.body.summary.updated,preview.body.summary.added,preview.body.summary.notListed,preview.body.summary.dummyKept],[5,1,3,1]);
  assert.equal(preview.body.lists.notListed.length,3);
  assert.equal(JSON.stringify(await f.all()),before,'preview changes nothing');
  assert.equal(await employeeMasterOwner(f.pool),null);

  const stale=await f.call('/api/employee-master/hr-import/apply',{rows:rows(),planKey:'not-the-key'});
  assert.equal(stale.status,409);assert.equal(JSON.stringify(await f.all()),before,'a stale preview applies nothing');
  assert.equal((await f.call('/api/employee-master/hr-import/apply',{rows:sheetOf(line('0','A','Majri OB')),planKey:preview.body.planKey})).status,422);

  const applied=await f.call('/api/employee-master/hr-import/apply',{rows:rows(),fileName:'ALL_SITES_MASTER_DATA.xlsx',planKey:preview.body.planKey});
  assert.equal(applied.status,200);assert.equal(applied.body.applied,true);
  const after=await f.all(),byId=id=>after.find(r=>String(r.id)===String(id)).record_data;
  assert.equal(after.length,11,'nine old lines, the staff line and one new person: nobody is deleted');
  assert.deepEqual([byId(1).name,byId(1).status,byId(1).hrListed,byId(1).site,byId(1).panNo,byId(1).employeeMasterRevision,byId(1).resignationAcceptenceDate],['RAM','Active',true,'MAJRI OB','KEEP1',4,'2025-01-25']);
  assert.deepEqual([byId(2).site,byId(2).currentLocation,byId(2).caliberId,byId(2).panNo],['Majri OC','Majri OC','200','KEEP2']);
  assert.deepEqual([byId(4).hrListed,byId(4).status,byId(4).site,byId(4).panNo,byId(4).employeeMasterRevision],[false,'Active','MAJRI OB','KEEP4',4]);
  assert.equal(byId(5).hrListed,undefined,'the dummy ID is not touched');
  assert.deepEqual([byId(7).hrListed,byId(9).hrListed],[false,false]);
  assert.deepEqual([byId(8).hrLeft,byId(8).status],[true,'Left']);
  assert.equal(byId(10).hrListed,undefined,'the staff directory is not touched');
  assert.deepEqual([byId(11).caliberId,byId(11).site,after[10].master_name],['CMPL600','Sasti OC','Employee master']);
  const owner=await employeeMasterOwner(f.pool);
  assert.deepEqual([owner.owner,owner.by,owner.fileName,owner.lines],[HR_MASTER_OWNER,'owner','ALL_SITES_MASTER_DATA.xlsx',6]);
  assert.equal((await f.db.query('SELECT setting_key FROM app_settings')).rows[0].setting_key,EMPLOYEE_MASTER_OWNER_KEY);
  assert.equal((await f.call('/api/employee-master/hr-import')).body.owner.owner,HR_MASTER_OWNER);

  // The same file again: a later import, nothing left to change.
  const again=await f.call('/api/employee-master/hr-import/preview',{rows:rows()});
  assert.deepEqual([again.body.first,again.body.applySites,again.body.summary.updated,again.body.summary.added,again.body.summary.notListed,again.body.summary.unchanged,again.body.summary.alreadyNotListed],[false,false,0,0,0,6,3]);

  // The Fetch box on a card: a working person of the site is found, the others are not.
  const fetchEmployee=(caliberId,location)=>f.call('/api/log-books/employee-lookup',{caliberId,location});
  assert.equal((await fetchEmployee('200','Majri OC')).body.name,'SHYAM');
  const unlisted=await fetchEmployee('400','Majri OC');assert.equal(unlisted.status,403);assert.match(unlisted.body.error,/^ID not found\. Please contact your HR team\.$/);
  const left=await fetchEmployee('500','Dudhichua East OC');assert.equal(left.status,403);assert.match(left.body.error,/HR's list says this person has left\. Please contact your HR team\.$/);
  assert.equal((await fetchEmployee('CMLL12227','Majri OC')).body.name,'ABC','the dummy ID is still fetched');
 }finally{await f.close();}
});

// Owner, 23 Nov 2026: the ERP copy is off for good, whether or not HR's master has been applied yet.
test("the ERP copy writes nothing to Employee Master, before and after HR's master, and Sync all masters has no Employee Master line",async()=>{
 const f=await fixture();
 try{
  let read=0;
  const erpRow={tno:'1',employeeCode:'100',caliberId:'CMPL100',employeeId:'CMPL100',name:'RAM FROM ERP',locationName:'MAJRI OB'};
  const erp=registerErpMasters(express(),{pool:f.pool,config:{},requireSession:(q,s,n)=>n(),requireAdministrator:(q,s,n)=>n(),readEmployees:async()=>{read++;return [erpRow];}});
  assert.equal((await erp.syncEmployees()).skipped,true);
  assert.equal(read,0,'the ERP is not even read');assert.equal((await f.all())[0].record_data.name,'RAM OLD','Employee Master is as Pulse-II holds it');
  const preview=await f.call('/api/employee-master/hr-import/preview',{rows:rows()});
  assert.equal((await f.call('/api/employee-master/hr-import/apply',{rows:rows(),planKey:preview.body.planKey})).status,200);
  assert.equal((await erp.syncEmployees()).skipped,true);
  assert.equal(read,0);assert.equal((await f.all())[0].record_data.name,'RAM');
  await f.db.exec('CREATE TABLE pulse_master_links(master_name TEXT,source_key TEXT,local_id BIGINT)');
  const sync=registerMasterSync(express(),{pool:f.pool,pulse:{status:()=>({connected:true,busy:false})},erp,requireSession:(q,s,n)=>n(),requireAdministrator:(q,s,n)=>n()});
  const status=await sync.status();
  // Employee Master has a line again since HR Pulse became its final authority; its source is HR, never Oracle / ERP.
  assert.deepEqual(status.masters.filter(m=>m.name==='Employee master').map(m=>[m.source,m.minute]),[['HR',true]]);
  assert.deepEqual(status.notSynced,[]);
 }finally{await f.close();}
});

// Owner, 23 Nov 2026: "make it active". Three numbers stayed on two lines in HR's file and held the whole master back.
test("HR's master can be applied without the lines that cannot be placed; the people named on them stay exactly as they are",async()=>{
 const file=()=>sheetOf(line('CMLL100','RAM','Majri OB'),line('CMLL200','SHYAM','Majri OB'),line('CMLL400','NOT ON LIST','Majri OB'),line('CMLL400','NOT ON LIST','Sasti OB'),line('LEFT','NOBODY','Majri OB'));
 const read=readHrMasterSheet(file(),{leaveOut:true});
 assert.deepEqual(read.records.map(r=>r.number),['100','200']);assert.deepEqual(read.leftAsIs,['400']);assert.equal(read.problems.length,3);
 assert.equal(readHrMasterSheet(file()).records.length,0,'without the tick the file is still refused as a whole');
 const plan=planHrMaster(existing(),read.records,{leftAsIs:read.leftAsIs});
 assert.ok(!plan.notListedIds.includes('4'),'CMPL400 is on a line that was left out: he is not marked "not on HR\'s list"');
 assert.ok(!plan.updates.some(u=>u.id==='4'));
 assert.deepEqual([plan.summary.leftAsIsNumbers,plan.summary.leftAsIsPeople],[1,1]);
 assert.ok(plan.notListedIds.includes('3'),'someone HR does not list at all is still marked');
 const f=await fixture();
 try{
  const refused=await f.call('/api/employee-master/hr-import/preview',{rows:file()});
  assert.equal(refused.status,422);assert.equal(refused.body.problemCount,3);assert.match(refused.body.error,/or apply the rest without these lines/);
  const preview=await f.call('/api/employee-master/hr-import/preview',{rows:file(),leaveOutProblemLines:true});
  assert.equal(preview.status,200);assert.equal(preview.body.leftOut.lines,3);assert.equal(preview.body.summary.leftAsIsPeople,1);
  assert.equal((await f.call('/api/employee-master/hr-import/apply',{rows:file(),planKey:preview.body.planKey})).status,422,'Apply needs the same tick as the preview');
  const before=(await f.all()).find(r=>r.record_data.caliberId==='CMPL400').record_data;
  assert.equal((await f.call('/api/employee-master/hr-import/apply',{rows:file(),planKey:preview.body.planKey,leaveOutProblemLines:true})).status,200);
  const after=await f.all(),byId=id=>after.find(r=>r.record_data.caliberId===id).record_data;
  assert.deepEqual(byId('CMPL400'),before,'left exactly as he was');
  assert.equal(byId('CMPL100').hrListed,true);assert.equal(byId('CMPL300').hrListed,false);
 }finally{await f.close();}
});
