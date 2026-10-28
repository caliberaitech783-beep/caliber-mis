import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {logBookSiteScope,employeeAtLocation,siteAllowed} from '../log-book-access.mjs';
import {LOG_BOOK_SCHEMA,registerLogBooks} from '../log-book.mjs';
import {registerErpEmployees} from '../erp-employee-source.mjs';
import {registerBulkCardScanning,SCAN_SCHEMA} from '../bulk-card-scanning.mjs';

test('site and regional scopes use canonical site names and deny unassigned MIS identities',()=>{
  const mis={role:'super',permissions:{adminLevel:'Admin',separateMisCredentials:true}};
  assert.deepEqual(logBookSiteScope(mis).sites,[]);
  assert.equal(siteAllowed(logBookSiteScope({...mis,site:'Sasti OB'}),'Sasti OC'),true);
  assert.equal(siteAllowed(logBookSiteScope({...mis,site:'Sasti OB'}),'Jayant OC'),false);
  assert.equal(siteAllowed(logBookSiteScope({...mis,managerRegion:'NCL'}),'Jayant OB'),true);
  assert.equal(siteAllowed(logBookSiteScope({...mis,managerRegion:'NCL'}),'Sasti OC'),false);
  assert.equal(logBookSiteScope({...mis,managerRegion:'All'}).sites,null);
  assert.equal(logBookSiteScope({role:'super',permissions:{adminLevel:'Admin'}}).sites,null);
  assert.equal(siteAllowed(logBookSiteScope({role:'normal',site:'Sasti OC',managerRegion:'All'}),'Jayant OC'),false);
  assert.equal(employeeAtLocation({site:'Sasti OC | Majri OC'},'Sasti OB'),true);
  assert.equal(employeeAtLocation({site:''},'Sasti OC'),false);
});

test('VLB/ELB options, paginated records, lookups, hours and writes enforce site scope on the server',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');await db.exec(LOG_BOOK_SCHEMA);await db.exec(SCAN_SCHEMA);
  const ids={};
  for(const [key,master,data] of [
    ['vehicle','Equipment master',{category:'Vehicle',door:'V1',site:'Sasti OC'}],
    ['equipment','Equipment master',{category:'Equipment',door:'E1',site:'Sasti OC'}],
    ['driver','Employee master',{employeeId:'CMPL1111',name:'Site employee',site:'Sasti OC'}],
    ['otherDriver','Employee master',{employeeId:'CMPL2222',name:'Other site employee',site:'Jayant OC'}],
    ['shift','Shift Master',{name:'Shift A',site:'Sasti OC'}],
    ['otherAsset','Equipment master',{category:'Vehicle',door:'V2',site:'Jayant OC'}],
    ['otherShift','Shift Master',{name:'Shift A',site:'Jayant OC'}],
    ['wo','Work Order master',{woNo:'WO-SASTI',site:'Sasti OC'}],
    ['otherWo','Work Order master',{woNo:'WO-JAYANT',site:'Jayant OC'}],
  ])ids[key]=(await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2) RETURNING id',[master,JSON.stringify(data)])).rows[0].id;
  for(const site of ['Sasti OB','Jayant OC'])for(const kind of ['vehicle','equipment'])await db.query('INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,request_key,created_by) VALUES($1,$2,$3,$4,1,$5,$6,$7)',[site+kind,kind,'2026-10-28',site,JSON.stringify({location:site}),randomUUID(),'fixture']);
  const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
  const pool={query,connect:async()=>({query,release(){}})};
  const profiles={site:{site:'Sasti OC'},region:{managerRegion:'NCL'},all:{managerRegion:'All'},unassigned:{}};
  const app=express();app.use(express.json());
  const requireSession=(req,res,next)=>{req.session={role:'super',login:req.headers.authorization,permissions:{adminLevel:'Admin',separateMisCredentials:true},...profiles[req.headers.authorization]};next()};
  const requireAdministrator=(req,res,next)=>next();
  let oracleReads=0;
  registerErpEmployees(app,{pool,config:{},requireSession,requireAdministrator,readSource:async()=>{oracleReads++;return {employeeId:'CMPL3333',name:'Remote employee',site:'Jayant OC'}}});
  registerLogBooks(app,{pool,requireSession,requireAdministrator});
  registerBulkCardScanning(app,{pool,requireSession,requireAdministrator,getSiteScope:async session=>logBookSiteScope(session),ocr:{recognize:async()=>({}),close(){}}});
  app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
  const server=app.listen(0);t.after(()=>{server.closeAllConnections();server.close()});
  const call=async(path,method='GET',body,auth='site')=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method,headers:{Authorization:auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
  const options=await call('/api/log-books/options');assert.deepEqual(options.data.sites,['Sasti OC']);
  for(const key of ['assets','employees','shifts','workOrders'])assert.ok(options.data[key].every(row=>row.site==='Sasti OC'),key);
  assert.equal(options.data.employees.length,1);
  assert.deepEqual((await call('/api/log-books/options','GET',null,'region')).data.sites,['Jayant OC']);
  assert.deepEqual((await call('/api/log-books/options','GET',null,'unassigned')).data.sites,[]);
  for(const kind of ['vehicle','equipment'])for(const suffix of ['','?first=1','?last=1','?before=999']){
    const r=await call('/api/log-books/'+kind+suffix);assert.equal(r.status,200);assert.equal(r.data.records.length,1);assert.equal(r.data.records[0].data.location,'Sasti OB');
    assert.equal((await call('/api/log-books/'+kind+suffix,'GET',null,'unassigned')).data.records.length,0);
  }
  const body={bookDate:'2026-10-28',location:'Sasti OC',assetId:ids.vehicle,employeeId:ids.driver,shiftId:ids.shift,shiftHours:8,openingKmr:10,closingKmr:20,openingHmr:10,closingHmr:11,trips:[],requestKey:randomUUID()};
  assert.equal((await call('/api/log-books/vehicle','POST',{...body,location:'Jayant OC'})).status,403);
  assert.equal((await call('/api/log-books/vehicle','POST',{...body,employeeId:ids.otherDriver})).status,400);
  const other=(await db.query("SELECT id FROM mis_log_books WHERE site='Jayant OC' AND book_type='vehicle'")).rows[0].id;
  assert.equal((await call('/api/log-books/vehicle/'+other,'PUT',{...body,revision:1})).status,403,'cannot move an out-of-scope record into own site');
  assert.equal((await call('/api/log-books/hours','POST',{location:'Jayant OC'})).status,403);
  assert.equal((await call('/api/log-books/employee-lookup','POST',{caliberId:'CMPL1111',location:'Sasti OB'})).status,200);
  assert.equal((await call('/api/log-books/employee-lookup','POST',{caliberId:'CMPL2222',location:'Sasti OC'})).status,403);
  assert.equal((await call('/api/log-books/employee-lookup','POST',{caliberId:'CMPL2222',location:'Jayant OC'})).status,403);
  assert.equal((await call('/api/log-books/employee-lookup','POST',{caliberId:'CMPL3333',location:'Sasti OC'})).status,403);
  assert.equal(oracleReads,1);assert.equal((await db.query("SELECT count(*) AS n FROM master_records WHERE master_name='ERP Employee master'")).rows[0].n,0,'out-of-scope ERP employee is never cached');
  assert.equal((await call('/api/log-books/equipment','POST',{...body,assetId:ids.equipment})).status,201);
  const scans={};
  for(const [key,site,owner] of [['local','Sasti OC','other'],['remote','Jayant OC','other'],['ownWrongSite','Jayant OC','site']]){
    const batch=randomUUID(),card=randomUUID();scans[key]={batch,card};
    await db.query("INSERT INTO mis_scan_batches(id,kind,name,created_by) VALUES($1,'vehicle',$2,$3)",[batch,key,owner]);
    await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,draft,status,checked_by) VALUES($1,$2,1,'test', $3,'test',$4,'approved','site')",[card,batch,Buffer.from('test'),JSON.stringify({location:site})]);
  }
  const visible=(await call('/api/scan-batches')).data.batches.map(batch=>batch.id);
  assert.ok(visible.includes(scans.local.batch));assert.ok(!visible.includes(scans.remote.batch));
  assert.equal((await call('/api/scan-cards/'+scans.remote.card+'/image')).status,403);
  assert.equal((await call('/api/scan-cards/'+scans.ownWrongSite.card+'/auto-save','POST',{revision:1})).status,403);
  assert.equal((await call('/api/scan-batches/'+scans.ownWrongSite.batch+'/post','POST',{cards:[{id:scans.ownWrongSite.card,revision:1}]})).status,403);
});
