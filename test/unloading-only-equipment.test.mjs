import test from 'node:test';
import assert from 'node:assert/strict';
import {tripEquipmentRequired,machineSummary} from '../shared/trip-card-rules.mjs';
import {validateTripEquipment} from '../shared/trip-equipment-validation.mjs';
import {scanEquipmentMatchIssues} from '../shared/scan-machine-rules.mjs';
import {manualScanIssues} from '../src/scan-manual-fields.mjs';
import {activeResponseRecoveryIssues,responseReviewNeeded} from '../shared/scan-response-recovery.mjs';
import {completeScanTripDetails} from '../shared/scan-trip-completion.mjs';
import {scanFleetIssues,scanFleetSignature} from '../shared/scan-fleet-assignment.mjs';
import {canAutoSaveScanCard} from '../shared/scan-auto-save.mjs';
import {cardReviewGroup,reviewGroupSummary} from '../shared/scan-card-groups.mjs';
import {nextTripEntry} from '../shared/trip-entry.mjs';

const unload={rowNumber:1,equipmentName:'',loadingTime:'',unloadingTime:'08:10',tripCount:1};
const load={rowNumber:2,equipmentName:'V12',loadingTime:'08:30',unloadingTime:'',tripCount:1};
const options={assets:[{id:'1',door:'Vpc12',site:'Jayant OC',kind:'equipment'}],employees:[{id:'2'}],shifts:[{id:'3'}]};
const valid={machineNotationRuleVersion:1,tripBodyRuleVersion:2,doorText:'S/14',bookDate:'2026-10-19',location:'Jayant OC',assetId:'1',employeeId:'2',shiftId:'3',shiftHours:8,openingHmr:0,closingHmr:6,openingKmr:0,closingKmr:50,aFormNo:'75',timeMode:'with',trips:[unload,load],scanMachineSummary:[{equipmentName:'V12',tripCount:1}],extractionReviewFields:['trips']};

test('unloading-only rows need no machine, including missing numbers and estimated loading times',()=>{
 for(const equipmentName of ['',null,'  ','V']){
  const draft={...valid,trips:[{...unload,equipmentName},load]};
  assert.equal(tripEquipmentRequired(draft.trips[0]),false);
  assert.deepEqual(validateTripEquipment(draft,options.assets).issues,{});
  assert.deepEqual(scanEquipmentMatchIssues(draft,options.assets),{});
  assert.deepEqual(manualScanIssues(draft,'vehicle',{},options),{});
 }
 const estimated={...unload,loadingTime:'07:50',timeEstimates:{loadingTime:{value:'07:50',anchorField:'unloadingTime',anchorValue:'08:10'}}};
 assert.equal(tripEquipmentRequired(estimated),false);
 assert.equal(tripEquipmentRequired({...estimated,loadingTime:'07:55'}),true);
 assert.equal(tripEquipmentRequired(unload,'without'),true);
 assert.equal(tripEquipmentRequired({...unload,unloadingTime:''}),true);
});

test('missing machines still flag actual loads and aggregate entries; bad times are retained',()=>{
 for(const patch of [{trips:[{...load,equipmentName:''}]},{timeMode:'without',trips:[{...unload,equipmentName:''}]},{trips:[{...unload,unloadingTime:''}]}]){
  const draft={...valid,...patch};
  assert.ok(manualScanIssues(draft,'vehicle',{},options)['trips.0.equipmentName']);
  assert.ok(validateTripEquipment(draft,options.assets).issues['trips.0.equipmentName']);
 }
 assert.ok(manualScanIssues({...valid,trips:[{...unload,unloadingTime:'29:00'}],scanMachineSummary:[]})['trips.0.unloadingTime']);
 assert.ok(scanEquipmentMatchIssues({...valid,trips:[{...load,equipmentName:'V'}],scanMachineSummary:[]},options.assets)['trips.0.equipmentName']);
 assert.ok(validateTripEquipment({...valid,scanMachineSummary:[{equipmentName:'V',tripCount:1}]},options.assets).issues['scanMachineSummary.0.equipmentName']);
});

test('machine OCR notes on unloading rows do not mark or count a card as an error or block auto-save',()=>{
 const raw={gemini:{trips:{r:[[1,'V','','08:10'],[2,'V12','08:30','']]}},tripGridIssues:['Trip 1: equipment type/number needs checking.'],responseRecoveryIssues:['Trip row 1: equipment number missing or unreadable; re-read the NO column.']};
 const draft={...valid,trips:[{...unload,equipmentName:'V'},load]},before=JSON.stringify({raw,draft});
 const card={status:'review',draft,raw_fields:raw,checks:{errors:[],warnings:[]}};
 assert.deepEqual(activeResponseRecoveryIssues(raw,draft),[]);
 assert.equal(responseReviewNeeded(raw,draft),false);
 assert.deepEqual(manualScanIssues(draft,'vehicle',raw,options),{});
 assert.equal(cardReviewGroup(card,'vehicle',options),'orange');
 assert.equal(reviewGroupSummary([card],'vehicle',options).attention,0);
 assert.equal(canAutoSaveScanCard(card,'vehicle',options),true);
 assert.equal(JSON.stringify({raw,draft}),before,'source OCR and draft are never erased');
 const onlyUnload={...card,draft:{...draft,trips:[unload],scanMachineSummary:[]}};
 assert.equal(canAutoSaveScanCard(onlyUnload,'vehicle',options),true);
});

test('recovery filtering follows printed rows and retains non-equipment errors and loading-row errors',()=>{
 const raw={gemini:{trips:{r:[[7,null,'','08:10'],[8,'V','08:30','']]}},responseRecoveryIssues:['Trip row 1: equipment unreadable','Trip row 2: equipment number missing','Trip row 1: unloading time unreadable','Trip numbering: duplicate printed numbers']};
 const draft={...valid,trips:[{...load,rowNumber:8},{...unload,rowNumber:7}]};
 assert.deepEqual(activeResponseRecoveryIssues(raw,draft),raw.responseRecoveryIssues.slice(1));
 assert.equal(responseReviewNeeded(raw,draft),true);
 assert.ok(activeResponseRecoveryIssues(raw,{...draft,trips:[]}).includes(raw.responseRecoveryIssues[0]));
});

test('summary discrepancies flag only machine loads and preserve unloading rows',()=>{
 const issues=manualScanIssues({...valid,scanMachineSummary:[{equipmentName:'V12',tripCount:2}]},'vehicle',{},options);
 assert.ok(issues.scanMachineSummary);assert.ok(issues['trips.1.equipmentName']);assert.equal(issues['trips.0.equipmentName'],undefined);
});

test('completion derives MWS without filling unloading-only machine numbers',()=>{
 const raw={responseRecoveryIssues:['Trip row 1: equipment unreadable']};
 const input={...valid,scanMachineSummary:[]},before=JSON.stringify(input);
 const result=completeScanTripDetails(input,raw);
 assert.equal(result.trips[0].equipmentName,'');assert.equal(result.scanMachineSummarySource,'calculated-from-trips');
 assert.deepEqual(result.scanMachineSummary,machineSummary([load]));
 assert.deepEqual(completeScanTripDetails(result,raw),result);
 const middle=completeScanTripDetails({...valid,trips:[{...load,rowNumber:1},{...unload,rowNumber:2},{...load,rowNumber:3,equipmentName:''}],scanMachineSummary:[]});
 assert.equal(middle.trips[1].equipmentName,'');assert.equal(middle.trips[2].equipmentName,'');
 assert.equal(JSON.stringify(input),before);
});

test('fleet verification skips unloading-only machines and rechecks when actual loading is entered',()=>{
 const fleet=[{door:'S14',currentLocation:'Jayant OC'},{door:'V12',currentLocation:'Jayant OC'}];
 const draft={...valid,trips:[{...unload,equipmentName:'V'},load]};
 assert.deepEqual(scanFleetIssues(fleet,draft),[]);
 const changed={...draft,trips:[{...unload,equipmentName:'V99',loadingTime:'08:00'},load]};
 assert.notEqual(scanFleetSignature(draft),scanFleetSignature(changed));
 assert.deepEqual(scanFleetIssues(fleet,changed)[0].fields,['trips.0.equipmentName']);
 assert.deepEqual(scanFleetIssues(fleet,{...draft,doorText:'S99'})[0].fields,['doorText']);
 assert.deepEqual(scanFleetIssues(fleet,{...draft,scanMachineSummary:[{equipmentName:'V99'}]})[0].fields,['scanMachineSummary.0.equipmentName']);
});

test('manual trip entry advances an unloading-only row without a loader, but not a loading row',()=>{
 assert.equal(nextTripEntry([unload],0).nextIndex,1);
 assert.ok(nextTripEntry([{...load,equipmentName:''}],0).error);
 assert.ok(nextTripEntry([unload],0,'without').error);
});
