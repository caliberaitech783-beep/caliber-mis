import test from 'node:test';
import assert from 'node:assert/strict';
import {scanReportCardStatus} from '../src/scan-report-card-status.mjs';
const draft={doorText:'S/14',bookDate:'2026-10-19',location:'Test site',assetId:'1',employeeId:'2',shiftId:'3',shiftHours:8,openingHmr:0,closingHmr:6,openingKmr:0,closingKmr:50,timeMode:'with',trips:[{equipmentName:'V12',loadingTime:'01:03',unloadingTime:'01:12',tripCount:1}],scanMachineSummary:[{equipmentName:'V12',tripCount:1}]};
const card={id:'c1',status:'review',draft,checks:{errors:[]}};
test('complete, processing, saved, failed and rejected cards stay distinct',()=>{
 assert.equal(scanReportCardStatus(card,'vehicle',null,null,{}).label,'Ready to save');
 assert.equal(scanReportCardStatus({...card,status:'reading',checks:{errors:['old error']}},'vehicle',null,null,{}).tone,'pending');
 assert.deepEqual(scanReportCardStatus({...card,status:'reading'},'vehicle',null,null,{}).messages,[]);
 assert.equal(scanReportCardStatus({...card,status:'posted'},'vehicle',null,null,{saved:true}).label,'Saved');
 assert.equal(scanReportCardStatus({...card,status:'error'},'vehicle',null,null,{}).tone,'error');
 assert.equal(scanReportCardStatus({...card,status:'rejected'},'vehicle',null,null,{}).label,'Rejected');
});
test('all issue categories are shown and incorrect cells carry reasons',()=>{
 const bad={...card,draft:{...draft,employeeId:'',closingHmr:'bad',scanMachineSummary:[{equipmentName:'V12',tripCount:2}]}};
 const result=scanReportCardStatus(bad,'vehicle',null,null,{employeeCode:'',closingHmr:'bad',trips:1});
 assert.equal(result.tone,'brown');assert.deepEqual(result.badges.map(b=>b.id),['wrong-caliber','wrong-hmr','mws-ted']);assert.equal(result.cells.employeeCode.tone,'red');assert.equal(result.cells.closingHmr.tone,'brown');assert.ok(result.cells.trips.message);
 assert.equal(scanReportCardStatus(card,'vehicle',null,null,{openingHmr:0}).cells.openingHmr,undefined);
});
test('context mismatches take precedence and target their date/site/shift cells',()=>{
 const result=scanReportCardStatus(card,'vehicle',null,null,{location:'Wrong OC',contextIssues:['Site: Wrong OC; expected Test site']});
 assert.equal(result.tone,'error');assert.match(result.cells.location.message,/Wrong OC/);
});
