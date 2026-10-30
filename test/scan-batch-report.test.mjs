import test from 'node:test';import assert from 'node:assert/strict';
import {scanBatchReport,scanBatchReportTables,scanBatchExportTables} from '../scan-batch-report.mjs';
import {buildXlsxSheetsWorkbook} from '../report-xlsx.mjs';
const batch={id:'11111111-1111-4111-a111-111111111111',kind:'vehicle',name:'This scan run',created_at:'2026-10-28T12:00:00Z'};
const data={aFormNo:'75',bookDate:'2026-10-19',location:'Sasti OC',door:'V1',caliberId:'CMPL1',employeeName:'Driver One',shiftName:'Shift I',shiftHours:8,openingKmr:0,closingKmr:40,totalRunningKmr:40,openingHmr:0,closingHmr:6,totalWorkingHmr:6,totalTrips:2,trips:[{equipmentName:'D19',loadingTime:'09:02',unloadingTime:'09:09',tripCount:2}]};
const card=(id,ordinal,extra={})=>({id,batch_id:batch.id,ordinal,status:'posted',filename:id+'.png',book_no:'BOOK-'+id,page_count:1,draft:{...data,totalTrips:999,closingKmr:999},saved_data:{...data,scanCardId:id,scanBatchId:batch.id},...extra});
test('a report includes exactly its batch cards and totals only active saved log books',()=>{
 const members=[card('two',2,{saved_data:{...data,scanCardId:'two',scanBatchId:batch.id,door:'V2',totalTrips:3,totalRunningKmr:60,totalWorkingHmr:4,trips:[{equipmentName:'D19',tripCount:3}]}}),card('one',1),card('pending',3,{status:'review',saved_data:null}),card('rejected',4,{status:'rejected',saved_data:null}),card('deleted',5,{logbook_deleted_at:'2026-10-28'})];
 const input=[...members,card('other-batch',1,{batch_id:'other'})],before=JSON.stringify(input),r=scanBatchReport(batch,input);
 assert.equal(r.counts.cards,5);assert.equal(r.counts.saved,2);assert.equal(r.counts.pending,1);assert.equal(r.counts.rejected,1);assert.equal(r.counts.deleted,1);
 assert.deepEqual(r.totals,{trips:5,kilometres:100,hours:10});assert.deepEqual(r.rows.map(c=>c.id),['one','two','pending','rejected','deleted']);assert.equal(r.rows[0].employeeName,'Driver One');assert.equal(r.rows[0].kilometres,40);
 assert.equal(r.tripRows.length,2);assert.deepEqual(r.machineRows,[{equipment:'D19',trips:5,cards:2,vehicles:2}]);assert.equal(JSON.stringify(input),before);
});
test('another batch with the same day and door stays separate, and mismatched saved links do not enter totals',()=>{
 const r=scanBatchReport({...batch,id:'other'},[card('one',1),card('two',1,{batch_id:'other',saved_data:{...data,scanCardId:'two',scanBatchId:'other'}})]);assert.equal(r.counts.cards,1);assert.equal(r.totals.trips,2);
 for(const saved_data of [null,{...data,scanCardId:'wrong',scanBatchId:batch.id},{...data,scanCardId:'one',scanBatchId:'other'}]){const result=scanBatchReport(batch,[card('one',1,{saved_data})]);assert.equal(result.counts.saved,0);assert.equal(result.totals.hours,null);}
});
test('zero readings are preserved; pending cards never inflate totals and ELB omits vehicle-only measures',()=>{
 const r=scanBatchReport(batch,[card('one',1,{saved_data:{...data,scanCardId:'one',scanBatchId:batch.id,totalTrips:0,totalWorkingHmr:0,totalRunningKmr:0}})]);assert.deepEqual(r.totals,{trips:0,kilometres:0,hours:0});
 const pending=scanBatchReport(batch,[card('one',1,{status:'reading',saved_data:null,draft:{}})]);assert.equal(pending.counts.pending,1);assert.equal(pending.totals.trips,null);
 const equipment=scanBatchReport({...batch,kind:'equipment'},[card('one',1,{saved_data:{...data,jobCardNo:'E75',scanCardId:'one',scanBatchId:batch.id}})]);assert.equal(equipment.rows[0].cardNo,'E75');assert.equal(equipment.totals.kilometres,null);assert.equal(scanBatchExportTables(equipment).length,2);
 assert.equal(scanBatchReport(null,[]),null);assert.equal(scanBatchReport(batch,[]).counts.cards,0);
});
test('Excel has summary, card details, individual trips and machine totals scoped to the batch',async()=>{
 const r=scanBatchReport(batch,[card('one',1),card('foreign',1,{batch_id:'foreign'})]),tables=scanBatchExportTables(r);
 assert.deepEqual(tables.map(t=>t.name),['Batch summary','Cards','Individual trips','Loading equipment']);assert.equal(tables[1].rows.length,1);
 const bytes=Buffer.from(await buildXlsxSheetsWorkbook(r.title,tables).arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),'PK');const xml=bytes.toString('utf8');assert.match(xml,/Driver One/);assert.doesNotMatch(xml,/BOOK-foreign/);
 const pdf=scanBatchExportTables(r,{pdf:true});assert.ok(pdf[1].columns.length<tables[1].columns.length);assert.equal(pdf[1].rows.length,1);assert.equal(pdf[2].rows.length,1);
});

test('linked handover legs retain driver credits and count one completed trip in reports',()=>{
 const loading=card('loading',1,{saved_data:{...data,scanCardId:'loading',scanBatchId:batch.id,openingTrips:1,endingTrips:0,totalTrips:0,trips:[{equipmentName:'D19',loadingTime:'12:30',unloadingTime:'',tripCount:1,completedTrips:0}]}});
 const unloading=card('unloading',2,{saved_data:{...data,scanCardId:'unloading',scanBatchId:batch.id,openingTrips:0,endingTrips:1,totalTrips:1,trips:[{equipmentName:'D19',loadingTime:'',unloadingTime:'13:30',tripCount:1,completedTrips:1}]}});
 const report=scanBatchReport(batch,[loading,unloading]);assert.equal(report.totals.trips,1);assert.equal(report.machineRows[0].trips,1);
 assert.equal(report.rows[0].openingTrips,1);assert.equal(report.rows[1].endingTrips,1);
 assert.equal(scanBatchReport(batch,[loading]).totals.trips,0);assert.equal(scanBatchReport(batch,[unloading]).totals.trips,1);
});

test('selected scan context keeps wrong, removed and unresolved cards out of Excel, including edited wrong originals',async()=>{
 const expected={bookDate:'2026-10-28',location:'Sasti OC',cardShift:'I'},scoped={...batch,expected_context:{...expected,confirmed:true}};
 const good=card('matching',1,{draft:{...data,...expected},saved_data:{...data,...expected,scanCardId:'matching',scanBatchId:batch.id},raw_fields:{extractionDraft:expected}});
 const wrongDate=card('wrong-date',2,{draft:{...expected,bookDate:'2026-10-27'},saved_data:{...data,...expected,bookDate:'2026-10-27',scanCardId:'wrong-date',scanBatchId:batch.id},raw_fields:{extractionDraft:{...expected,bookDate:'2026-10-27'}}});
 const editedWrong=card('edited-wrong',3,{draft:expected,saved_data:{...data,...expected,scanCardId:'edited-wrong',scanBatchId:batch.id},raw_fields:{extractionDraft:{...expected,cardShift:'II'}}});
 const pending=card('pending-correct',4,{status:'review',draft:expected,saved_data:null,raw_fields:{extractionDraft:expected}});
 const removed=card('removed',5,{status:'rejected',draft:expected,saved_data:null,review_note:'Removed from batch: wrong date, site or shift'});
 const report=scanBatchReport(scoped,[good,wrongDate,editedWrong,pending,removed]);assert.deepEqual(report.rows.map(r=>r.id),['matching','pending-correct']);
 assert.equal(scanBatchReportTables(report).find(t=>t.name==='Cards').rows.length,1,'on-screen table exports also contain saved matching cards only');
 const exported=scanBatchExportTables(report).find(t=>t.name==='Cards');assert.equal(exported.rows.length,1);assert.equal(exported.rows[0][0],1);assert.doesNotMatch(JSON.stringify(scanBatchExportTables(report)),/BOOK-wrong-date|BOOK-edited-wrong|BOOK-removed|BOOK-pending-correct/);
 const bytes=Buffer.from(await buildXlsxSheetsWorkbook(report.title,scanBatchExportTables(report)).arrayBuffer());assert.match(bytes.toString('utf8'),/BOOK-matching/);assert.doesNotMatch(bytes.toString('utf8'),/BOOK-wrong-date|BOOK-edited-wrong|BOOK-removed|BOOK-pending-correct/);
});
test('a rejected matching card remains visible and is counted in a context-checked batch',()=>{
 const expected={bookDate:'2026-10-28',location:'Sasti OC',cardShift:'I'},scoped={...batch,expected_context:{...expected,confirmed:true}};
 const rejected=card('rejected-matching',1,{status:'rejected',draft:{...data,...expected},saved_data:null,raw_fields:{extractionDraft:expected}});
 const report=scanBatchReport(scoped,[rejected]);assert.equal(report.counts.cards,1);assert.equal(report.counts.rejected,1);assert.equal(report.counts.pending,0);assert.equal(report.rows[0].status,'Rejected');
});
test('the on-screen report resolves the driver from the selected employee master',()=>{
 const pending=card('driver',1,{status:'review',saved_data:null,draft:{...data,employeeId:'42',employeeName:''},raw_fields:{employeeCode:'CMLL42'}});
 const report=scanBatchReport(batch,[pending],{employees:[{id:42,name:'DRIVER NAME',caliberId:'CMLL42'}]});
 assert.equal(report.rows[0].employeeName,'DRIVER NAME');assert.equal(report.rows[0].employeeCode,'CMPL1');
});

test('context-filtered reports count rejected cards even when their blank headers cannot match',()=>{
 const expected={bookDate:'2026-10-28',location:'Sasti OC',cardShift:'I'},scoped={...batch,expected_context:{...expected,confirmed:true}};
 const good=card('saved',1,{draft:expected,saved_data:{...data,...expected,scanCardId:'saved',scanBatchId:batch.id},raw_fields:{extractionDraft:expected}});
 const pending=card('pending',2,{status:'review',draft:expected,saved_data:null,raw_fields:{extractionDraft:expected}});
 const rejected=card('rejected',3,{status:'rejected',draft:{},saved_data:null,raw_fields:{}});
 const matchingRejected=card('matching-rejected',4,{status:'rejected',draft:expected,saved_data:null,raw_fields:{extractionDraft:expected}});
 const removed=card('removed',5,{status:'rejected',draft:expected,saved_data:null,review_note:'Removed from batch: wrong date, site or shift'});
 const report=scanBatchReport(scoped,[good,pending,rejected,matchingRejected,removed,card('foreign',6,{batch_id:'other',status:'rejected'})]);
 assert.equal(report.counts.saved,1);assert.equal(report.counts.rejected,2);assert.equal(report.counts.pending,1);assert.equal(report.counts.cards,4);
 assert.deepEqual(report.rows.map(row=>row.id),['saved','pending','matching-rejected']);
 assert.deepEqual(scanBatchExportTables(report).find(table=>table.name==='Cards').rows.map(row=>row[0]),[1]);
 assert.equal(report.summaryRows.find(row=>row.metric==='Rejected cards').value,2);
});
