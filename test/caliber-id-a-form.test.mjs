// Owner, 23 Nov 2026: the Caliber ID of a scanned card is linked with the A Form no. and the site through A Form
// Master, and the department is read with the designation. This adds to the stops of 22 Nov
// (test/caliber-id-check.test.mjs), which stay as they are.
import test from 'node:test';
import assert from 'node:assert/strict';
import {judgeCaliberId,caliberCheckMessage,drivesOrOperates,needsDriverConfirm,CALIBER_HOLD_REASONS} from '../shared/caliber-id-check.mjs';
import {applyCaliberCheck,matchScanDraft} from '../server/rules/scan-extraction.mjs';
import {caliberHoldMessage,scanFieldIssues} from '../src/scan-field-review.mjs';

const MAJRI='Majri OC';
const person=(id,number,name,designation,extra={})=>({id,master_name:'Employee master',record_data:{caliberId:'CMPL'+number,caliberCode:'CMLL'+number,name,currentDesignationName:designation,site:MAJRI,hrListed:true,hrLeft:false,status:'Active',...extra}});
const form=(id,aFormNo,number,site=MAJRI)=>({id,master_name:'A Form master',record_data:{aFormNo,employeeId:'CMLL'+number,site}});
const lists=()=>[
 person(1,1618,'RAM','VOLVO DRIVER'),
 person(2,1610,'SASTI MAN','TIPPER DRIVER',{site:'Sasti OC'}),
 person(3,4400,'ANIL','TIPPER DRIVER'),
 person(4,4401,'SUNIL','PC OPERATOR'),
 person(5,14970,'HELPING HAND','HELPER'),
 person(6,1726,'GONE MAN','VOLVO DRIVER',{status:'Resigned',hrListed:undefined,hrLeft:undefined}),
 person(7,17126,'REAL MAN','VOLVO DRIVER'),
 person(8,2279,'FIRST','VOLVO DRIVER'),person(9,2274,'SECOND','VOLVO DRIVER'),
 person(10,9000,'TWO FORMS','DOZER OPERATOR'),
 person(11,14971,'DRIVER NEAR HELPER','TIPPER DRIVER'),
 form(101,'467',1618),form(102,'467',1610,'Sasti OC'),form(103,'12',4400),form(104,'15',4401),form(105,'88',14970),form(106,'900',17126),
 form(107,'31',2279),form(108,'32',2274),form(109,'300/301',9000),form(110,'77',14971),form(111,'500',4400),form(112,'500',4401),
];
const judge=(input,masters=lists())=>judgeCaliberId(masters,{location:MAJRI,...input});
const line=(input,kind='vehicle')=>caliberCheckMessage(judge(input).check,kind);

test('the department is read with the designation: the designation decides, the department speaks when there is none',()=>{
 // HR's departments mix people: a driver in MINING or PRODUCTION is still a driver, a helper in DRIVER is still a helper.
 assert.equal(drivesOrOperates({currentDesignationName:'VOLVO DRIVER',currentDepartmentName:'MINING'}),true);
 assert.equal(drivesOrOperates({currentDesignationName:'PC- OPRATOR',currentDepartmentName:'PRODUCTION'}),true);
 assert.equal(drivesOrOperates({currentDesignationName:'TIPPER HELPER',currentDepartmentName:'DRIVER'}),false);
 assert.equal(drivesOrOperates({currentDesignationName:'DATA ENTRY OPERATOR',currentDepartmentName:'DRIVER & OPERATOR'}),false);
 // No designation: the department is all there is to go by.
 for(const department of ['DRIVER','VOLVO DRIVER','DRIVER & OPERATOR','OPERATOR','PC OPERATOR','VEHICLE','LMV','WATER TANKER DRIVER','DOZER OPRETOR'])
  assert.equal(drivesOrOperates({currentDepartmentName:department}),true,department);
 for(const department of ['MAINTENANCE','HELPER','STORE','OFFICE STAFF','BLASTING SECTION','HSD','MIS'])
  assert.equal(drivesOrOperates({currentDepartmentName:department}),false,department);
 assert.equal(drivesOrOperates({departmentName:'Maintenance'}),false,'the old ERP field is read too');
 // Employee Master says nothing at all: nothing to judge, so no card is stopped for it.
 assert.equal(drivesOrOperates({}),true);
 assert.equal(needsDriverConfirm({caliberId:'CMPL77',currentDepartmentName:'MAINTENANCE'}),true);
 assert.equal(needsDriverConfirm({caliberId:'CMPL77',currentDepartmentName:'MAINTENANCE',driverConfirmedAt:'2026-11-23T00:00:00Z'}),false,'a person confirmed him once');
 // The held line names the department when there is no designation.
 const held=judge({read:'5000'},[...lists(),person(20,5000,'NO TITLE','',{currentDepartmentName:'MAINTENANCE'})]);
 assert.equal(held.check.reason,'not-driver');
 assert.match(caliberCheckMessage(held.check),/^Scan read 5000\. This is NO TITLE, MAINTENANCE department\. Confirm NO TITLE drove this vehicle, or correct the number\./);
});

test('the right number with the right A Form no., with none, or with one that is merely different, is taken as before',()=>{
 for(const aForm of ['467','A467','0467','','999','12']){
  const verdict=judge({read:'1618',aForm});
  assert.equal(verdict.employee?.id,1,'FORM A box '+(aForm||'(blank)'));assert.equal(verdict.check,null);assert.equal(verdict.aForm,undefined);
 }
 // One person can hold two A Form numbers.
 assert.equal(judge({read:'9000',aForm:'301'}).employee.id,10);
});

test('a number of another site is corrected by the FORM A box when the box names one driver here, one digit away',()=>{
 // The scan read 1610 (a Sasti man). The FORM A box says 467, which at Majri is CMLL1618.
 const verdict=judge({read:'1610',aForm:'467'});
 assert.equal(verdict.employee.id,1);assert.equal(verdict.check,null);
 assert.deepEqual(verdict.aForm,{read:'1610',no:'467',id:'1618'});
 assert.equal(judge({read:'CMLL1610',aForm:'A-467'}).employee.id,1,'the box is read with or without the letter A');
 // The same A Form no. at Sasti is the Sasti man: the site is part of the link.
 assert.equal(judgeCaliberId(lists(),{location:'Sasti OC',read:'1610',aForm:'467'}).employee.id,2);
 assert.equal(judgeCaliberId(lists(),{location:'Sasti OC',read:'1618',aForm:'467'}).employee.id,2,'1618 read at Sasti, box 467: the Sasti man');
 // Without the box, or with a box that names someone whose number is nothing like the one read, the card waits as before.
 assert.equal(judge({read:'1610'}).check.reason,'other-site');
 const far=judge({read:'1610',aForm:'15'});
 assert.equal(far.employee,null);assert.equal(far.check.reason,'other-site');
 assert.deepEqual(far.check.aForm,{no:'15',id:'4401',name:'SUNIL'});
 assert.match(caliberCheckMessage(far.check),/The number may be misread\. The FORM A box says 15: at Majri OC that is 4401 \(SUNIL\)\. Look-alike IDs at Majri OC: 1618 \(RAM\)/);
});

test('a number nobody has, a resigned man and a helper are corrected the same way; the owner\'s 17126 read as 1726',()=>{
 assert.equal(judge({read:'1619',aForm:'467'}).employee.id,1,'nobody has 1619; the box names 1618');
 // 17126 was read as 1726, a man who resigned in 2025. The FORM A box says 900, the A Form no. of 17126.
 const owner=judge({read:'1726',aForm:'900'});
 assert.equal(owner.employee.id,7);assert.deepEqual(owner.aForm,{read:'1726',no:'900',id:'17126'});
 assert.equal(judge({read:'1726'}).check.reason,'left');
 // A helper's number, one digit from a driver's, and the box names the driver.
 assert.equal(judge({read:'14970',aForm:'77'}).employee.id,11);
 // The box naming a helper proves nothing: nobody is taken, and it is not offered either.
 const helper=judge({read:'14971'.replace('1','2'),aForm:'88'});
 assert.equal(helper.employee,null);assert.equal(helper.check.aForm,undefined);
 // An unreadable number is never filled from the box alone: one proof is not two. The line says whom the box names.
 const unread=judge({read:'',aForm:'467'});
 assert.equal(unread.employee,null);assert.equal(unread.check.reason,'unreadable');
 assert.equal(caliberCheckMessage(unread.check),'Caliber ID could not be read. Type the number from the card. The FORM A box says 467: at Majri OC that is 1618 (RAM).');
});

test('two readings that differ are settled when the FORM A box names one of the two',()=>{
 const settled=judge({read:'2279',readings:{first:'2279',second:'2274'},aForm:'32'});
 assert.equal(settled.employee.id,9);assert.deepEqual(settled.aForm,{read:'2279 and 2274',no:'32',id:'2274'});
 const open=judge({read:'2279',readings:{first:'2279',second:'2274'},aForm:'467'});
 assert.equal(open.employee,null);assert.equal(open.check.reason,'readings-differ');
 assert.match(caliberCheckMessage(open.check),/^The number was read as 2279 and 2274\. Type the number from the card\. The FORM A box says 467: at Majri OC that is 1618 \(RAM\)\.$/);
});

test('the two boxes naming two working people of the site, one digit apart, stop the card: the misread that lands on a colleague',()=>{
 assert.ok(CALIBER_HOLD_REASONS.includes('a-form-differs'));
 // The scan read 4400 (ANIL, A Form 12). The FORM A box says 15, the A Form no. of 4401 (SUNIL).
 const verdict=judge({read:'4400',aForm:'15'});
 assert.equal(verdict.employee,null);assert.equal(verdict.check.reason,'a-form-differs');
 assert.equal(caliberCheckMessage(verdict.check),'Scan read 4400. This is ANIL, TIPPER DRIVER. But the FORM A box says 15: at Majri OC that is 4401 (SUNIL), one digit away. Check the card and choose the driver from the list.');
 assert.equal(judge({read:'4401',aForm:'12'}).check.reason,'a-form-differs','and the other way round');
 // The box naming someone whose number is nothing like the one read is a misread A Form no.: the card goes on.
 assert.equal(judge({read:'4400',aForm:'467'}).employee.id,3);
 // An A Form no. written against two people of the site names neither: no stop, no correction.
 assert.equal(judge({read:'4400',aForm:'500'}).employee.id,3);
 assert.equal(judge({read:'1610',aForm:'500'}).check.aForm,undefined);
});

test('a line of A Form Master for a site the person is not at has no effect',()=>{
 // CMLL1610 is at Sasti in Employee Master; a Majri line for him names nobody at Majri.
 const masters=[...lists(),form(120,'700',1610)];
 const verdict=judge({read:'1611',aForm:'700'},masters);
 assert.equal(verdict.employee,null);assert.equal(verdict.check.aForm,undefined);
});

test('the scan uses the FORM A box of a trip card and keeps on the card why the driver was taken; a job card has no such box',()=>{
 const masters=lists();
 const read=(employeeCode,aFormNo,extra={})=>applyCaliberCheck({raw:{employeeCode,...extra},draft:{location:MAJRI,aFormNo}},masters);
 const taken=read('1610','467');
 assert.equal(taken.draft.employeeId,'1');assert.equal(taken.raw.caliberCheck,undefined);
 assert.deepEqual(taken.raw.caliberAForm,{read:'1610',no:'467',id:'1618'});
 const plain=read('1618','467',{caliberAForm:{read:'x'}});
 assert.equal(plain.draft.employeeId,'1');assert.equal(plain.raw.caliberAForm,undefined,'a number read right carries no such note');
 const heldCard=read('4400','15');
 assert.equal(heldCard.draft.employeeId,'');assert.equal(heldCard.raw.caliberCheck.reason,'a-form-differs');
 // The review screen shows the line on the Driver field, and the card is not complete without a driver.
 assert.match(caliberHoldMessage(heldCard.raw,'vehicle',MAJRI),/But the FORM A box says 15: at Majri OC that is 4401 \(SUNIL\), one digit away\./);
 assert.match(scanFieldIssues(heldCard.draft,'vehicle',heldCard.raw,{employees:[{id:'3'}],assets:[],shifts:[]}).employeeId,/choose the driver from the list/);
 // A card the engine left without a driver is matched again when the entry is opened.
 assert.equal(matchScanDraft({location:MAJRI,aFormNo:'467'},{employeeCode:'1610'},'vehicle',masters).employeeId,'1');
 assert.equal(matchScanDraft({location:MAJRI,aFormNo:'467'},{employeeCode:'1610'},'equipment',masters).employeeId,undefined,'the number box of a job card is its card number, not an A Form no.');
 assert.equal(matchScanDraft({location:MAJRI,aFormNo:'15'},{employeeCode:'4400'},'vehicle',masters).employeeId,undefined);
 assert.equal(matchScanDraft({location:MAJRI,aFormNo:'15'},{employeeCode:'4400'},'equipment',masters).employeeId,'3');
});

test('without A Form Master the scan judges exactly as it did',()=>{
 const noMaster=lists().filter(row=>row.master_name!=='A Form master');
 assert.equal(judge({read:'1610',aForm:'467'},noMaster).check.reason,'other-site');
 assert.equal(judge({read:'1610',aForm:'467'},noMaster).check.aForm,undefined);
 assert.equal(judge({read:'4400',aForm:'15'},noMaster).employee.id,3);
});
