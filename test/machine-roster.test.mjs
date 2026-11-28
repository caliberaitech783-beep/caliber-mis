// Owner, 25 Nov 2026: Masters › Machine Roster, the site-wise list of every vehicle and equipment in the Equipment
// Master, by book (VLB Vehicle, ELB Equipment, LMV), with the same rules as the batch page's machine coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {machineRoster,machinesOf,ROSTER_VIEWS} from '../shared/machine-roster.mjs';
import {siteRoster} from '../shared/batch-fleet-coverage.mjs';
import {registerCaliberRecheck} from '../server/routes/caliber-recheck.mjs';
import {misPageAllowed,misRequestAllowed} from '../shared/mis-application-access.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';

const SASTI='Sasti OC',MAJRI='Majri OC';
const assets=[
 ['1',{door:'T11',category:'VEHICLE',group:'Tipper',currentLocation:SASTI,make:'Tata',model:'Signa'}],
 ['2',{door:'T2',category:'VEHICLE',group:'Tipper',currentLocation:SASTI}],
 ['3',{door:'TPC65',category:'EQUIPMENT',group:'Excavator',currentLocation:SASTI}],
 ['4',{door:'LMV-07',category:'LMV',group:'Bolero',currentLocation:SASTI}],
 ['5',{door:'PL05',category:'',group:'Pay Loader',currentLocation:SASTI}],
 ['6',{door:'T99',category:'VEHICLE',group:'Tipper',currentLocation:SASTI,status:'Scrapped'}],
 ['7',{door:'T40',category:'VEHICLE',group:'Tipper',currentLocation:MAJRI}],
];

test('one line per site counts its active machines by book, as the batch coverage does',()=>{
 const roster=machineRoster(assets);
 const sasti=roster.sites.find(row=>row.site===SASTI);
 assert.deepEqual([sasti.vlb,sasti.elb,sasti.lmv,sasti.all,sasti.unset,sasti.inactive],[2,2,1,5,1,1]);
 const coverage=siteRoster(assets.map(([id,record])=>({id,...record})),SASTI);
 assert.deepEqual([coverage.vehicle.length,coverage.equipment.length,coverage.lmv.length],[sasti.vlb,sasti.elb,sasti.lmv],'the same machines a batch answers for');
 assert.deepEqual([roster.total.all,roster.total.vlb,roster.total.inactive],[6,3,1]);
 assert.deepEqual(roster.sites.map(row=>row.site),[MAJRI,SASTI]);
 assert.deepEqual(ROSTER_VIEWS.map(view=>view.key),['vlb','elb','lmv','all','unset','inactive']);
});

test('every figure opens the machines behind it, with the master details',()=>{
 const {machines}=machineRoster(assets),key=machines.find(m=>m.site===SASTI).siteKey;
 assert.deepEqual(machinesOf(machines,key,'vlb').map(m=>m.door),['T2','T11']);
 assert.deepEqual(machinesOf(machines,key,'elb').map(m=>m.door),['PL05','TPC65']);
 assert.deepEqual(machinesOf(machines,key,'unset').map(m=>[m.door,m.bookLabel,m.categorySet]),[['PL05','ELB',false]]);
 assert.deepEqual(machinesOf(machines,key,'inactive').map(m=>[m.door,m.status]),[['T99','Scrapped']]);
 assert.deepEqual(machinesOf(machines,'*','vlb').map(m=>m.door),['T40','T2','T11']);
 const tipper=machines.find(m=>m.door==='T11');
 assert.deepEqual([tipper.bookLabel,tipper.category,tipper.group,tipper.make,tipper.model],['VLB','VEHICLE','Tipper','Tata','Signa']);
});

test('the route lists only the sites of the login, from the Equipment master',async()=>{
 const app=express();
 const rows=[...assets.map(([id,record_data])=>({id,master_name:'Equipment master',record_data})),{id:'90',master_name:'Employee master',record_data:{name:'X',currentLocation:SASTI}}];
 registerCaliberRecheck(app,{pool:{query:async()=>({rows:[]})},requireSession:(req,res,next)=>{req.session={login:'sasti.mis',role:'super',permissions:{}};next()},requireAdministrator:(req,res,next)=>next(),
  getSiteScope:async()=>({sites:[canonicalSiteName(SASTI)]}),readMasters:async()=>({rows}),hrPunches:async()=>({sites:[],punches:[]})});
 const server=app.listen(0);
 try{
  const answer=await (await fetch('http://127.0.0.1:'+server.address().port+'/api/caliber-recheck/roster')).json();
  assert.deepEqual(answer.sites.map(row=>row.site),[SASTI]);
  assert.equal(answer.machines.length,6);
  assert.equal(answer.total.all,5);
 }finally{server.close();}
});

test('Masters › Machine Roster sits after Equipment master, for the people of Caliber ID Re-check, read only',()=>{
 const login=pages=>({permissions:{separateMisCredentials:true,misDesktopAccess:pages,misMobileAccess:[]}});
 assert.equal(misPageAllowed(login(['Vehicle Log Book']),'Machine Roster','desktop'),true);
 assert.equal(misPageAllowed(login(['Reports']),'Machine Roster','desktop'),false);
 assert.equal(misRequestAllowed(login(['Vehicle Log Book']),{path:'/api/caliber-recheck/roster',method:'GET'}),true);
 assert.equal(misRequestAllowed(login(['Vehicle Log Book']),{path:'/api/caliber-recheck/roster',method:'POST'}),false);
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/'Equipment master','Machine Roster',(?:'Attendance approval',(?:'VTC Master','OD Master',)?)?'Capacity master'/);
 assert.match(main,/renderedActive==='Machine Roster' \? \(<MachineRoster /);
 const page=readFileSync(new URL('../src/machine-roster.jsx',import.meta.url),'utf8');
 assert.match(page,/title="Step 1 · Machine roster/);assert.match(page,/'Step 2 · Machine roster · '/);
 assert.doesNotMatch(page,/method:'POST'/);
});
