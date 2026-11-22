// Owner, 22 Nov 2026: a card for one site carries a driver of another site. The card waits for a person; on
// "Fetch from Pulse-II" an OTP is asked and, on the OTP, the driver's site changes permanently, for salary and
// everything else. After that the site must never go back by itself: "make a hard code for it".
//   - the OTP goes to the Project Manager of the site the driver is leaving, and names the driver, both sites, the
//     card date, the vehicle and who asked;
//   - the move takes effect from the card's date, so an older card still finds the driver at the old site;
//   - nothing else changes a worker's site: Employee Master edit, Employee Current Location, the Excel import,
//     the ERP copy and HR's import all leave it alone;
//   - every move is one line in the register HR reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {transformWithOxc} from 'vite';
import {employeeSiteOn,planSiteMove,siteMoves,changesSite,sameSite,siteKey,SITE_CHANGE_REFUSAL} from '../shared/employee-site-moves.mjs';
import {employeeAtLocation} from '../shared/log-book-access.mjs';
import {judgeCaliberId,caliberCheckMessage} from '../shared/caliber-id-check.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {registerErpEmployees} from '../server/routes/erp-employee-source.mjs';
import {registerEmployeeSiteMoves,siteMoveMessage,applyEmployeeSiteMove} from '../server/routes/employee-site-move.mjs';
import {registerEmployeeMaster,importEmployees,keepEmployeeSite} from '../server/routes/employee-master.mjs';
import {planErpEmployees} from '../server/services/erp-employee-sync.mjs';
import {readHrMasterSheet,planHrMaster} from '../shared/hr-employee-master.mjs';
import {automationForEventKey} from '../server/services/automation-switches.mjs';
import {AUTOMATIONS} from '../server/rules/automation-catalogue.mjs';
import {OTP_MAX_ATTEMPTS} from '../shared/otp-approval.mjs';
import {siteMoveSheets} from '../src/employee-site-move-sheet.mjs';

const MAJRI='Majri OC',SASTI='Sasti OC';
const person=(number,name,designation,site,extra={})=>({caliberId:'CMPL'+number,caliberCode:'CMLL'+number,name,currentDesignationName:designation,site,currentLocation:site,hrListed:true,hrLeft:false,status:'Active',employeeMasterRevision:3,panNo:'KEEP'+number,...extra});
const moved=(record,to,fromDate,at='2026-11-23T05:00:00.000Z')=>({...record,...planSiteMove(record,{to,fromDate,at,by:'sasti.operator',approvedBy:['majri.pm']}).patch});

test('one key for every spelling of a site, and a worker with no site is not "changed" by getting one',()=>{
 assert.equal(sameSite('MAJRI OB','Majri OC'),true);assert.equal(sameSite('Majri OC','Sasti OC'),false);
 assert.equal(siteKey('Majri OC'),canonicalSiteName('Majri OC'));
 assert.equal(changesSite({site:'Majri OC'},{site:'MAJRI OB'}),false);
 assert.equal(changesSite({site:'Majri OC'},{site:'Sasti OC'}),true);
 assert.equal(changesSite({site:'Majri OC'},{site:''}),true,'a site cannot be cleared');
 assert.equal(changesSite({site:''},{site:'Sasti OC'}),false,'the first site is not a change');
 assert.equal(changesSite({currentLocation:'Majri OC'},{site:'Sasti OC'}),true);
});

test('the move takes effect from the card date: earlier cards still find the worker at the old site',()=>{
 const before=person(1610,'MOVING MAN','TIPPER DRIVER',MAJRI);
 assert.equal(employeeSiteOn(before,'2026-11-20'),MAJRI);assert.equal(siteMoves(before).length,0);
 const plan=planSiteMove(before,{to:'SASTI OB',fromDate:'2026-11-20',at:'2026-11-23T05:00:00.000Z',by:'sasti.operator',approvedBy:['majri.pm'],card:{door:'V942'}});
 assert.deepEqual(plan.move,{from:MAJRI,to:SASTI,fromDate:'2026-11-20',at:'2026-11-23T05:00:00.000Z',by:'sasti.operator',approvedBy:['majri.pm'],card:{door:'V942'}});
 assert.deepEqual([plan.patch.site,plan.patch.currentLocation,plan.patch.siteLockedAt,plan.patch.siteLockedBy,plan.latest],[SASTI,SASTI,'2026-11-23T05:00:00.000Z','sasti.operator',true]);
 const after={...before,...plan.patch};
 assert.equal(employeeSiteOn(after,'2026-11-19'),MAJRI,'the day before the move');
 assert.equal(employeeSiteOn(after,'2026-11-20'),SASTI);assert.equal(employeeSiteOn(after,'2026-12-31'),SASTI);
 assert.equal(employeeSiteOn(after),SASTI,'no date: the site held today');
 assert.equal(employeeAtLocation(after,MAJRI,'2026-11-19'),true);assert.equal(employeeAtLocation(after,SASTI,'2026-11-19'),false);
 assert.equal(employeeAtLocation(after,SASTI,'2026-11-20'),true);assert.equal(employeeAtLocation(after,MAJRI,'2026-11-20'),false);
 assert.equal(employeeAtLocation(after,SASTI),true);assert.equal(employeeAtLocation(after,MAJRI),false);
 assert.equal(planSiteMove(after,{to:SASTI,fromDate:'2026-11-25'}),null,'already at that site on that date');

 // A Sasti card of an earlier date turns up later: the move is taken back to that date, today's site stays.
 const earlier=planSiteMove(after,{to:SASTI,fromDate:'2026-11-18',at:'2026-11-24T05:00:00.000Z',by:'sasti.operator',approvedBy:['majri.pm']});
 assert.deepEqual([earlier.move.from,earlier.move.to,earlier.latest,earlier.patch.site],[MAJRI,SASTI,false,undefined]);
 const twice={...after,...earlier.patch};
 assert.deepEqual(['2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-30'].map(date=>employeeSiteOn(twice,date)),[MAJRI,SASTI,SASTI,SASTI,SASTI]);
 assert.equal(twice.site,SASTI);

 // Back to Majri later is another deliberate, approved move; nothing else undoes the first one.
 const back=planSiteMove(twice,{to:MAJRI,fromDate:'2026-12-05',at:'2026-12-05T05:00:00.000Z',by:'majri.operator',approvedBy:['sasti.pm']});
 assert.deepEqual([back.move.from,back.move.to,back.latest,back.patch.site],[SASTI,MAJRI,true,MAJRI]);
 const home={...twice,...back.patch};
 assert.deepEqual(['2026-11-17','2026-11-19','2026-12-04','2026-12-05'].map(date=>employeeSiteOn(home,date)),[MAJRI,SASTI,SASTI,MAJRI]);
 assert.throws(()=>planSiteMove(before,{to:SASTI,fromDate:'20-11-2026'}),/card date/);
 assert.throws(()=>planSiteMove(before,{to:'Nowhere',fromDate:'2026-11-20'}),/site of the card/);
});

test('the scan judges a moved driver by the site of the card date',()=>{
 const masters=[{id:1,master_name:'Employee master',record_data:moved(person(1610,'MOVING MAN','TIPPER DRIVER',MAJRI),SASTI,'2026-11-20')},
  {id:2,master_name:'Employee master',record_data:person(1618,'LOOK ALIKE','VOLVO DRIVER',MAJRI)}];
 const judge=(location,date)=>judgeCaliberId(masters,{read:'1610',location,date});
 assert.equal(judge(SASTI,'2026-11-21').employee.id,1);
 assert.equal(judge(MAJRI,'2026-11-19').employee.id,1,'an older Majri card is not held, and does not move the driver back');
 const old=judge(SASTI,'2026-11-19').check;
 assert.deepEqual([old.reason,old.site],['other-site',MAJRI],'at Sasti before the move date the driver still belongs to Majri');
 const late=judge(MAJRI,'2026-11-21').check;
 assert.deepEqual([late.reason,late.site],['other-site',SASTI]);
 assert.match(caliberCheckMessage(late),/^Scan read 1610\. This is MOVING MAN, TIPPER DRIVER, Sasti OC\. The number may be misread\. Look-alike IDs at Majri OC: 1618 \(LOOK ALIKE\)\. If the number is right, press Fetch to move this person here with OTP\.$/);
});

const fixture=async({scope={sites:null,label:'All sites'},pm={[canonicalSiteName(MAJRI)]:['majri.pm'],[canonicalSiteName(SASTI)]:['sasti.pm']}}={})=>{
 const db=new PGlite();
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 const people=[person(1610,'MOVING MAN','TIPPER DRIVER',MAJRI),person(4401,'SASTI DRIVER','VOLVO DRIVER',SASTI),person(2100,'LEFT MAN','DRIVER',MAJRI,{hrLeft:true,status:'Left'}),
  person(2000,'NOT LISTED','DRIVER',MAJRI,{hrListed:false}),person(3000,'RESIGNED MAN','DRIVER',MAJRI,{status:'Resigned',hrListed:undefined,hrLeft:undefined}),
  person(7000,'NO SITE MAN','DRIVER',''),person(8000,'JAYANT MAN','DRIVER','Jayant OC')];
 for(const record of people)await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Employee master',$1)",[JSON.stringify(record)]);
 const query=(sql,params)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!params&&sql.includes(';')?db.exec(sql):db.query(sql,params);
 const pool={query,connect:async()=>({query,release(){}})};
 const sent=[],audits=[],state={deliver:true,login:'sasti.operator',name:'Sasti Operator'};
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{res.on('finish',()=>{if(req.audit)audits.push(req.audit)});next()});
 const requireSession=(req,res,next)=>{req.session={login:state.login,name:state.name};next()},allow=(req,res,next)=>next();
 registerErpEmployees(app,{pool,requireSession,requireAdministrator:allow,getSiteScope:async()=>scope});
 registerEmployeeSiteMoves(app,{pool,requireSession,requireAdministrator:allow,getSiteScope:async()=>scope,
  pmLogins:async(client,site)=>pm[canonicalSiteName(site)]||[],
  deliver:async request=>{sent.push(request);return state.deliver?{sentTo:request.logins,channels:['telegram'],failures:[]}:{sentTo:[],channels:[],failures:['majri.pm: not linked']};}});
 registerEmployeeMaster(app,{pool,requireSession,requireAdministrator:allow});
 const server=app.listen(0),base='http://127.0.0.1:'+server.address().port;
 const call=async(path,body,method=body?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>({}))};};
 const record=async id=>(await db.query('SELECT record_data FROM master_records WHERE id=$1',[id])).rows[0].record_data;
 const lookup=(caliberId,location,bookDate,scan=true)=>call('/api/log-books/employee-lookup'+(scan?'?scan=1':''),{caliberId,location,bookDate});
 const askOtp=(caliberId,location=SASTI,bookDate='2026-11-20',card={door:'V942',cardNo:'A-5512',cardId:'c1',batchId:'b1'})=>call('/api/log-books/employee-site-move',{caliberId,location,bookDate,card});
 const verify=(id,otp)=>call('/api/log-books/employee-site-move/'+id+'/verify',{otp});
 return {db,pool,call,record,lookup,askOtp,verify,sent,audits,state,close:async()=>{server.close();await db.close();}};
};

test('Fetch from Pulse-II with OTP: asked of the PM of the site being left, then the worker moves from the card date',async()=>{
 const f=await fixture();
 try{
  // The Fetch box is told what the move would be, after the refusal that names the worker.
  const refused=await f.lookup('1610',SASTI,'2026-11-20');
  assert.equal(refused.status,403);
  assert.equal(refused.body.error,'This is MOVING MAN, TIPPER DRIVER, Majri OC. This number is not at Sasti OC. Check the number on the card.');
  assert.deepEqual(refused.body.siteMove,{employeeId:'CMPL1610',name:'MOVING MAN',designation:'TIPPER DRIVER',from:MAJRI,to:SASTI,fromDate:'2026-11-20'});
  assert.equal((await f.lookup('1610',SASTI,'')).body.siteMove,undefined,'no card date, no move offered');
  assert.equal((await f.lookup('3000',SASTI,'2026-11-20')).body.siteMove,undefined,'never offered for a person who has resigned');
  assert.equal((await f.lookup('2000',SASTI,'2026-11-20')).body.siteMove,undefined,"never offered for a person who is not on HR's list");

  const asked=await f.askOtp('1610');
  assert.equal(asked.status,201);
  assert.deepEqual(asked.body.move,{employeeId:'CMPL1610',name:'MOVING MAN',designation:'TIPPER DRIVER',from:MAJRI,to:SASTI,fromDate:'2026-11-20'});
  assert.deepEqual([asked.body.otp.sentTo,asked.body.otp.channels,asked.body.otp.status,asked.body.otp.attempts],[['majri.pm'],['telegram'],'sent',0]);
  assert.equal(JSON.stringify(asked.body).includes(f.sent[0].otp),false,'the OTP itself never comes back to the screen');
  assert.deepEqual(f.sent[0].logins,['majri.pm'],'the Project Manager of the site the worker is leaving');
  assert.match(f.sent[0].eventKey,/^employee-move-otp:[0-9a-f-]{36}$/);
  assert.equal(f.sent[0].message,['Caliber Pulse: site change of a driver / operator','CMPL1610 MOVING MAN (TIPPER DRIVER) is on a card at Sasti OC but belongs to Majri OC.',
   "Move: Majri OC -> Sasti OC, from 20-11-2026 (the card's date), vehicle / machine V942.",'Requested by Sasti Operator.',
   `OTP ${f.sent[0].otp}, valid 10 minutes. Share it only if this person has moved to Sasti OC.`,'On the OTP the site changes for salary and every record, and it does not change back by itself.'].join('\n'));
  assert.equal((await f.record(1)).site,MAJRI,'asking changes nothing');
  assert.equal((await f.askOtp('1610')).status,429,'one request a minute');

  // A wrong OTP is counted, and the count is kept.
  const wrong=String((Number(f.sent[0].otp)+1)%1000000).padStart(6,'0').replace(/^0/,'1');
  const first=await f.verify(asked.body.otp.id,wrong);
  assert.equal(first.status,400);assert.equal(first.body.error,`Wrong OTP. ${OTP_MAX_ATTEMPTS-1} attempts left.`);
  assert.equal((await f.db.query('SELECT attempts FROM mis_employee_site_move_otps WHERE id=$1',[asked.body.otp.id])).rows[0].attempts,1);
  assert.equal((await f.verify(asked.body.otp.id,'12')).body.error,'Enter the six-digit OTP.');
  assert.equal((await f.record(1)).site,MAJRI);

  const done=await f.verify(asked.body.otp.id,f.sent[0].otp);
  assert.equal(done.status,200);
  assert.deepEqual([done.body.id,done.body.name,done.body.caliberId,done.body.site],['1','MOVING MAN','CMPL1610',SASTI]);
  assert.deepEqual(done.body.moved,{from:MAJRI,to:SASTI,fromDate:'2026-11-20',latest:true});
  const saved=await f.record(1);
  assert.deepEqual([saved.site,saved.currentLocation,saved.siteLockedBy,saved.panNo,saved.name,saved.employeeMasterRevision],[SASTI,SASTI,'sasti.operator','KEEP1610','MOVING MAN',4]);
  assert.match(saved.siteLockedAt,/^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(saved.siteMoves.map(move=>[move.from,move.to,move.fromDate,move.by,move.approvedBy,move.card.door]),[[MAJRI,SASTI,'2026-11-20','sasti.operator',['majri.pm'],'V942']]);
  assert.equal((await f.verify(asked.body.otp.id,f.sent[0].otp)).body.error,'This OTP was already used.');

  // The card goes on: the Fetch box now finds the worker at Sasti for that date, and at Majri for an older card.
  assert.equal((await f.lookup('1610',SASTI,'2026-11-20')).body.name,'MOVING MAN');
  assert.equal((await f.lookup('1610',MAJRI,'2026-11-19')).body.name,'MOVING MAN');
  assert.equal((await f.lookup('1610',MAJRI,'2026-11-21')).status,403);
  assert.equal((await f.askOtp('1610',SASTI,'2026-11-22')).body.error,'MOVING MAN already belongs to Sasti OC on this date. Press Fetch again.');

  // The register HR reads, and the audit trail.
  const register=await f.call('/api/employee-master/site-moves');
  assert.equal(register.body.moves.length,1);
  const line=register.body.moves[0];
  assert.deepEqual([line.employeeId,line.name,line.designation,line.from,line.to,line.fromDate,line.requestedBy,line.approvedBy,line.card.door,line.card.cardNo],['CMPL1610','MOVING MAN','TIPPER DRIVER',MAJRI,SASTI,'2026-11-20','Sasti Operator',['majri.pm'],'V942','A-5512']);
  assert.deepEqual(siteMoveSheets(register.body.moves)[0].rows[0].slice(0,8),['CMPL1610','MOVING MAN','TIPPER DRIVER',MAJRI,SASTI,'20-11-2026','Sasti Operator','majri.pm']);
  assert.deepEqual(f.audits.map(audit=>audit.action),['Ask for site move OTP','Move employee to another site by OTP']);
  assert.deepEqual(f.audits[1].changedFields,[{field:'Site',before:MAJRI,after:SASTI}]);
 }finally{await f.close();}
});

test('the OTP cannot be asked when nobody can approve, and five wrong codes end it',async()=>{
 const f=await fixture();
 try{
  assert.deepEqual([(await f.askOtp('99999')).status,(await f.askOtp('2000')).status],[404,404],"unknown, or not on HR's list");
  assert.equal((await f.askOtp('2100')).status,404,'HR says left');
  assert.equal((await f.askOtp('3000')).body.error,'Employee Master says this person has left. Check the number on the card.');
  assert.equal((await f.askOtp('4401')).body.error,'SASTI DRIVER already belongs to Sasti OC on this date. Press Fetch again.');
  assert.equal((await f.askOtp('7000')).body.error,'This person has no site in Employee Master yet. Give the site on Employee Master first.');
  assert.equal((await f.askOtp('8000')).body.error,"No Project Manager is assigned to Jayant OC, so the OTP cannot be sent. Ask HR to correct the site in HR's master Excel.");
  assert.equal((await f.askOtp('1610',SASTI,'')).body.error,'The card date is needed to move a worker to another site.');
  assert.equal((await f.askOtp('1610','')).status,400);
  f.state.deliver=false;
  const unsent=await f.askOtp('1610');
  assert.equal(unsent.status,409);assert.match(unsent.body.error,/^The Project Manager of Majri OC has no Telegram or mobile registered\. majri\.pm: not linked$/);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM mis_employee_site_move_otps')).rows[0].n,0,'no OTP is kept when none was delivered');
  f.state.deliver=true;

  const asked=await f.askOtp('1610');
  const wrong=f.sent.at(-1).otp==='111111'?'222222':'111111';
  let last;for(let i=0;i<OTP_MAX_ATTEMPTS;i++)last=await f.verify(asked.body.otp.id,wrong);
  assert.equal(last.body.error,'Too many wrong attempts. Request a new OTP.');
  assert.equal((await f.verify(asked.body.otp.id,f.sent.at(-1).otp)).body.error,'This OTP was cancelled. Request a new OTP.','the right code no longer works');
  assert.equal((await f.record(1)).site,MAJRI);
  assert.equal((await f.verify('not-an-id','123456')).status,400);
  assert.equal((await f.call('/api/employee-master/site-moves')).body.moves.length,0);
 }finally{await f.close();}
});

test('a login of one site can ask only for a card of its own site',async()=>{
 const f=await fixture({scope:{sites:[canonicalSiteName(SASTI)],label:SASTI}});
 try{
  assert.equal((await f.askOtp('4401',MAJRI)).status,403,'not for a card of another site');
  const asked=await f.askOtp('1610',SASTI);
  assert.equal(asked.status,201);
  assert.equal((await f.verify(asked.body.otp.id,f.sent[0].otp)).status,200);
 }finally{await f.close();}
});

test('the hard lock: nothing but an approved move changes a worker\'s site',async()=>{
 const f=await fixture();
 try{
  const asked=await f.askOtp('1610');
  assert.equal((await f.verify(asked.body.otp.id,f.sent[0].otp)).status,200);
  const locked=await f.record(1);
  const untouched=async label=>{const now=await f.record(1);assert.deepEqual([now.site,now.currentLocation,now.siteMoves.length,now.siteLockedAt],[SASTI,SASTI,1,locked.siteLockedAt],label);return now;};

  // 1. Employee Master edit: asking for another Current Location is refused, and nothing of the edit is saved.
  const edit=await f.call('/api/employee-master/1',{...locked,name:'RENAMED',currentLocation:MAJRI},'PUT');
  assert.equal(edit.status,409);assert.equal(edit.body.error,SITE_CHANGE_REFUSAL);
  assert.equal((await untouched('Employee Master edit')).name,'MOVING MAN');
  // Any other edit goes through and keeps the site exactly, whatever the form sends back for the old ERP location.
  const rename=await f.call('/api/employee-master/1',{...locked,name:'MOVING MAN SR',locationName:'MAJRI OB (ERP)'},'PUT');
  assert.equal(rename.status,200);
  assert.deepEqual([(await untouched('an edit of another field')).name,(await f.record(1)).locationName],['MOVING MAN SR','MAJRI OB (ERP)']);

  // 2. Employee Current Location.
  const revision=(await f.record(1)).employeeMasterRevision;
  const place=await f.call('/api/employee-master/location/1',{currentLocation:MAJRI,revision},'PUT');
  assert.equal(place.status,409);assert.equal(place.body.error,SITE_CHANGE_REFUSAL);
  await untouched('Employee Current Location');
  assert.equal((await f.call('/api/employee-master/location/6',{currentLocation:MAJRI,revision:3},'PUT')).status,200,'a worker with no site can still be given one');
  assert.equal((await f.record(6)).site,MAJRI);

  // 3. The Excel import of the Employee Master Report.
  await importEmployees(f.pool,[{caliberId:'CMPL1610',name:'MOVING MAN SR',locationName:'MAJRI OB',currentLocation:MAJRI}]);
  await untouched('Employee Master Report import');

  // 4. The hourly ERP copy.
  const rows=(await f.db.query("SELECT id,master_name,record_data FROM master_records WHERE master_name='Employee master'")).rows;
  const erp=planErpEmployees(rows,rows.map(row=>({caliberId:row.record_data.caliberId,employeeCode:'E'+row.id,name:row.record_data.name,locationName:'MAJRI OB',currentDesignationName:'TIPPER DRIVER'})));
  const copied=erp.updates.find(update=>String(update.id)==='1').data;
  assert.deepEqual([copied.site,copied.currentLocation,copied.siteMoves.length,copied.siteLockedAt],[SASTI,SASTI,1,locked.siteLockedAt],'the ERP copy');

  // 5. HR's master Excel, even with "Also take HR's site" ticked.
  const HEAD=['Serial No','EMPLOYEE ID','NAME','REGION','SITE / OFFICE','DEPARTMENT','DESIGNATION','CATEGORY','REPORTING TO','CONTACT','EMAIL','STATUS'];
  const sheet=readHrMasterSheet([HEAD,[1,'CMLL1610','MOVING MAN SR','WCL','Majri OB','PRODUCTION','TIPPER DRIVER','TEMPORARY',null,null,null,'ACTIVE'],[2,'CMLL4401','SASTI DRIVER','WCL','Majri OB','PRODUCTION','VOLVO DRIVER','TEMPORARY',null,null,null,'ACTIVE']]);
  const hr=planHrMaster(rows.map(row=>row.id===1?{...row,record_data:locked}:row),sheet.records,{applySites:true});
  assert.equal(hr.updates.find(update=>update.id==='1')?.patch.site,undefined,"HR's import leaves a moved worker's site alone");
  assert.deepEqual(hr.lists.siteKept.map(row=>[row.employeeId,row.reason]),[['CMPL1610','Site set by an approved move']]);
  assert.equal(hr.updates.find(update=>update.id==='2').patch.site,MAJRI,'a worker who was never moved by OTP still takes HR\'s site when it is ticked');

  // 6. Another approved move is the one thing that does change it.
  f.state.login='majri.operator';f.state.name='Majri Operator';
  const back=await f.askOtp('1610',MAJRI,'2026-12-05');
  assert.deepEqual(f.sent.at(-1).logins,['sasti.pm'],'now Sasti is the site being left');
  assert.equal((await f.verify(back.body.otp.id,f.sent.at(-1).otp)).status,200);
  const home=await f.record(1);
  assert.deepEqual([home.site,home.siteMoves.map(move=>move.to),employeeSiteOn(home,'2026-11-19'),employeeSiteOn(home,'2026-11-25'),employeeSiteOn(home,'2026-12-05')],[MAJRI,[SASTI,MAJRI],MAJRI,SASTI,MAJRI]);
  assert.equal((await f.call('/api/employee-master/site-moves')).body.moves.length,2);
 }finally{await f.close();}
});

test('the edit rule by itself: a different Current Location is refused, the site is otherwise carried over',()=>{
 const prior={site:SASTI,currentLocation:SASTI,locationName:'MAJRI OB'};
 assert.throws(()=>keepEmployeeSite(prior,{currentLocation:MAJRI,site:MAJRI}),error=>error.status===409&&error.message===SITE_CHANGE_REFUSAL);
 assert.throws(()=>keepEmployeeSite(prior,{currentLocation:'',site:'MAJRI OB'}),error=>error.status===409);
 assert.deepEqual(keepEmployeeSite(prior,{currentLocation:SASTI,site:'whatever the form worked out'}),{currentLocation:SASTI,site:SASTI});
 assert.deepEqual(keepEmployeeSite(prior,{currentLocation:'SASTI OB',site:'SASTI OB'}),{currentLocation:SASTI,site:SASTI},'another spelling of the same site is not a change');
 assert.deepEqual(keepEmployeeSite({site:'',currentLocation:''},{currentLocation:MAJRI,site:MAJRI}),{currentLocation:MAJRI,site:MAJRI},'the first site');
});

test('the move in one transaction: the employee and the register line are written together',async()=>{
 const f=await fixture();
 try{
  await f.pool.query(readFileSync(new URL('../server/routes/employee-site-move.mjs',import.meta.url),'utf8').match(/EMPLOYEE_SITE_MOVE_SCHEMA=`([\s\S]*?)`;/)[1]);
  const outcome=await applyEmployeeSiteMove(f.pool,{employeeId:1,to:SASTI,fromDate:'2026-11-20',requestedBy:'sasti.operator',requestedName:'Sasti Operator',approvedBy:['majri.pm'],card:{door:'V942'}});
  assert.deepEqual([outcome.move.from,outcome.move.to,outcome.move.latest,outcome.row.record_data.site],[MAJRI,SASTI,true,SASTI]);
  const again=await applyEmployeeSiteMove(f.pool,{employeeId:1,to:SASTI,fromDate:'2026-11-21',requestedBy:'sasti.operator',approvedBy:['majri.pm']});
  assert.equal(again.move,null,'already there: nothing is written');
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM mis_employee_site_moves')).rows[0].n,1);
  await assert.rejects(applyEmployeeSiteMove(f.pool,{employeeId:999,to:SASTI,fromDate:'2026-11-20',requestedBy:'x'}),/no longer in Employee Master/);
 }finally{await f.close();}
});

test('the OTP message has its own line in the Automation Centre',()=>{
 assert.equal(automationForEventKey('employee-move-otp:3f2b8c1e-0000-4000-8000-000000000000'),'employee-move-otp');
 const entry=AUTOMATIONS.find(row=>row.key==='employee-move-otp');
 assert.deepEqual([entry.code,entry.category,entry.people],['A26','Approvals','Project Manager of the site the worker is leaving']);
 assert.equal(siteMoveMessage({employeeId:'CMPL1',name:'A',designation:'',from:MAJRI,to:SASTI,fromDate:'2026-11-20',requestedBy:'B',door:'',otp:'123456'}).split('\n')[2],"Move: Majri OC -> Sasti OC, from 20-11-2026 (the card's date).");
});

// The Fetch box itself: compiled from its source and driven with stand-in hooks and a server.
const lookupBox=async({answers,...props})=>{
 const source=readFileSync(new URL('../src/employee-id-lookup.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
 const {code}=await transformWithOxc(source,'employee-id-lookup.jsx',{jsx:{runtime:'classic'}});
 const slots=[],effects=[],calls=[];let cursor=0;
 const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]};
 const useRef=initial=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i]};
 const useEffect=(run,deps)=>{const i=cursor++,before=slots[i];if(!before||deps.some((dep,n)=>dep!==before[n])){slots[i]=deps;effects.push(run);}};
 const fetchStub=async(url,init)=>{const body=JSON.parse(init.body);calls.push({url,body});const answer=answers(url,body);return {ok:answer.status<300,status:answer.status,json:async()=>answer.body};};
 const Box=new Function('React','useState','useEffect','useRef','fetch','setTimeout','clearTimeout','AbortController',code+';return EmployeeIdLookup')(React,useState,useEffect,useRef,fetchStub,()=>0,()=>{},AbortController);
 const resolved=[];
 const render=()=>{cursor=0;const tree=Box({token:'t',location:SASTI,scanMode:true,onResolved:async employee=>{resolved.push(employee)},...props});for(const run of effects.splice(0))run();return tree;};
 const find=(tree,match)=>{const found=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(match(node))found.push(node);visit(node.props.children)};visit(tree);return found};
 const label=node=>[].concat(node.props.children).flat().join('');
 return {render,find,calls,resolved,label,buttons:tree=>find(tree,n=>n.type==='button'),inputs:tree=>find(tree,n=>n.type==='input'),notes:tree=>find(tree,n=>n.type==='small').map(label)};
};

test('the Fetch box: Correct the number first, then Fetch from Pulse-II with OTP',async()=>{
 const siteMove={employeeId:'CMPL1610',name:'MOVING MAN',designation:'TIPPER DRIVER',from:MAJRI,to:SASTI,fromDate:'2026-11-20'};
 const answers=(url,body)=>url.startsWith('/api/log-books/employee-lookup')?{status:403,body:{error:'This is MOVING MAN, TIPPER DRIVER, Majri OC. This number is not at Sasti OC. Check the number on the card.',siteMove}}
  :url==='/api/log-books/employee-site-move'?{status:201,body:{otp:{id:'otp-1',sentTo:['majri.pm'],channels:['telegram']},move:siteMove}}
  :body.otp==='654321'?{status:200,body:{id:'1',name:'MOVING MAN',caliberId:'CMPL1610',moved:{from:MAJRI,to:SASTI,fromDate:'2026-11-20',latest:true}}}:{status:400,body:{error:'Wrong OTP. 4 attempts left.'}};
 const box=await lookupBox({answers,suggestedId:'1610',bookDate:'2026-11-20',card:{door:'V942',cardId:'c1'}});
 let tree=box.render();
 assert.deepEqual(box.buttons(tree).map(box.label),['Fetch driver'],'nothing about a move until a person presses Fetch');
 await box.buttons(tree)[0].props.onClick({});
 assert.deepEqual([box.calls[0].url,box.calls[0].body.bookDate,box.calls[0].body.location],['/api/log-books/employee-lookup?scan=1','2026-11-20',SASTI]);
 tree=box.render();
 assert.deepEqual(box.buttons(tree).map(box.label),['Fetch driver','Correct the number','Fetch from Pulse-II with OTP'],'the correction comes first');
 assert.ok(box.notes(tree).includes('Fetch moves MOVING MAN from Majri OC to Sasti OC from 20-11-2026, for salary and every record. The Project Manager of Majri OC gets the OTP.'));
 assert.equal(box.calls.length,1,'the OTP is not asked for until Fetch from Pulse-II is pressed');

 await box.buttons(tree)[2].props.onClick({});
 assert.deepEqual([box.calls[1].url,box.calls[1].body],['/api/log-books/employee-site-move',{caliberId:'CMPL1610',location:SASTI,bookDate:'2026-11-20',card:{door:'V942',cardId:'c1'}}]);
 tree=box.render();
 assert.ok(box.notes(tree).includes('OTP sent to majri.pm for Majri OC. Enter it to move MOVING MAN to Sasti OC from 20-11-2026.'));
 const otpInput=box.inputs(tree)[1];
 assert.equal(otpInput.props['aria-label'],'OTP for the site change');
 assert.equal(box.buttons(tree).find(button=>box.label(button)==='Confirm the move').props.disabled,true,'six digits first');
 otpInput.props.onChange({target:{value:'12 34x56'}});
 tree=box.render();
 assert.equal(box.inputs(tree)[1].props.value,'123456','digits only');
 await box.buttons(tree).find(button=>box.label(button)==='Confirm the move').props.onClick({});
 tree=box.render();
 assert.equal(box.find(tree,n=>n.props?.role==='alert')[0].props.children,'Wrong OTP. 4 attempts left.');
 assert.equal(box.resolved.length,0);
 box.inputs(tree)[1].props.onChange({target:{value:'654321'}});
 tree=box.render();
 await box.buttons(tree).find(button=>box.label(button)==='Confirm the move').props.onClick({});
 assert.deepEqual([box.calls.at(-1).url,box.calls.at(-1).body],['/api/log-books/employee-site-move/otp-1/verify',{otp:'654321'}]);
 assert.deepEqual([box.resolved[0].name,box.resolved[0].moved.to],['MOVING MAN',SASTI],'the worker goes on the card');
 tree=box.render();
 assert.deepEqual(box.buttons(tree).map(box.label),['Fetch driver']);
});

test('the screens pass the card date, and the driver list carries the moves',()=>{
 const scan=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 assert.ok(scan.includes("<EmployeeIdLookup scanMode location={draft.location} bookDate={draft.bookDate||''} card={{batchId:card?.batch_id,cardId:card?.id,door:draft.doorText,cardNo:kind==='vehicle'?draft.aFormNo:draft.jobCardNo}}"));
 assert.ok(scan.includes('employeeAtLocation(r,draft.location,draft.bookDate)'));
 for(const file of ['log-book-form.jsx','vlb-manual-form.jsx'])assert.equal(readFileSync(new URL('../src/'+file,import.meta.url),'utf8').split('employeeAtLocation(row,form.location,form.bookDate)').length,3,file);
 const options=readFileSync(new URL('../server/routes/log-book.mjs',import.meta.url),'utf8');
 assert.ok(options.includes('siteMoves:r.siteMoves.map(move=>({from:move.from,to:move.to,fromDate:move.fromDate,at:move.at}))'));
 assert.ok(options.includes('employeeAtLocation(employee,data.location,data.bookDate)'),'a save checks the site of the card date');
 const master=readFileSync(new URL('../src/employee-master.jsx',import.meta.url),'utf8');
 assert.ok(master.includes('<EmployeeSiteMoves session={session}/>'));
 assert.ok(master.includes('This screen gives a site to a worker who has none.'));
});
