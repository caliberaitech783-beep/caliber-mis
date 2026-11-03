import test from 'node:test';
import assert from 'node:assert/strict';
import {machineSummary,machineTripTotal,machineDiscrepancies} from '../trip-card-rules.mjs';
import {completeScanTripDetails} from '../scan-trip-completion.mjs';
import {estimateMissingTripTimes} from '../scan-trip-estimates.mjs';
import {buildMachineSnapshot,buildFleetList} from '../vlb-two-stage.mjs';
import {scanBatchReport,scanBatchReportTables} from '../scan-batch-report.mjs';

const carry={equipmentName:'V19',equipmentId:'19',loadingTime:'',unloadingTime:'05:10',tripCount:1};
const loaded={equipmentName:'V19',equipmentId:'19',loadingTime:'05:30',unloadingTime:'05:50',tripCount:1};
const site='Sasti OC';
const assets=[{id:'19',category:'Equipment',door:'VPC-019',equipmentName:'VPC 019',currentLocation:site}];

test('MWS excludes the opening unloading-only row without altering trip details',()=>{
 const trips=[{...carry}, {...loaded}, {...loaded,loadingTime:'06:10',unloadingTime:''}];
 const before=structuredClone(trips);
 assert.deepEqual(machineSummary(trips),[{equipmentName:'V19',tripCount:2}]);
 assert.equal(machineTripTotal(trips),2);
 assert.deepEqual(machineDiscrepancies(trips,[{equipmentName:'V19',tripCount:2}]),[]);
 assert.ok(machineDiscrepancies(trips,[{equipmentName:'V19',tripCount:3}]).length);
 assert.deepEqual(trips,before);
 assert.deepEqual(machineSummary([carry]),[]);
 assert.equal(machineTripTotal([carry]),0);
});

test('unloading-only rows are excluded at any position while loading-only and untimed counts stay valid',()=>{
 const blank={equipmentName:'',loadingTime:'',unloadingTime:'',tripCount:''};
 assert.equal(machineTripTotal([blank,{...carry,loadingTime:'  '},loaded]),1);
 assert.equal(machineTripTotal([{...carry,loadingTime:null},loaded]),1);
 assert.equal(machineTripTotal([loaded,carry]),1,'unloading-only rows are excluded wherever they occur');
 assert.equal(machineTripTotal([{...loaded,unloadingTime:''}]),1,'loading without unloading still counts');
 assert.equal(machineTripTotal([{...loaded,loadingTime:'00:00',unloadingTime:'00:20'}]),1);
 const untimed=[{equipmentName:'V19',tripCount:4},{equipmentName:'V20',tripCount:2}];
 assert.equal(machineTripTotal(untimed),6);
 assert.deepEqual(machineSummary(untimed),untimed);
});

test('estimated loading does not create a machine trip; an actual corrected loading time does',()=>{
 const draft=estimateMissingTripTimes({timeMode:'with',trips:[carry,loaded]});
 assert.equal(draft.trips[0].loadingTime,'04:48');
 assert.equal(machineTripTotal(draft.trips),1);
 assert.deepEqual(machineSummary(draft.trips),[{equipmentName:'V19',tripCount:1}]);
 const corrected=draft.trips.map((row,i)=>i===0?{...row,loadingTime:'05:00'}:row);
 assert.equal(machineTripTotal(corrected),2);
});

test('scan-derived summary remains stable after estimates and repeated correction saves',()=>{
 const input={timeMode:'with',trips:[{...carry,rowNumber:1},{...loaded,rowNumber:2}],scanMachineSummary:[]};
 const once=completeScanTripDetails(input),twice=completeScanTripDetails(once);
 assert.equal(once.scanMachineSummary[0].tripCount,1);
 assert.deepEqual(twice,once);
 assert.deepEqual(machineDiscrepancies(twice.trips,twice.scanMachineSummary),[]);
 const manual=completeScanTripDetails({...input,scanMachineSummarySource:'manual',scanMachineSummary:[{equipmentName:'V19',tripCount:7}]});
 assert.equal(manual.scanMachineSummary[0].tripCount,7,'written/manual evidence is retained for review');
});

test('printed machine-number inference compares only the loading rows to the printed count',()=>{
 const trips=[{...carry,equipmentName:'TPC63 - 05',rowNumber:1},{...loaded,equipmentName:'T',rowNumber:2},{...loaded,equipmentName:'T',rowNumber:3}];
 const result=completeScanTripDetails({trips,scanMachineSummary:[{equipmentName:'TPC63',tripCount:2}]});
 assert.deepEqual(result.trips.map(row=>row.equipmentName),['TPC63 - 05','TPC63','TPC63'],'current loading totals do not infer the prior load machine');
 assert.deepEqual(machineDiscrepancies(result.trips,result.scanMachineSummary),[]);
});

test('ELB machine snapshot excludes carry-over rows separately for each card',()=>{
 const record=(book_no,trips)=>({book_no,data:{location:site,trips}});
 const result=buildMachineSnapshot([record('A',[carry,loaded]),record('B',[carry,loaded]),record('C',[carry])],assets,site);
 assert.deepEqual(result.machines.map(m=>[m.assetId,m.trips,m.sourceCards]),[['19',2,2]]);
 assert.deepEqual(result.unresolved,[]);
 const onlyCarry=buildMachineSnapshot([record('C',[carry])],assets,site);
 assert.deepEqual(onlyCarry.machines,[]);
 assert.equal(buildFleetList(assets,site,onlyCarry.machines)[0].trips,0,'site machine remains in the fleet with zero loads');
 const estimated=estimateMissingTripTimes({timeMode:'with',trips:[carry,loaded]});
 assert.equal(buildMachineSnapshot([record('E',estimated.trips)],assets,site).machines[0].trips,1);
});

test('batch MWS and its export exclude opening unloading while vehicle completions remain intact',()=>{
 const batch={id:'batch',kind:'vehicle',name:'Shift 1'};
 const card=(id,trips,totalTrips)=>({id,batch_id:batch.id,ordinal:Number(id),status:'posted',book_no:'VLB/'+id,saved_data:{scanCardId:id,scanBatchId:batch.id,location:site,door:'T'+id,trips,totalTrips}});
 const cards=[card('1',[{...carry,completedTrips:1},{...loaded,unloadingTime:'',completedTrips:0}],1),card('2',[{...carry,completedTrips:1}],1)];
 const report=scanBatchReport(batch,cards,{assets});
 assert.equal(report.totals.trips,2,'vehicle completion accounting is unchanged');
 assert.equal(report.tripRows.length,3,'the unloading records are retained');
 assert.deepEqual(report.machineRows.map(row=>[row.trips,row.cards,row.vehicles]),[[1,1,1]]);
 assert.equal(scanBatchReportTables(report).find(table=>table.name==='Loading equipment').rows[0].trips,1);
 assert.deepEqual(scanBatchReport(batch,[cards[1]],{assets}).machineRows,[]);
});
