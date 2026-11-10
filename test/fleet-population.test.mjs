import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerProductionReports} from '../server/routes/production-report-api.mjs';
import {misRequestAllowed} from '../shared/mis-application-access.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';

test('fleet capacity seeds once, supports admin edits and counts only assigned fleet locations',async t=>{
 const db=new PGlite();
 t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id bigint,master_name text,record_data jsonb)');
 const assets=[
  {group:'Excavator',make:'VOLVO',model:'EC480',currentLocation:'Sasti OB',location:'Majri'},
  {group:'EXCAVATORS',make:'Volvo',model:'ec480',location:'Sasti'},
  {group:'Tipper',location:'Sasti'},
  {group:'Excavator',make:'Volvo',model:'EC480',location:'Sasti',sourceMissing:true},
  {group:'Excavator',make:'Volvo',model:'EC480',location:'Majri'}
 ];
 for(const [id,asset] of assets.entries())await db.query("INSERT INTO master_records VALUES($1,'Equipment master',$2)",[id,asset]);
 const pool={query:(sql,args)=>args?db.query(sql,args):db.exec(sql).then(results=>results.at(-1))};
 const app=express();
 app.use(express.json());
 const auth=(req,res,next)=>{
  const admin=req.get('Authorization')==='admin';
  req.session={role:'super',login:'tester',permissions:{separateMisCredentials:true,misDesktopAccess:admin?['Users & employees','Equipment master','Reports']:['Reports']}};
  req.logBookScope={sites:[canonicalSiteName('Sasti')]};
  return misRequestAllowed(req.session,req)?next():res.sendStatus(403);
 };
 registerProductionReports(app,{pool,protect:[auth],ensureBooks:async()=>{}});
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>{server.closeAllConnections();server.close()});
 const call=(path,auth='reader',body)=>fetch('http://127.0.0.1:'+server.address().port+path,{
  method:body?'PUT':'GET',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(body)
 });
 const master='/api/capacity-master/fleet';
 assert.equal((await call(master)).status,403);
 const seed=await (await call(master,'admin')).json();
 assert.equal(seed.rows.length,22,JSON.stringify(seed));
 const change={make:'VOLVO',model:'EC480',bucketCapacity:3.1,dailyCapacity:5100};
 assert.equal((await call(master,'reader',change)).status,403);
 assert.equal((await call(master,'admin',{...change,dailyCapacity:-1})).status,400);
 const saved=await (await call(master,'admin',change)).json();
 assert.equal(saved.rows.length,22);
 const report=await (await call('/api/reports/fleet-population')).json();
 const site=canonicalSiteName('Sasti');
 assert.deepEqual(report.sites.map(s=>s.key),[site]);
 const model=report.capacity.find(row=>row.model==='EC480');
 assert.equal(model.population[site],2);
 assert.equal(model.dailyCapacity,5100);
 assert.equal(report.deployment.find(row=>row.equipment==='Excavator').population[site],2);
 assert.equal(report.deployment.find(row=>row.equipment==='Dumper/Tipper').population[site],1);
});
