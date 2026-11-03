import test from 'node:test';import assert from 'node:assert/strict';
import express from 'express';import {PGlite} from '@electric-sql/pglite';
import {registerFleetReconciliation,FLEET_REASON_SCHEMA} from '../fleet-reconciliation-api.mjs';
import {misRequestAllowed} from '../mis-application-access.mjs';
test('API enforces site/type permissions, preserves history, and refuses missing breakdown data',async()=>{
 const pool=new PGlite();await pool.exec(`CREATE TABLE master_records(id BIGINT,master_name TEXT,record_data JSONB);CREATE TABLE mis_log_books(id BIGINT,book_no TEXT,book_type TEXT,asset_id BIGINT,site TEXT,data JSONB,book_date DATE,deleted_at TIMESTAMPTZ);`);
 const site='Sasti OC',date='2026-11-02';for(const [id,name,data]of [[1,'Equipment master',{category:'vehicle',door:'V1',chassis:'C1',currentLocation:site}],[2,'Equipment master',{category:'equipment',door:'E2',currentLocation:site}],[3,'Shift Master',{site,shiftName:'Shift A',startTime:'05:00:00',endTime:'13:00:00'}]])await pool.query('INSERT INTO master_records VALUES($1,$2,$3)',[id,name,data]);
 let down=false,scope={sites:['sasti ob']},session={login:'test',role:'super'};
 const app=express();app.use(express.json());const protect=[(req,res,next)=>{if(req.headers.authorization!=='Bearer test')return res.sendStatus(401);req.session=session;req.logBookScope=scope;next()}];
 registerFleetReconciliation(app,{pool:{query:(sql,args)=>sql===FLEET_REASON_SCHEMA?pool.exec(sql):pool.query(sql,args)},protect,ensureBooks:async()=>{},pulseMasterSync:{readBreakdownRequests:async()=>{if(down)throw Error('Offline');return[]},status:()=>({connected:true})}});app.use((err,req,res,next)=>res.status(500).json({error:err.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const request=(path,init={})=>fetch(base+path,{...init,headers:{Authorization:'Bearer test','Content-Type':'application/json',...init.headers}});const q='?'+new URLSearchParams({site,date,shift:'S1'});
 try{
  assert.equal((await fetch(base+'/api/reports/fleet-reconciliation'+q)).status,401);
  let r=await request('/api/reports/fleet-reconciliation'+q);let data=await r.json();assert.equal(r.status,200,JSON.stringify(data));assert.equal(data.rows.length,2);assert.equal(data.summary.vehicle.pending,1);
  const save=body=>request('/api/reports/fleet-reconciliation/idle-reason',{method:'PUT',body:JSON.stringify({site,date,shift:'S1',assetId:'1',...body})});
  assert.equal((await save({reason:'Other',remarks:''})).status,400);assert.equal((await save({reason:'Standby',remarks:'Waiting'})).status,200);assert.equal((await save({reason:'Driver unavailable',remarks:'Absent'})).status,200);
  assert.equal((await pool.query('SELECT * FROM mis_fleet_idle_reason_history')).rows.length,2);data=await(await request('/api/reports/fleet-reconciliation'+q)).json();assert.equal(data.summary.vehicle.idle,1);assert.equal(data.rows.find(r=>r.kind==='vehicle').reason,'Driver unavailable');
  assert.equal((await save({assetId:'999',reason:'Standby'})).status,403);
  scope={sites:[]};assert.equal((await request('/api/reports/fleet-reconciliation'+q)).status,403);scope={sites:['sasti ob']};
  down=true;assert.equal((await request('/api/reports/fleet-reconciliation'+q)).status,503);down=false;
  session={login:'test',permissions:{separateMisCredentials:true,misDesktopAccess:['Vehicle Log Book']}};
  assert.equal(misRequestAllowed(session,{path:'/api/reports/fleet-reconciliation',method:'GET'}),true);
  assert.equal((await request('/api/reports/fleet-reconciliation'+q+'&kind=equipment')).status,403);
  data=await(await request('/api/reports/fleet-reconciliation'+q)).json();assert.deepEqual(data.rows.map(r=>r.kind),['vehicle']);
  assert.equal((await save({assetId:'2',reason:'Standby'})).status,403);
  session={login:'test',permissions:{separateMisCredentials:true,misDesktopAccess:['Reports']}};assert.equal((await request('/api/reports/fleet-reconciliation'+q)).status,403);
  assert.equal(misRequestAllowed(session,{path:'/api/reports/fleet-reconciliation',method:'GET'}),false);
  assert.equal((await request('/api/reports/fleet-reconciliation?'+new URLSearchParams({site,date:'2026-02-30',shift:'S1'}))).status,400);
 }finally{await new Promise(r=>server.close(r));await pool.close()}
});
