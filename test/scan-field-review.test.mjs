import test from 'node:test';import assert from 'node:assert/strict';import {scanFieldIssues,scanFieldState} from '../src/scan-field-review.mjs';
const valid={bookDate:'2026-10-13',location:'Jayant OC',assetId:'1',employeeId:'2',shiftId:'3',shiftHours:8,openingHmr:0,closingHmr:4,openingKmr:100,closingKmr:120,aFormNo:'2230',timeMode:'with',trips:[{equipmentName:'35',loadingTime:'06:25',unloadingTime:'06:36',tripCount:1}]};
test('only unresolved fields are flagged and flags clear as values are corrected',()=>{assert.deepEqual(scanFieldIssues(valid),{});const issues=scanFieldIssues({...valid,employeeId:'',shiftId:'',closingKmr:'bad'});assert.deepEqual(Object.keys(issues).sort(),['closingKmr','employeeId','shiftId']);assert.ok(!issues.openingHmr);assert.deepEqual(scanFieldIssues({...valid,employeeId:'4'}),{});});
test('invalid dates, readings and individual trip cells are flagged',()=>{const issues=scanFieldIssues({...valid,bookDate:'2026-02-31',closingHmr:'bad',trips:[{equipmentName:'',loadingTime:'29:20',unloadingTime:'',tripCount:0}]});for(const key of ['bookDate','closingHmr','trips.0.equipmentName','trips.0.loadingTime','trips.0.tripCount'])assert.ok(issues[key]);assert.ok(!issues['trips.0.unloadingTime']);assert.ok(!scanFieldIssues({...valid,timeMode:'without',trips:[{equipmentName:'35',tripCount:1}]})['trips.0.loadingTime']);});

test('missing scan fields differ from incorrect filled values, including trip cells',()=>{
 const draft={...valid,employeeId:' ',closingKmr:'bad',trips:[{equipmentName:'',loadingTime:'29:20',unloadingTime:'',tripCount:0}]};
 const issues=scanFieldIssues(draft);
 assert.equal(scanFieldState(draft,'employeeId',issues),'missing');
 assert.equal(scanFieldState(draft,'closingKmr',issues),'invalid');
 assert.equal(scanFieldState(draft,'trips.0.equipmentName',issues),'missing');
 assert.equal(scanFieldState(draft,'trips.0.loadingTime',issues),'invalid');
 assert.equal(scanFieldState(draft,'trips.0.tripCount',issues),'invalid');
 assert.equal(scanFieldState(draft,'openingHmr',issues),'');
 assert.equal(scanFieldState(valid,'employeeId',scanFieldIssues(valid)),'');
});
test('missing summary and unresolved matches remain manual-entry fields',()=>{
 assert.equal(scanFieldState({scanMachineSummary:[]},'scanMachineSummary',{scanMachineSummary:'Check summary'}),'missing');
 assert.equal(scanFieldState({},'workOrderId',{workOrderId:'No matching master'}),'missing');
 assert.equal(scanFieldState({openingHmr:0},'openingHmr',{openingHmr:'Compare reading'}),'invalid');
});

test('handover cards allow one blank time but require the recorded time to be valid',()=>{
 for(const key of ['loadingTime','unloadingTime']){
  const trips=[{...valid.trips[0],[key]:''}];
  const issues=scanFieldIssues({...valid,trips});
  assert.ok(!issues['trips.0.loadingTime']);assert.ok(!issues['trips.0.unloadingTime']);
 }
 const issues=scanFieldIssues({...valid,trips:[{...valid.trips[0],loadingTime:'',unloadingTime:''}]});
 assert.ok(issues['trips.0.loadingTime']);assert.ok(issues['trips.0.unloadingTime']);
});

test('a trip whose unloading comes after the next trip\'s loading is held for review (owner, 21 Nov 2026)',()=>{
 // Gauri Pauni 20-11-26 Shift C card 157 as the scan read it: unloading 10:07 and 10:39 read as 16:07 and 16:39.
 const trips=[['V151','09:47','16:07'],['V20','10:21','16:39'],['T145','10:56','11:17'],['V151','11:34','11:56']].map(([equipmentName,loadingTime,unloadingTime])=>({equipmentName,loadingTime,unloadingTime,tripCount:1}));
 const card={...valid,cardShift:'III',shiftName:'Shift C',trips};
 const issues=scanFieldIssues(card,'vehicle');
 assert.match(issues['trips.0.unloadingTime'],/^Unloading 16:07 comes after the next trip's loading 10:21\. .*check both times against the card\.$/);
 assert.match(issues['trips.1.unloadingTime'],/16:39 comes after the next trip's loading 10:56/);
 assert.deepEqual(Object.keys(issues).filter(k=>k.startsWith('trips.')),['trips.0.unloadingTime','trips.1.unloadingTime']);
 // The same card read right: 12-hour times on a Shift C card, and a mix of 12- and 24-hour times, raise nothing.
 const right=trips.map((t,i)=>({...t,unloadingTime:['10:07','10:39','11:17','11:56'][i]}));
 assert.deepEqual(Object.keys(scanFieldIssues({...card,trips:right},'vehicle')).filter(k=>k.startsWith('trips.')),[]);
 const mixed=right.map((t,i)=>i===0?{...t,unloadingTime:'22:07'}:t);
 assert.deepEqual(Object.keys(scanFieldIssues({...card,trips:mixed},'vehicle')).filter(k=>k.startsWith('trips.')),[]);
 // Across midnight on Shift C, and a card saved without times, raise nothing.
 const night=[['V151','11:50','12:10'],['V151','12:20','12:40'],['V151','01:05','01:25']].map(([equipmentName,loadingTime,unloadingTime])=>({equipmentName,loadingTime,unloadingTime,tripCount:1}));
 assert.deepEqual(Object.keys(scanFieldIssues({...card,trips:night},'vehicle')).filter(k=>k.startsWith('trips.')),[]);
 assert.deepEqual(Object.keys(scanFieldIssues({...card,timeMode:'without'},'vehicle')).filter(k=>k.startsWith('trips.')),[]);
});
