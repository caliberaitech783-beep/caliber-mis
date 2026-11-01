import test from 'node:test';
import assert from 'node:assert/strict';
import {compactLogBookLabel,tripSerialNumber} from '../log-book-labels.mjs';
import {buildOperationReport,normalise} from '../src/operations-report-model.mjs';
import {scanBatchReport,scanBatchExportTables} from '../scan-batch-report.mjs';

test('short labels keep trip count, employee identity and reading units distinct',()=>{
  assert.equal(compactLogBookLabel('Printed trip number'),'Tr.Sr.No');
  assert.equal(compactLogBookLabel('Opening KMR'),'OPN KMR');
  assert.equal(compactLogBookLabel('Closing HMR'),'CLO HMR');
  for(const label of ['Trips','Completed trips','Employee ID','Caliber ID','Scheduled start (IST)'])assert.equal(compactLogBookLabel(label),label);
});
test('printed serials survive reorder and older manual rows use a display-only fallback',()=>{
  const rows=[{rowNumber:9},{rowNumber:'8'},{}];
  assert.deepEqual(rows.map(tripSerialNumber),[9,'8',3]);
  assert.deepEqual([...rows].reverse().map(tripSerialNumber),[1,'8',9]);
  assert.deepEqual(rows,[{rowNumber:9},{rowNumber:'8'},{}]);
});
const data={bookDate:'2026-11-01',location:'Sasti OC',openingHmr:100,closingHmr:106,openingKmr:300,closingKmr:350,shiftHours:8,trips:[{rowNumber:8,equipmentName:'TPC50',tripCount:1,loadingTime:'10:49',unloadingTime:'11:12'}]};
test('ELB register excludes vehicle KMR while VLB keeps readings and both keep aligned columns',()=>{
  const rows=normalise([{id:1,book_type:'equipment',data},{id:2,book_type:'vehicle',data}]);
  const elb=buildOperationReport('equipment',rows),vlb=buildOperationReport('vehicle',rows);
  assert.ok(!elb.columns.some(c=>c.includes('KMR')||c==='KM'));
  assert.ok(elb.columns.includes('OPN HMR'));
  assert.equal(vlb.rows[0][vlb.columns.indexOf('OPN KMR')],300);
  for(const report of [elb,vlb])assert.equal(report.rows[0].length,report.columns.length);
  const timing=buildOperationReport('timing',rows);
  assert.equal(timing.rows[0][timing.columns.indexOf('Tr.Sr.No')],8);
  assert.equal(timing.rows[0][timing.columns.indexOf('Trips')],1);
});
test('batch Excel and PDF tables preserve the printed serial and numeric trip count',()=>{
  const report=scanBatchReport({id:'batch',kind:'vehicle'},[{id:'card',batch_id:'batch',ordinal:1,status:'posted',saved_data:{...data,scanCardId:'card',scanBatchId:'batch'}}]);
  for(const pdf of [false,true]){
    const table=scanBatchExportTables(report,{pdf}).find(t=>t.name==='Individual trips');
    assert.equal(table.rows[0][table.columns.findIndex(c=>c.label==='Tr.Sr.No')],8);
    assert.equal(table.rows[0][table.columns.findIndex(c=>c.label==='Trips')],1);
    assert.equal(table.rows[0][table.columns.findIndex(c=>c.label==='L. time')],'10:49');
  }
});
