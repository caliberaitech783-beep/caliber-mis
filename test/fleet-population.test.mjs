import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerProductionReports} from '../server/routes/production-report-api.mjs';
import {misRequestAllowed} from '../shared/mis-application-access.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {fleetPopulationReports,deploymentTableRows} from '../shared/fleet-population.mjs';

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
 assert.equal(report.deploymentByCategory.find(row=>row.equipment==='Excavator').population[site],2,'the by-category list is sent too');
});

test('Equipment Deployment by category: groups under the master category, a subtotal after each, the grand total last',()=>{
 const locations=['Sasti','Jayant'],sasti=canonicalSiteName('Sasti'),jayant=canonicalSiteName('Jayant');
 const assets=[
  {group:'Excavator',category:'EQUIPMENT',location:'Sasti'},{group:'EXCAVATORS',category:'Equipment',location:'Jayant'},
  {group:'Dozer',category:' equipment ',location:'Sasti'},
  {group:'Tipper',category:'VEHICLE',location:'Sasti'},{group:'WATER TANKER',category:'VEHICLE',location:'Jayant'},
  // A tanker Pulse has already moved to LMV is counted there, beside the ones still under Vehicle.
  {group:'WATER TANKER',category:'LMV',location:'Sasti'},
  {group:'HAULPAK DUMPER',category:'VEHICLE',location:'Jayant'},
  {group:'Excavator',location:'Sasti'},
  {group:'Excavator',category:'EQUIPMENT',location:'Sasti',sourceMissing:true},{group:'Excavator',category:'EQUIPMENT',location:'Elsewhere'}];
 const report=fleetPopulationReports({assets,locations,capacities:[]});
 const lines=report.deploymentByCategory.map(row=>[row.categoryLabel,row.equipment,row.population[sasti]||0,row.population[jayant]||0]);
 assert.deepEqual(lines.slice(0,3),[['Equipment','Excavator',1,1],['Equipment','Surface Miner',0,0],['Equipment','Payloader',0,0]]);
 assert.deepEqual(lines.filter(([category])=>category!=='Equipment'),[
  ['Vehicle','Dumper/Tipper',1,0],['Vehicle','Water Tanker',0,1],['Vehicle','Diesel Bowser',0,0],['Vehicle','Service Van',0,0],['Vehicle','HAULPAK DUMPER',0,1],
  ['LMV','Water Tanker',1,0],
  ['No category in the master','Excavator',1,0]],'standard groups first, others A to Z; no category last');
 assert.deepEqual(lines.filter(([category])=>category==='Equipment').map(line=>line[1]),['Excavator','Surface Miner','Payloader','Dozer','Drill','Grader','Crane','Rock Breaker'],'an empty standard group stays, as 0, under its kind');
 assert.equal(report.deployment.find(row=>row.equipment==='Water Tanker').population[sasti],1,'the by-group list (read by the Pulse check) is unchanged');
 const table=deploymentTableRows(report.deploymentByCategory,[sasti,jayant]);
 const subtotals=table.filter(row=>row.kind==='subtotal').map(row=>[row.equipment,row.population[sasti],row.population[jayant],row.total,row.groups]);
 assert.deepEqual(subtotals,[['Equipment subtotal',2,1,3,8],['Vehicle subtotal',1,2,3,5],['LMV subtotal',1,0,1,1],['No category in the master subtotal',1,0,1,1]]);
 const total=table.at(-1);
 assert.deepEqual([total.kind,total.equipment,total.population[sasti],total.population[jayant],total.total],['total','Total',5,3,8]);
 assert.deepEqual(table.slice(0,9).map(row=>row.kind),[...Array(8).fill('group'),'subtotal'],'each category ends with its subtotal');
 assert.equal(table.find(row=>row.equipment==='Excavator').total,2);
 assert.equal(new Set(table.map(row=>row.id)).size,table.length,'every line has its own key');
});
