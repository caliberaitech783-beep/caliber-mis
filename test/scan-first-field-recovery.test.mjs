import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverFirstScanFields,firstScanProblems,readScanWithRecovery} from '../server/services/scan-first-field-recovery.mjs';
const good=()=>({raw:{door:'V321',employeeCode:'EMP1'},draft:{doorText:'V321',assetId:'1',employeeId:'2',location:'Sasti OC',bookDate:'2026-12-19',bookDateSource:'scan',cardShift:'I',shiftId:'3',shiftHours:8,openingHmr:100,closingHmr:104,openingKmr:200,closingKmr:240,trips:[{equipmentName:'LPC01',tripCount:2}],scanMachineSummary:[{equipmentName:'LPC01',tripCount:2}],timeMode:'without',extractionReviewFields:[],meterReviewFields:[]}});
const context={bookDate:'2026-12-19',location:'Sasti OC',cardShift:'I'};
test('all valid fields require no second read',async()=>{
 assert.deepEqual(firstScanProblems(good(),'vehicle',context),[]);
 await recoverFirstScanFields({kind:'vehicle',extracted:good(),context,readAgain:()=>assert.fail('already valid')});
});
test('one original-image reread recovers door, Caliber, HMR, KMR, summary and date/shift together',async()=>{
 const extracted=good();Object.assign(extracted.draft,{assetId:'',employeeId:'',openingHmr:'',closingKmr:150,bookDate:'2026-12-18',shiftId:'',cardShift:'',scanMachineSummary:[{equipmentName:'LPC01',tripCount:9}]});let calls=0;
 const result=await recoverFirstScanFields({kind:'vehicle',extracted,context,readAgain:async options=>{calls++;assert.equal(options.forceRead,true);return {}},extract:async()=>good()});
 assert.equal(calls,1);assert.deepEqual(firstScanProblems(result,'vehicle',context),[]);
 assert.deepEqual(new Set(result.raw.firstScanFieldRecovery.recovered),new Set(['door','caliber','hmr','kmr','trips','date','shift']));
});
test('a retry cannot overwrite a valid field or repair actual mismatches by inventing totals',async()=>{
 const extracted=good();extracted.draft.employeeId='';extracted.draft.scanMachineSummary[0].tripCount=9;
 const candidate=good();candidate.draft.openingHmr=900;candidate.draft.closingHmr=904;candidate.draft.scanMachineSummary[0].tripCount=8;
 const result=await recoverFirstScanFields({kind:'vehicle',extracted,context,readAgain:async()=>({}),extract:async()=>candidate});
 assert.equal(result.draft.employeeId,'2');assert.equal(result.draft.openingHmr,100);assert.equal(result.draft.scanMachineSummary[0].tripCount,9);assert.ok(firstScanProblems(result,'vehicle',context).includes('trips'));
});
test('blank model extraction can recover its site and fields within the selected context',async()=>{
 const extracted=good();for(const key of Object.keys(extracted.draft))extracted.draft[key]=Array.isArray(extracted.draft[key])?[]:'';
 const result=await recoverFirstScanFields({kind:'vehicle',extracted,context,allowMissingSite:true,readAgain:async()=>({}),extract:async()=>good()});
 assert.deepEqual(firstScanProblems(result,'vehicle',context),[]);
});
test('wrong-site retry, cancellation and an already-used recovery budget cannot replace data',async()=>{
 for(const mode of ['site','cancelled','used']){
  const extracted=good();extracted.draft.employeeId='';const candidate=good();candidate.draft.location='Jayant OC';let calls=0;
  const result=await recoverFirstScanFields({kind:'vehicle',extracted,context,alreadyRetried:mode==='used',onProgress:()=>mode==='cancelled'?false:true,readAgain:async()=>{calls++;return {}},extract:async()=>candidate});
  assert.equal(result.draft.employeeId,'');assert.equal(calls,mode==='site'?1:0);
 }
});
test('ELB HMR and operator recover without requiring vehicle KMR or trip tables',async()=>{
 const extracted=good();extracted.draft.employeeId='';extracted.draft.closingHmr='';delete extracted.draft.openingKmr;delete extracted.draft.closingKmr;
 const result=await recoverFirstScanFields({kind:'equipment',extracted,context,readAgain:async()=>({}),extract:async()=>good()});
 assert.equal(result.draft.employeeId,'2');assert.equal(result.draft.closingHmr,104);assert.ok(!result.raw.firstScanFieldRecovery.groups.includes('kmr'));
});
test('temporary extraction errors receive one fresh read, but configuration errors and cancelled work do not',async()=>{
 let calls=0;const result=await readScanWithRecovery(async options=>{if(++calls===1)throw Error('Temporary interrupted OCR response');assert.equal(options.forceRead,true);return {text:'Recovered'}});
 assert.equal(calls,2);assert.equal(result.firstScanReadRecovery.recovered,true);
 for(const [error,active]of [[Object.assign(Error('Forbidden'),{status:403}),true],[Error('aborted'),false]]){
  calls=0;await assert.rejects(readScanWithRecovery(async()=>{calls++;throw error},async()=>active));assert.equal(calls,1);
 }
 calls=0;await assert.rejects(readScanWithRecovery(async()=>{calls++;throw Error('Still unavailable')}));assert.equal(calls,2);
});
