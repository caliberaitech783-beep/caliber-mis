import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverFirstScanDoor} from '../server/services/scan-first-door-recovery.mjs';
const card=()=>({raw:{door:'V1833'},draft:{doorText:'V1833',assetId:'',location:'Sasti OC',openingHmr:100,trips:[{tripCount:4}]}});
test('first scan retries an unmatched door without replacing other extracted fields',async()=>{
 const extracted=card(),progress=[];let calls=0;
 const result=await recoverFirstScanDoor({kind:'vehicle',extracted,onProgress:(...args)=>progress.push(args),readAgain:async options=>{calls++;assert.equal(options.forceRead,true);return 'fresh image read'},extract:async value=>{assert.equal(value,'fresh image read');return {raw:{door:'V/833'},draft:{doorText:'V/833',assetId:'42',location:'Sasti OC',openingHmr:999,trips:[]}}}});
 assert.equal(calls,1);assert.equal(result.draft.assetId,'42');assert.equal(result.draft.doorText,'V/833');assert.equal(result.draft.openingHmr,100);assert.deepEqual(result.draft.trips,[{tripCount:4}]);assert.equal(result.raw.firstScanDoorRecovery.recovered,true);assert.equal(progress[0][0],'retrying');
});
test('a valid first match needs no second OCR request',async()=>{
 const extracted=card();extracted.draft.assetId='42';
 await recoverFirstScanDoor({kind:'vehicle',extracted,readAgain:()=>assert.fail('unnecessary retry')});
});
test('a missing site is reviewed before retrying a door that cannot yet be matched safely',async()=>{
 const extracted=card();extracted.draft.location='';
 await recoverFirstScanDoor({kind:'vehicle',extracted,readAgain:()=>assert.fail('no safe site scope for a retry')});
});
test('unreadable, ambiguous and different-site retry results never produce a guessed match',async()=>{
 for(const draft of [{assetId:'',location:'Sasti OC'},{assetId:'42',location:'Jayant OC'}]){
  const result=await recoverFirstScanDoor({kind:'vehicle',extracted:card(),readAgain:async()=>({}),extract:async()=>({raw:{door:'V/833'},draft})});
  assert.equal(result.draft.assetId,'');assert.equal(result.draft.doorText,'V1833');assert.equal(result.raw.firstScanDoorRecovery.recovered,false);
 }
});
test('retry failure retains the first scan for review instead of losing its data',async()=>{
 const result=await recoverFirstScanDoor({kind:'vehicle',extracted:card(),readAgain:async()=>{throw Error('network failure')}});
 assert.equal(result.draft.openingHmr,100);assert.equal(result.raw.firstScanDoorRecovery.unavailable,true);
});
