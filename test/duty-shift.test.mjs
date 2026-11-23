// Attendance from every trip card, scanned or manual (owner, 24 Nov 2026). See shared/duty-shift.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cardDutyShift,manualEntryShiftIssue} from '../shared/duty-shift.mjs';
import {buildManpowerReport} from '../server/rules/manpower-report.mjs';
import {normalizeLogBook} from '../server/routes/log-book.mjs';

const site='Sasti OC',date='2026-11-10';
const shifts=[['A','05:00','13:00'],['B','13:00','21:00'],['C','21:00','05:00']].map(([shiftCode,startTime,endTime],i)=>({id:String(31+i),site,shiftCode,shiftName:'Shift '+shiftCode,startTime,endTime,status:'Active'}));
const employees=[{id:'21',caliberId:'101',caliberCode:'CMLL101',name:'Operator One'},{id:'22',caliberId:'102',caliberCode:'CMLL102',name:'Operator Two'}];
const assets=[{id:'1',door:'E1',site,category:'Equipment',group:'Excavator',make:'Tata',model:'EX200'},{id:'2',door:'L1',site,category:'LMV',group:'Bolero',make:'Mahindra',model:'Bolero'}];
const batches=[1,2,3].map(n=>({id:'b'+n,name:'BATCH-S'+n,site,report_date:date,shift:'S'+n,closed_at:'2026-11-11'}));
function card(id,kind,patch={}){
 const data={bookDate:date,location:site,assetId:kind==='lmv'?2:1,employeeId:21,caliberId:'101',employeeName:'Operator One',shiftId:31,shiftName:'Shift A',bookShiftCode:'S1',masterShiftStart:'05:00',shiftHours:8,openingHmr:100,closingHmr:106,...patch};
 return {id,book_no:'CARD-'+id,book_type:kind,book_date:date,site,asset_id:data.assetId,data,batches:[{id:'b1',name:'BATCH-S1',closed_at:'2026-11-11'}]};
}
const report=records=>buildManpowerReport({records,assets,employees,shifts,batches,filters:{from:date,to:date},parts:'attendance',lockedOnly:true});

test('a Day / Night (12-hour) choice wins over the batch 8-hour shift label',()=>{
 assert.deepEqual(cardDutyShift({bookShiftCode:'S1',shiftName:'Day',manualShift:'day'},{shiftCode:'A'}),{code:'D',conflict:false});
 assert.deepEqual(cardDutyShift({bookShiftCode:'S1',shiftName:'Night'}),{code:'N',conflict:false});
 assert.deepEqual(cardDutyShift({bookShiftCode:'S2',cardShift:'Night'},{shiftCode:'B'}),{code:'N',conflict:false});
 assert.deepEqual(cardDutyShift({bookShiftCode:'S1',shiftName:'Shift A'},{shiftCode:'A'}),{code:'S1',conflict:false});
 assert.deepEqual(cardDutyShift({cardShift:'Day',shiftName:'Night'}),{code:'',conflict:true});
 assert.deepEqual(cardDutyShift({bookShiftCode:'S1',shiftName:'Shift B'}),{code:'',conflict:true});
});

test('manual ELB and LMV cards marked Day / Night 12 Hrs in a Shift I batch count for attendance',()=>{
 const elb=card(1,'equipment',{manualShift:'day',manualShiftOverride:true,shiftName:'Day',shiftHours:12,openingHmr:100,closingHmr:110});
 const lmv=card(2,'lmv',{employeeId:22,caliberId:'102',employeeName:'Operator Two',manualShift:'night',shiftName:'Night',bookShiftCode:'',cardShift:'I',shiftHours:12,masterShiftStart:'20:00'});
 const r=report([elb,lmv]);
 const duties=r.otDuties.map(d=>[d.employeeName,d.shift,d.logBook]).sort();
 assert.deepEqual(duties,[['Operator One','D','ELB'],['Operator Two','N','LMV']]);
 assert.ok(!r.exceptions.some(e=>/labels conflict/.test(e.reason)),'no card is left out for a shift conflict');
 const day=r.otDuties.find(d=>d.shift==='D');
 assert.ok(day,'Day duty present');
});

test('manual 8-hour ELB in the batch shift still counts',()=>{
 const r=report([card(3,'equipment',{manualShiftOverride:true,manualShift:''})]);
 assert.deepEqual(r.otDuties.map(d=>[d.shift,d.logBook]),[['S1','ELB']]);
});

test('Shift and Shift Hrs are mandatory on a manual ELB; Day / Night need 12 Hrs',()=>{
 assert.match(manualEntryShiftIssue({choice:'',shiftHours:8}),/Shift is mandatory/);
 assert.match(manualEntryShiftIssue({choice:'batch',shiftHours:''}),/Shift Hrs is mandatory/);
 assert.match(manualEntryShiftIssue({choice:'day',shiftHours:8}),/12 Hrs/);
 assert.match(manualEntryShiftIssue({choice:'batch',shiftHours:8,batchShift:'N'}),/12 Hrs/);
 assert.equal(manualEntryShiftIssue({choice:'night',shiftHours:12}),'');
 assert.equal(manualEntryShiftIssue({choice:'batch',shiftHours:8,batchShift:'S1'}),'');
 assert.equal(manualEntryShiftIssue({choice:'batch',shiftHours:'',flexibleHours:true}),'','Jayant takes its hours from the Shift Master');
 assert.match(manualEntryShiftIssue({choice:'',flexibleHours:true}),/Shift is mandatory/);
});

test('the log book save refuses an LMV with no shift and a Day / Night manual ELB with 8 Hrs',()=>{
 const base={bookDate:date,location:site,assetId:'2',employeeId:'21',openingKmr:100,closingKmr:120,shiftHours:8};
 assert.throws(()=>normalizeLogBook('lmv',{...base,shiftId:''},{manualEntry:true}),/Shift is mandatory/);
 assert.doesNotThrow(()=>normalizeLogBook('lmv',{...base,manualShift:'day'},{manualEntry:true}));
 assert.doesNotThrow(()=>normalizeLogBook('lmv',{...base,shiftId:'31'},{manualEntry:true}));
 const elb={bookDate:date,location:site,assetId:'1',employeeId:'21',shiftId:'31',openingHmr:100,closingHmr:106};
 assert.throws(()=>normalizeLogBook('equipment',{...elb,manualShift:'day',shiftHours:8},{manualEntry:true}),/12-hour/);
 assert.doesNotThrow(()=>normalizeLogBook('equipment',{...elb,manualShift:'day',shiftHours:12},{manualEntry:true}));
});

test('the ELB Manual machine entry starts with Shift and Shift Hrs blank and required',()=>{
 const source=readFileSync(new URL('../src/vlb-fleet-stepper.jsx',import.meta.url),'utf8');
 assert.match(source,/<option value="">Select shift<\/option><option value="batch">/);
 assert.match(source,/<option value="">Select hours<\/option>/);
 assert.match(source,/aria-label="Manual ELB Shift" required/);
 assert.match(source,/aria-label="Manual ELB Shift Hrs" required/);
 assert.match(source,/if\(shiftIssue\)\{setError\(shiftIssue\);return\}/);
 const stages=readFileSync(new URL('../server/rules/vlb-batch-stages.mjs',import.meta.url),'utf8');
 assert.match(stages,/manualEntryShiftIssue\(/,'the server checks it too');
});
