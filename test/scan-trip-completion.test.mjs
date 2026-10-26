import test from 'node:test';
import assert from 'node:assert/strict';
import {completeScanTripDetails} from '../scan-trip-completion.mjs';
const row=(rowNumber,equipmentName)=>({rowNumber,equipmentName,loadingTime:'09:00',unloadingTime:'09:20',tripCount:1});

test('blank paper summary is counted from populated rows and repeated equipment above',()=>{
 const input={trips:[row(1,'B75'),row(2,''),row(3,''),row(4,'V19'),row(5,'')],scanMachineSummary:[]};
 const before=JSON.stringify(input),result=completeScanTripDetails(input);
 assert.deepEqual(result.trips.map(r=>r.equipmentName),['B75','B75','B75','V19','V19']);
 assert.deepEqual(result.scanMachineSummary,[{equipmentName:'B75',tripCount:3},{equipmentName:'V19',tripCount:2}]);
 assert.equal(result.scanMachineSummarySource,'calculated-from-trips');assert.equal(JSON.stringify(input),before);
 assert.deepEqual(completeScanTripDetails(result),result);
});
test('unreadable equipment, gaps, and unused rows block carry and a complete summary',()=>{
 for(const trips of [[row(1,''),row(2,'')],[row(1,'B75'),row(3,'')],[row(1,'B75'),{rowNumber:2,equipmentName:'',tripCount:1}]]){
  const result=completeScanTripDetails({trips});assert.equal(result.trips.at(-1).equipmentName,'');assert.deepEqual(result.scanMachineSummary,[]);
 }
 const result=completeScanTripDetails({trips:[row(1,'B75'),row(2,''),row(3,'')]},{gemini:{trips:{r:[[1,'B75','09:00','09:20'],[2,null,'09:30','09:45'],[3,'','10:00','10:20']]}}});
 assert.deepEqual(result.trips.map(r=>r.equipmentName),['B75','','']);
});
test('written counts and unreadable summary values are not replaced by calculated totals',()=>{
 const input={trips:[row(1,'B75'),row(2,'')],scanMachineSummary:[{equipmentName:'B75',tripCount:9}]};
 assert.equal(completeScanTripDetails(input).scanMachineSummary[0].tripCount,9);
 const raw={gemini:{fields:{machineSummary:[{equipmentName:{status:'unclear'},tripCount:{status:'unclear'}}]}}};
 assert.deepEqual(completeScanTripDetails({...input,scanMachineSummary:[{equipmentName:'',tripCount:0}]},raw).scanMachineSummary,[{equipmentName:'',tripCount:0}]);
});
test('missing summary number uses a unique detail machine and missing count uses its row total',()=>{
 const input={trips:[row(1,'B75'),row(2,'')],scanMachineSummary:[{equipmentName:'',tripCount:''}]};
 assert.deepEqual(completeScanTripDetails(input).scanMachineSummary,[{equipmentName:'B75',tripCount:2}]);
 const partial={...input,scanMachineSummary:[{equipmentName:'B75',tripCount:''}]};
 assert.equal(completeScanTripDetails(partial).scanMachineSummary[0].tripCount,2);
});
test('calculated totals follow corrected detail trips; explicit manual summaries are retained',()=>{
 const result=completeScanTripDetails({trips:[row(1,'B75')],scanMachineSummary:[]});
 const edited=completeScanTripDetails({...result,trips:[...result.trips,row(2,'B75')]});
 assert.equal(edited.scanMachineSummary[0].tripCount,2);
 const manual=completeScanTripDetails({...edited,scanMachineSummarySource:'manual',scanMachineSummary:[{equipmentName:'B75',tripCount:8}]});
 assert.equal(manual.scanMachineSummary[0].tripCount,8);
});
