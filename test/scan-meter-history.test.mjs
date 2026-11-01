import test from 'node:test';
import assert from 'node:assert/strict';
import {recordMeterCorrection,meterCorrectionReport} from '../scan-meter-history.mjs';
import {scanBatchReport,scanBatchExportTables} from '../scan-batch-report.mjs';
import {buildXlsxSheetsWorkbook} from '../report-xlsx.mjs';
import {buildTableExportPdf} from '../table-export-pdf.mjs';

const bad={shiftHours:8,openingHmr:100,closingHmr:109,openingKmr:1000,closingKmr:1251};
const fixed={...bad,closingHmr:107,closingKmr:1200};
test('uncorrected rule breaches report the card driver and Caliber ID without a green correction',()=>{
 const data={...bad,employeeName:'TEST DRIVER',caliberId:'CMPL123'};
 const report=meterCorrectionReport(data);
 assert.match(report.original,/TEST DRIVER/);assert.match(report.original,/CMPL123/);
 assert.match(report.original,/9 hours/);assert.match(report.original,/251 km/);
 assert.equal(report.corrected,'');
 const tables=scanBatchExportTables(scanBatchReport({id:'b',kind:'vehicle'},[{id:'c',batch_id:'b',ordinal:1,status:'posted',saved_data:{...data,scanCardId:'c',scanBatchId:'b'}}]));
 const cards=tables.find(table=>table.name==='Cards'),column=cards.columns.findIndex(column=>column.tone==='error');
 assert.match(cards.rows[0][column],/TEST DRIVER.*CMPL123/);
});
test('meter errors survive partial corrections, repeated saves and later valid changes',()=>{
 const first=recordMeterCorrection([],bad,{...bad,closingHmr:107},'vehicle','reviewer','2026-11-01T10:00:00Z');
 assert.match(first[0].issues.closingHmr,/9 hours/);assert.match(first[0].issues.closingKmr,/251 km/);
 const second=recordMeterCorrection(first,{...bad,closingHmr:107},fixed,'vehicle','reviewer');
 assert.equal(second.length,2);assert.deepEqual(recordMeterCorrection(second,fixed,{...fixed,remark:'updated'},'vehicle'),second);
 const third=recordMeterCorrection(second,fixed,{...fixed,closingHmr:106},'vehicle','editor');
 const report=meterCorrectionReport({...fixed,closingHmr:106,meterCorrectionHistory:third});
 assert.match(report.original,/109/);assert.match(report.original,/1251/);assert.match(report.corrected,/106 \(6 hours\)/);assert.match(report.corrected,/editor/);
 assert.equal(first.length,1,'older history is immutable');
});
test('all meter rules are recorded, equipment excludes KMR and valid edits stay unflagged',()=>{
 for(const before of [{...fixed,closingHmr:99},{...fixed,openingHmr:''},{...fixed,openingHmr:'abc'},{...fixed,openingHmr:-1},{...fixed,shiftHours:12,closingHmr:113},{...fixed,shiftHours:12,closingKmr:1351}])assert.ok(Object.keys(recordMeterCorrection([],before,fixed)[0].issues).length);
 assert.deepEqual(recordMeterCorrection([],fixed,{...fixed,closingHmr:106}),[]);
 assert.deepEqual(recordMeterCorrection([],{...fixed,closingKmr:2000},fixed,'equipment'),[]);
});
test('saved report retains red original errors, green corrections and corrected totals in exports',async()=>{
 const history=recordMeterCorrection([],bad,fixed,'vehicle','reviewer'),batch={id:'batch',kind:'vehicle'};
 const report=scanBatchReport(batch,[{id:'card',batch_id:'batch',ordinal:1,status:'posted',saved_data:{...fixed,meterCorrectionHistory:history,scanCardId:'card',scanBatchId:'batch'}}]);
 assert.equal(report.counts.saved,1);assert.equal(report.totals.hours,7);assert.equal(report.totals.kilometres,200);
 for(const pdf of [false,true]){
  const tables=scanBatchExportTables(report,{pdf}),cards=tables.find(table=>table.name==='Cards');
  assert.equal(cards.columns.find(column=>column.key==='original').tone,'error');assert.equal(cards.columns.find(column=>column.key==='corrected').tone,'corrected');
  const bytes=Buffer.from(await buildXlsxSheetsWorkbook('Audit',tables).arrayBuffer()).toString();assert.match(bytes,/FFB91C1C/);assert.match(bytes,/FF15803D/);assert.match(bytes,/s="7"/);assert.match(bytes,/s="8"/);assert.match(bytes,/109/);
  const document=await buildTableExportPdf({title:'Audit',columns:cards.columns,rows:cards.rows});const text=document.toString();assert.ok(text.includes(`${185/255} ${28/255} ${28/255} scn`));assert.ok(text.includes(`${21/255} ${128/255} ${61/255} scn`));
 }
});
