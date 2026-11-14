import test from 'node:test';import assert from 'node:assert/strict';
import {handoverTimeNote,isBlankHandoverIssue} from '../src/scan-handover-review.mjs';
test('handover notes are neutral and only describe a missing half with a valid other time',()=>{
 assert.match(handoverTimeNote({loadingTime:'23:50',unloadingTime:''},'unloadingTime'),/Open handover/);
 assert.match(handoverTimeNote({loadingTime:'',unloadingTime:'1:10'},'loadingTime'),/Loaded in the previous shift/);
 for(const row of [{loadingTime:'',unloadingTime:''},{loadingTime:'25:00',unloadingTime:''}])assert.equal(handoverTimeNote(row,'unloadingTime'),'');
 assert.equal(handoverTimeNote({loadingTime:'23:50'},'equipmentName'),'');
});
test('explicit missing-time notes are accepted without hiding invalid or unreadable evidence',()=>{
 const row={loadingTime:'12:00',unloadingTime:''};
 assert.equal(isBlankHandoverIssue(row,0,'unloadingTime',{},'Trip 1: missing unloading time'),true);
 assert.equal(isBlankHandoverIssue(row,0,'unloadingTime',{},'Trip 1: unreadable unloading time'),false);
 assert.equal(isBlankHandoverIssue(row,0,'unloadingTime',{hybrid:{trips:{r:[[1,'V12','12:00',null]]}}},'Trip 1: missing unloading time'),false);
});
test('previous-shift load: a "Load" word or blank loader is a handover, not a review error, and is not a machine trip',async()=>{
 const {manualScanIssues}=await import('../src/scan-manual-fields.mjs');
 const {isHandoverTimeMark,machineSummary,machineTripTotal,ignoreScanLoadingWithoutEquipment}=await import('../shared/trip-card-rules.mjs');
 for(const word of ['Load','LOADED','load.','-','—','Unload','shift end'])assert.equal(isHandoverTimeMark(word),true,word);
 for(const word of ['08:20','','V16','12'])assert.equal(isHandoverTimeMark(word),false,word);
 const trips=[{rowNumber:1,equipmentName:'',loadingTime:'',unloadingTime:'08:20',tripCount:1},{rowNumber:2,equipmentName:'V16',loadingTime:'08:42',unloadingTime:'08:59',tripCount:1}];
 const draft={doorText:'V/514',bookDate:'2026-11-06',location:'Majri OB',assetId:'1',employeeId:'2',shiftId:'3',shiftHours:8,openingHmr:7618,closingHmr:7625,openingKmr:124080.3,closingKmr:124210.3,timeMode:'with',trips,scanMachineSummary:[{equipmentName:'V16',tripCount:1}],extractionReviewFields:['trips']};
 assert.deepEqual(machineSummary(trips),[{equipmentName:'V16',tripCount:1}]);assert.equal(machineTripTotal(trips),1);
 for(const [cell,reason] of [['Load','Trip 1: check loading time.'],[null,'Trip 1: check loading time.'],['','Trip 1: loading/unloading time needs checking.']]){
  const raw={gemini:{trips:{r:[[1,'',cell,'08:20'],[2,'V16','08:42','08:59']]}},tripGridIssues:[reason]};
  assert.deepEqual(manualScanIssues(draft,'vehicle',raw),{},String(cell)+' '+reason);
 }
 // A written loader with an unreadable loading time still needs review.
 const loaded={...draft,trips:[{...trips[0],equipmentName:'V16'},trips[1]]};
 assert.ok(manualScanIssues(loaded,'vehicle',{gemini:{trips:{r:[[1,'V16',null,'08:20']]}},tripGridIssues:['Trip 1: check loading time.']})['trips.0.loadingTime']);
 // The word itself never stays in the time field.
 assert.equal(ignoreScanLoadingWithoutEquipment({timeMode:'with',trips:[{...trips[0],loadingTime:'Load'}]}).trips[0].loadingTime,'');
 assert.equal(ignoreScanLoadingWithoutEquipment({timeMode:'with',trips:[{equipmentName:'V16',loadingTime:'04:40',unloadingTime:'Unload',tripCount:1}]}).trips[0].unloadingTime,'');
});
