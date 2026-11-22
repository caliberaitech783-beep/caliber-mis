// Owner, 22 Nov 2026: the Caliber ID on a trip card decides salary, so the scan never puts a doubtful number on a
// card by itself. The card waits for a person for one of these reasons, each with one plain line:
//   the number is not readable; no employee has it; it belongs to another site; the person is not in HR's list or
//   has left; the person is not a driver or operator; the two readings of the number differ.
// The other-site line must say the number may be misread and name the look-alike IDs at this site. Nothing reads
// the name written on the card (he removed that).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {transformWithOxc} from 'vite';
import {judgeCaliberId,caliberCheckMessage,caliberNumber,lookAlikeNumbers,drivesOrOperates,needsDriverConfirm,employeeLeft,LOOK_ALIKE_LIMIT} from '../shared/caliber-id-check.mjs';
import {applyCaliberCheck,matchScanDraft} from '../server/rules/scan-extraction.mjs';
import {recoverFirstScanFields} from '../server/services/scan-first-field-recovery.mjs';
import {scanFieldIssues,caliberHoldMessage} from '../src/scan-field-review.mjs';
import {manualScanIssues} from '../src/scan-manual-fields.mjs';
import {canAutoSaveScanCard} from '../shared/scan-auto-save.mjs';
import {cardIssueGroups} from '../shared/scan-card-groups.mjs';
import {registerErpEmployees} from '../server/routes/erp-employee-source.mjs';

const MAJRI='Majri OC';
const person=(id,number,name,designation,extra={})=>({id,master_name:'Employee master',record_data:{caliberId:'CMPL'+number,caliberCode:'CMLL'+number,name,currentDesignationName:designation,site:MAJRI,hrListed:true,hrLeft:false,status:'Active',...extra}});
const people=()=>[
 person(1,4400,'DRIVER ONE','VOLVO DRIVER'),
 person(2,4401,'DRIVER TWO','TIPPER DRIVER'),
 // Still carries the old master's status: HR's import has not placed this person.
 person(3,1826,'GONE MAN','VOLVO DRIVER',{status:'Resigned',hrListed:undefined,hrLeft:undefined}),
 person(4,18126,'REAL MAN','VOLVO DRIVER'),
 person(5,1610,'SASTI MAN','TIPPER DRIVER',{site:'Sasti OC'}),
 person(6,1619,'HELPER MAN','HELPER'),
 person(7,1618,'LOOK ALIKE','PC- OPRATOR'),
 person(8,14970,'HELPING HAND','HELPER'),
 person(9,2000,'NOT LISTED','VOLVO DRIVER',{hrListed:false}),
 person(10,2100,'LEFT MAN','DRIVER',{site:'Dudhichua East OC',hrLeft:true,status:'Left'}),
 person(11,12227,'ABC','',{hrListed:undefined,hrLeft:undefined,status:undefined}),
 person(12,3000,'TWIN A','VOLVO DRIVER'),
 person(13,3000,'TWIN B','VOLVO DRIVER'),
 {id:14,master_name:'C-Dir Employee master',record_data:{empId:'CMPL5555',name:'STAFF MAN',designation:'PRODUCTION MANAGER',site:MAJRI}},
 {id:15,master_name:'C-Dir Employee master',record_data:{empId:'CMPL4400',name:'DIRECTORY COPY',designation:'VOLVO DRIVER',site:MAJRI}},
 {id:16,master_name:'Equipment master',record_data:{door:'V321',category:'Vehicle',currentLocation:MAJRI}},
];
const judge=(read,more={},masters=people())=>judgeCaliberId(masters,{read,location:MAJRI,...more});

test('the number inside an ID, and the numbers one digit away from it',()=>{
 assert.deepEqual(['CMPL1726','cmll 1726','1726','CMLL-01726','0','CMPL','A726',''].map(caliberNumber),['1726','1726','1726','1726','','','','']);
 const near=lookAlikeNumbers('1726');
 for(const value of ['1727','1126','7726','17126','11726','17260','176','726','172'])assert.ok(near.includes(value),value);
 assert.equal(near.includes('1726'),false);assert.equal(near.includes('0726'),false,'no number starts with 0');
 assert.equal(near.includes('1762'),false,'two digits swapped is two digits away');
 assert.equal(new Set(near).size,near.length);
 assert.deepEqual(lookAlikeNumbers('A726'),[]);
});

test('drivers and operators are known by their designation, in the spellings HR uses',()=>{
 const drives=designation=>drivesOrOperates({currentDesignationName:designation});
 for(const designation of ['VOLVO DRIVER','Tipper Driver','DRIVER (TIPPER)','PC OPERATOR','PC- OPRATOR','PC OPRETOR','PC -OPERATER','EXCAVATOR OPERTOR','EXCAVATOR/OP','DOZER/OP','DUMPER OPT','SURFACE OP','LOD-OPERATOR','GRE-OPRATOR','SERVICE VEN','SHIFT BUS','SERVICE VAN','ALL ROUNDER','WATER TANKER DRIVER/DCM','CRUSHER OPERATOR'])assert.equal(drives(designation),true,designation);
 for(const designation of ['HELPER','BLASTING HELPER','TIPPER HELPER','EICHER HELPER','MECHANIC','TIPPER MECHANIC','SITE SUPERVISOR','WELDER','PRODUCTION MANAGER','DATA ENTRY OPERATOR','DATE ENTRY OPERATOR (TIPPER)','LATHE OPERATOR','VOLVO TRAINER'])assert.equal(drives(designation),false,designation);
 assert.equal(drives(''),true,'a blank designation stops no card');
 assert.equal(drivesOrOperates({designationName:'HELPER'}),false);assert.equal(drivesOrOperates({designation:'HELPER'}),false);
 assert.equal(needsDriverConfirm({caliberId:'CMPL14970',currentDesignationName:'HELPER'}),true);
 assert.equal(needsDriverConfirm({caliberId:'CMPL14970',currentDesignationName:'HELPER',driverConfirmedAt:'2026-11-23T00:00:00.000Z'}),false,'asked once per person');
 assert.equal(needsDriverConfirm({caliberId:'CMPL12227',currentDesignationName:'HELPER'}),false,'a dummy ID is never asked');
 assert.deepEqual([{hrLeft:true},{status:'Resigned'},{status:'RESIGNED'},{status:'Left'},{status:'Active'},{}].map(employeeLeft),['hr','status','status','status','','']);
});

test('a clear number of one working driver at the site goes on the card by itself',()=>{
 const verdict=judge('4401');
 assert.equal(verdict.employee.id,2);assert.equal(verdict.check,null);
 assert.equal(judge('CMPL4401').employee.id,2);assert.equal(judge('CMLL4401').employee.id,2);
 assert.equal(judge('4400').employee.id,1,'Employee Master is used before the staff directory');
 assert.equal(judge('12227').employee.id,11,'the dummy ID of the site');
 assert.equal(judge('4401',{readings:{first:'4401',second:'CMPL4401'}}).employee.id,2,'two readings of one number agree');
 assert.equal(judge('4401',{readings:{first:'',second:'4401'}}).employee.id,2,'a number read only the second time');
 assert.equal(judge('',{readings:{first:'',second:'4401'}}).employee.id,2);
 assert.deepEqual(judgeCaliberId(people(),{read:'4401',location:''}),{employee:null,check:null},'a card with no site yet is not judged');
});

test('the six stops: each holds the card and says why in one plain line',()=>{
 const held=(read,more)=>{const verdict=judge(read,more);assert.equal(verdict.employee,null,read);return verdict.check;};
 const say=(read,more,kind)=>caliberCheckMessage(held(read,more),kind);

 assert.equal(say(''),'Caliber ID could not be read. Type the number from the card.');

 assert.equal(say('21999'),'Scan read 21999. No employee has this number. Check the card. No look-alike ID at Majri OC.');
 assert.equal(say('4409'),'Scan read 4409. No employee has this number. Check the card. Look-alike IDs at Majri OC: 4400 (DRIVER ONE), 4401 (DRIVER TWO).');

 const other=held('1610');
 assert.deepEqual([other.reason,other.read,other.name,other.designation,other.site,other.at],['other-site','1610','SASTI MAN','TIPPER DRIVER','Sasti OC','Majri OC']);
 assert.deepEqual(other.lookAlikes,[{id:'1618',name:'LOOK ALIKE'},{id:'1619',name:'HELPER MAN'}],'drivers and operators first, then by number');
 assert.equal(caliberCheckMessage(other),'Scan read 1610. This is SASTI MAN, TIPPER DRIVER, Sasti OC. The number may be misread. Look-alike IDs at Majri OC: 1618 (LOOK ALIKE), 1619 (HELPER MAN).');

 assert.equal(say('2000'),"Scan read 2000. This is NOT LISTED, VOLVO DRIVER, who is not in HR's list for any site. Check the number on the card. No look-alike ID at Majri OC.");
 assert.equal(say('2100'),"Scan read 2100. This is LEFT MAN, DRIVER. HR's list says this person has left. Check the number on the card. No look-alike ID at Majri OC.");
 // The case that started this work: a five-digit number read with its thin 1 dropped lands on a person who has resigned.
 assert.equal(say('1826'),'Scan read 1826. This is GONE MAN, VOLVO DRIVER. Employee Master says this person has resigned. Check the number on the card. Look-alike IDs at Majri OC: 18126 (REAL MAN).');

 assert.equal(say('14970'),'Scan read 14970. This is HELPING HAND, HELPER. Confirm HELPING HAND drove this vehicle, or correct the number. No look-alike ID at Majri OC.');
 assert.equal(say('14970',{},'equipment'),'Scan read 14970. This is HELPING HAND, HELPER. Confirm HELPING HAND operated this machine, or correct the number. No look-alike ID at Majri OC.');
 assert.equal(held('5555').reason,'not-driver','a staff directory line is judged the same way');

 const differ=held('4401',{readings:{first:'4401',second:'4400'}});
 assert.deepEqual([differ.reason,differ.read,differ.second],['readings-differ','4401','4400']);
 assert.equal(caliberCheckMessage(differ),'The number was read as 4401 and 4400. Type the number from the card.');
 assert.equal(held('4400',{readings:{first:'2279',second:'4400'}}).reason,'readings-differ','a second reading that lands on a real driver is still a doubt');

 assert.equal(say('3000'),'Scan read 3000. More than one employee at Majri OC has this number. Choose the driver from the list.');
 assert.equal(caliberCheckMessage(null),'');assert.equal(caliberCheckMessage({reason:'something else'}),'');
});

test('look-alike IDs: only working people of this site, never the dummy ID, at most eight named',()=>{
 const crowd=[person(1,5000,'SASTI MAN','DRIVER',{site:'Sasti OC'})];
 for(let digit=1;digit<=9;digit++)crowd.push(person(10+digit,5000+digit,'MAN '+digit,digit===9?'HELPER':'VOLVO DRIVER'));
 crowd.push(person(30,5010,'NOT LISTED','DRIVER',{hrListed:false}),person(31,5020,'GONE','DRIVER',{status:'Resigned'}),person(32,5030,'ELSEWHERE','DRIVER',{site:'Jayant OC'}),person(33,50000,'LONGER','DRIVER'));
 const check=judgeCaliberId(crowd,{read:'5000',location:MAJRI}).check;
 assert.equal(check.reason,'other-site');assert.equal(check.lookAlikes.length,LOOK_ALIKE_LIMIT);
 assert.deepEqual(check.lookAlikes.map(row=>row.id),['5001','5002','5003','5004','5005','5006','5007','5008']);
 assert.equal(check.more,2,'50000 and the helper 5009 are counted, not named');
 assert.match(caliberCheckMessage(check),/5008 \(MAN 8\) and 2 more\.$/);
 const dummy=judgeCaliberId([...people(),person(40,12228,'SOMEONE','DRIVER',{site:'Sasti OC'})],{read:'12228',location:MAJRI}).check;
 assert.deepEqual(dummy.lookAlikes,[],'the dummy ID 12227 is not offered as a look-alike');
});

test('a helper is asked about once: after a person confirms, the scan puts him on later cards',()=>{
 const masters=people();
 assert.equal(judge('14970',{},masters).check.reason,'not-driver');
 masters[7].record_data={...masters[7].record_data,driverConfirmedAt:'2026-11-23T05:00:00.000Z',driverConfirmedBy:'majri.operator'};
 assert.equal(judge('14970',{},masters).employee.id,8);
});

test('when the card is read: the verdict fills or clears the driver and keeps the reason with the card',()=>{
 const masters=people(),card=(employeeCode,more={})=>({raw:{employeeCode,...more},draft:{location:MAJRI,employeeId:'99'}});
 const good=applyCaliberCheck(card('4401'),masters);
 assert.equal(good.draft.employeeId,'2');assert.equal(good.raw.caliberCheck,undefined);
 // The handwritten site of the card may be another site: the batch's site decides.
 const other=applyCaliberCheck({raw:{employeeCode:'1610'},draft:{location:'Sasti OC',employeeId:'5'}},masters,MAJRI);
 assert.equal(other.draft.employeeId,'');assert.equal(other.raw.caliberCheck.reason,'other-site');
 const differ=applyCaliberCheck(card('4400',{caliberReadings:{first:'2279',second:'4400'}}),masters);
 assert.equal(differ.draft.employeeId,'','the second reading is not put on the card');assert.equal(differ.raw.caliberCheck.reason,'readings-differ');
 const named=applyCaliberCheck(card('',{employee:'DRIVER ONE'}),masters);
 assert.equal(named.draft.employeeId,'','never matched on the name written on the card');assert.equal(named.raw.caliberCheck.reason,'unreadable');
 const cleared=applyCaliberCheck({raw:{employeeCode:'4401',caliberCheck:{reason:'unknown'}},draft:{location:MAJRI}},masters);
 assert.equal(cleared.raw.caliberCheck,undefined);

 // Every later read of the entry judges an empty driver again, by the same rule.
 const fill=(raw,draft={})=>matchScanDraft({location:MAJRI,assetId:'16',...draft},raw,'vehicle',masters).employeeId;
 assert.equal(fill({employeeCode:'4401'}),'2');
 assert.equal(fill({employeeCode:'4400',caliberReadings:{first:'2279',second:'4400'}}),undefined);
 assert.equal(fill({employeeCode:'14970'}),undefined);
 assert.equal(fill({employeeCode:'1826'}),undefined);
 assert.equal(fill({employee:'DRIVER ONE'}),undefined);
 assert.equal(fill({employeeCode:'1610'},{employeeId:'77'}),'77','a driver a person chose is never changed');
});

test('both readings of the Caliber ID are kept, whatever else the second read settles',async()=>{
 const context={bookDate:'2026-12-19',location:'Sasti OC',cardShift:'I'};
 const read=(employeeCode,draft={})=>({raw:{door:'V321',employeeCode},draft:{doorText:'V321',assetId:'1',employeeId:'2',location:'Sasti OC',bookDate:'2026-12-19',bookDateSource:'scan',cardShift:'I',shiftId:'3',shiftHours:8,openingHmr:100,closingHmr:104,openingKmr:200,closingKmr:240,trips:[{equipmentName:'LPC01',tripCount:2}],scanMachineSummary:[{equipmentName:'LPC01',tripCount:2}],timeMode:'without',extractionReviewFields:[],meterReviewFields:[],...draft}});
 const same=await recoverFirstScanFields({kind:'vehicle',extracted:read('4401'),context,readAgain:async()=>({}),extract:async()=>read('4401')});
 assert.deepEqual(same.raw.caliberReadings,{first:'4401',second:'4401'});
 const differ=await recoverFirstScanFields({kind:'vehicle',extracted:read('4401'),context,readAgain:async()=>({}),extract:async()=>read('4400')});
 assert.deepEqual(differ.raw.caliberReadings,{first:'4401',second:'4400'});assert.equal(differ.raw.employeeCode,'4401');
 const recovered=await recoverFirstScanFields({kind:'vehicle',extracted:read('2279',{employeeId:''}),context,readAgain:async()=>({}),extract:async()=>read('4400')});
 assert.deepEqual(recovered.raw.caliberReadings,{first:'2279',second:'4400'},'kept although the second reading replaced the first');
 assert.equal(recovered.raw.employeeCode,'4400');
 const otherSite=await recoverFirstScanFields({kind:'vehicle',extracted:read('4401'),context,readAgain:async()=>({}),extract:async()=>read('4400',{location:'Majri OC'})});
 assert.deepEqual(otherSite.raw.caliberReadings,{first:'4401',second:'4400'},'kept even when the second read saw another site');
});

test('a held card shows the line on the driver field and is never saved by itself',()=>{
 const masters=people(),options={assets:[],employees:masters.filter(row=>row.master_name!=='Equipment master').map(row=>({id:String(row.id)})),shifts:[{id:'3'}]};
 const check=judge('1610').check,draft={location:MAJRI,employeeId:''};
 const line='Scan read 1610. This is SASTI MAN, TIPPER DRIVER, Sasti OC. The number may be misread. Look-alike IDs at Majri OC: 1618 (LOOK ALIKE), 1619 (HELPER MAN).';
 assert.equal(scanFieldIssues(draft,'vehicle',{employeeCode:'1610',caliberCheck:check},options).employeeId,line);
 assert.equal(scanFieldIssues(draft,'vehicle',{employeeCode:'1610',caliberCheck:check}).employeeId,line,'the same line without the master lists');
 assert.equal(manualScanIssues(draft,'vehicle',{employeeCode:'1610',caliberCheck:check},options).employeeId,line);
 assert.equal(scanFieldIssues({...draft,employeeId:'2'},'vehicle',{employeeCode:'1610',caliberCheck:check},options).employeeId,undefined,'once a person has chosen the driver the line goes');
 // A card read before this rule, or moved to another site, gets the short line.
 assert.equal(scanFieldIssues(draft,'vehicle',{employeeCode:'CMPL1610'},options).employeeId,'Scan read 1610. No employee at this site has this number. Check the card.');
 assert.equal(scanFieldIssues({...draft,location:'Sasti OC'},'vehicle',{employeeCode:'1610',caliberCheck:check},options).employeeId,'Scan read 1610. No employee at this site has this number. Check the card.');
 assert.equal(scanFieldIssues(draft,'equipment',{},options).employeeId,'Caliber ID could not be read. Type the number from the card.');
 assert.equal(caliberHoldMessage({caliberCheck:judge('',{readings:{first:'4401',second:'4400'}}).check},'vehicle',MAJRI),'The number was read as 4401 and 4400. Type the number from the card.');
 assert.equal(scanFieldIssues(draft,'vehicle',{employeeCode:'1610',caliberCheck:check},{...options,employees:[]}).employeeId,'Employee Master is empty in this MIS database. Sync/import it before matching scans.');

 const card={status:'review',checks:{errors:[],warnings:[]},draft:{...draft,trips:[{equipmentName:'LPC01',tripCount:2}]},raw_fields:{employeeCode:'1610',caliberCheck:check}};
 assert.equal(canAutoSaveScanCard(card,'vehicle',options),false);
 assert.ok(cardIssueGroups(card,'vehicle',options).includes('wrong-caliber'),'listed under the Caliber ID group');
});

const lookupFixture=async(scope={sites:null,label:'All sites'})=>{
 const db=new PGlite();
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 for(const row of people().filter(row=>row.master_name==='Employee master'))await db.query('INSERT INTO master_records(id,master_name,record_data) VALUES($1,$2,$3)',[row.id,row.master_name,JSON.stringify({...row.record_data,panNo:'KEEP'+row.id})]);
 const audits=[],app=express();app.use(express.json());
 app.use((req,res,next)=>{res.on('finish',()=>{if(req.audit)audits.push(req.audit)});next()});
 registerErpEmployees(app,{pool:{query:(sql,params)=>db.query(sql,params)},requireSession:(req,res,next)=>{req.session={login:'majri.operator'};next()},requireAdministrator:(req,res,next)=>next(),getSiteScope:async()=>scope});
 const server=app.listen(0),base='http://127.0.0.1:'+server.address().port;
 const fetchId=async(caliberId,{scan=true,location=MAJRI,...body}={})=>{const r=await fetch(base+'/api/log-books/employee-lookup'+(scan?'?scan=1':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caliberId,location,...body})});return {status:r.status,body:await r.json()};};
 const record=async id=>(await db.query('SELECT record_data FROM master_records WHERE id=$1',[id])).rows[0].record_data;
 return {fetchId,record,audits,close:async()=>{server.close();await db.close();}};
};

test('the Fetch box on a scanned card: plain answers, and one question for a helper',async()=>{
 const f=await lookupFixture();
 try{
  assert.equal((await f.fetchId('4401')).body.name,'DRIVER TWO');
  const nobody=await f.fetchId('21999');assert.equal(nobody.status,404);assert.equal(nobody.body.error,'No employee has this number. Check the card.');
  const other=await f.fetchId('1610');assert.equal(other.status,403);assert.equal(other.body.error,'This is SASTI MAN, TIPPER DRIVER, Sasti OC. This number is not at Majri OC. Check the number on the card.');
  const unlisted=await f.fetchId('2000');assert.equal(unlisted.status,403);assert.equal(unlisted.body.error,"This is NOT LISTED, VOLVO DRIVER, who is not in HR's list for any site. Check the number on the card.");
  const left=await f.fetchId('2100','Dudhichua East OC');assert.equal(left.status,403);assert.equal(left.body.error,"This is LEFT MAN, DRIVER. HR's list says this person has left. Check the number on the card.");
  assert.equal((await f.fetchId('12227')).body.name,'ABC','the dummy ID is fetched without a question');

  const asked=await f.fetchId('14970');
  assert.equal(asked.status,409);assert.equal(asked.body.error,'This is HELPING HAND, HELPER. Confirm HELPING HAND drove this vehicle, or correct the number.');
  assert.deepEqual(asked.body.confirmDriver,{name:'HELPING HAND',designation:'HELPER'});
  assert.equal((await f.fetchId('14970',{kind:'equipment'})).body.error,'This is HELPING HAND, HELPER. Confirm HELPING HAND operated this machine, or correct the number.');
  assert.equal((await f.record(8)).driverConfirmedAt,undefined,'asking writes nothing');assert.equal(f.audits.length,0);
  assert.equal((await f.fetchId('14970',{confirmDriver:'yes'})).status,409,'only a plain yes counts');

  const confirmed=await f.fetchId('14970',{confirmDriver:true});
  assert.equal(confirmed.status,200);assert.equal(confirmed.body.name,'HELPING HAND');assert.equal(confirmed.body.id,'8');
  const saved=await f.record(8);
  assert.match(saved.driverConfirmedAt,/^\d{4}-\d{2}-\d{2}T/);assert.deepEqual([saved.driverConfirmedBy,saved.driverConfirmedAtSite,saved.panNo,saved.name],['majri.operator','Majri OC','KEEP8','HELPING HAND']);
  assert.deepEqual([f.audits.length,f.audits[0].action,f.audits[0].targetReference],[1,'Confirm driver or operator','CMPL14970']);
  assert.equal((await f.fetchId('14970')).status,200,'not asked again');assert.equal(f.audits.length,1);
  // The scan now accepts him: the mark is on the employee.
  assert.equal(judgeCaliberId([{id:8,master_name:'Employee master',record_data:saved}],{read:'14970',location:MAJRI}).employee.id,8);

  // A manual entry form (no scan) is not asked: a person typed that number on purpose.
  assert.equal((await f.fetchId('1619',{scan:false})).status,200);
  assert.equal((await f.fetchId('14970',{scan:false})).status,200);
 }finally{await f.close();}
});

// The Fetch box itself: compiled from its source and driven with stand-in hooks, a timer and a server.
const lookupBox=async({answers,...props})=>{
 const source=readFileSync(new URL('../src/employee-id-lookup.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
 const {code}=await transformWithOxc(source,'employee-id-lookup.jsx',{jsx:{runtime:'classic'}});
 const slots=[],effects=[],timers=[],calls=[];let cursor=0;
 const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]};
 const useRef=initial=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i]};
 const useEffect=(run,deps)=>{const i=cursor++,before=slots[i];if(!before||deps.some((dep,n)=>dep!==before[n])){slots[i]=deps;effects.push(run);}};
 const fetchStub=async(url,init)=>{const body=JSON.parse(init.body);calls.push({url,body});const answer=answers(body);return {ok:answer.status===200,status:answer.status,json:async()=>answer.body};};
 const Box=new Function('React','useState','useEffect','useRef','fetch','setTimeout','clearTimeout','AbortController',code+';return EmployeeIdLookup')(React,useState,useEffect,useRef,fetchStub,run=>{timers.push(run);return timers.length},()=>{},AbortController);
 const resolved=[];
 const render=()=>{cursor=0;const tree=Box({token:'t',location:MAJRI,onResolved:async employee=>{resolved.push(employee)},...props});for(const run of effects.splice(0))run();return tree;};
 const find=(tree,match)=>{const found=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(match(node))found.push(node);visit(node.props.children)};visit(tree);return found};
 return {render,find,calls,resolved,runTimers:async()=>{for(const run of timers.splice(0))await run();},input:tree=>find(tree,n=>n.type==='input')[0],buttons:tree=>find(tree,n=>n.type==='button')};
};

test('on a scanned card the number the scan read is shown but never fetched by itself',async()=>{
 const answers=body=>body.caliberId==='4401'?{status:200,body:{id:'2',name:'DRIVER TWO',caliberId:'CMPL4401'}}:{status:403,body:{error:'refused'}};
 const scan=await lookupBox({answers,scanMode:true,suggestedId:'1610'});
 let tree=scan.render();
 assert.equal(scan.input(tree).props.value,'1610','the number read stays in the box to be corrected');
 await scan.runTimers();assert.equal(scan.calls.length,0,'nothing is looked up until a person acts');
 scan.input(tree).props.onChange({target:{value:'4401'}});
 tree=scan.render();await scan.runTimers();
 assert.deepEqual(scan.calls.map(call=>[call.url,call.body.caliberId,call.body.kind]),[['/api/log-books/employee-lookup?scan=1','4401','vehicle']]);
 assert.equal(scan.resolved[0].name,'DRIVER TWO');

 // A manual entry form keeps looking up what it is given, as before.
 const manual=await lookupBox({answers,suggestedId:'4401'});
 manual.render();await manual.runTimers();
 assert.deepEqual(manual.calls.map(call=>[call.url,call.body.caliberId,call.body.kind]),[['/api/log-books/employee-lookup','4401',undefined]]);
});

test('the Fetch box asks once about a helper and sends the yes',async()=>{
 const answers=body=>body.confirmDriver===true?{status:200,body:{id:'8',name:'HELPING HAND',caliberId:'CMPL14970'}}:{status:409,body:{error:'This is HELPING HAND, HELPER. Confirm HELPING HAND operated this machine, or correct the number.',confirmDriver:{name:'HELPING HAND',designation:'HELPER'}}};
 const box=await lookupBox({answers,scanMode:true,role:'operator',suggestedId:'14970'});
 let tree=box.render();
 assert.deepEqual(box.buttons(tree).map(button=>[].concat(button.props.children).join('')),['Fetch operator']);
 await box.buttons(tree)[0].props.onClick({});
 tree=box.render();
 assert.equal(box.find(tree,n=>n.props?.role==='alert')[0].props.children,'This is HELPING HAND, HELPER. Confirm HELPING HAND operated this machine, or correct the number.');
 const yes=box.buttons(tree)[1];
 assert.equal([].concat(yes.props.children).join(''),'Yes, HELPING HAND operated this machine');
 assert.equal(box.calls[0].body.confirmDriver,undefined,'pressing Fetch is not the yes');assert.equal(box.calls[0].body.kind,'equipment');
 await yes.props.onClick({});
 assert.deepEqual([box.calls[1].body.caliberId,box.calls[1].body.confirmDriver],['14970',true]);
 assert.equal(box.resolved[0].name,'HELPING HAND');
 tree=box.render();
 assert.equal(box.buttons(tree).length,1,'the question goes once it is answered');
});

test('the review screen leaves the Fetch box empty when the two readings differ',()=>{
 const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 assert.ok(source.includes("suggestedId={card?.raw_fields?.caliberCheck?.reason==='readings-differ'?'':card?.raw_fields?.employeeCode||''}"));
 assert.ok(readFileSync(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8').includes('applyCaliberCheck(extracted,masters,batch.expected_context?.location||extracted.draft.location)'),'the verdict is made at the batch site when the card is read');
});
