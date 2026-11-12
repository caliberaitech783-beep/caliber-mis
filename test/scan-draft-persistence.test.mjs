import test from 'node:test';import assert from 'node:assert/strict';
import{previewBookNumber}from'../shared/book-number-preview.mjs';import{saveDraftRecovery,loadDraftRecovery,saveScanCorrections}from'../shared/scan-draft-cache.mjs';
test('book preview shows date, marked shift and source-specific series without allocating a number',()=>{
 assert.equal(previewBookNumber('vehicle',{bookDate:'2026-10-18',cardShift:'II'}),'VLB_S/18TH-OCT26/S2/001');
 for(const [shift,code]of [['I','S1'],['III','S3'],['Day','D'],['Night','N']])assert.equal(previewBookNumber('vehicle',{bookDate:'2026-10-18',cardShift:shift},12),`VLB_S/18TH-OCT26/${code}/012`);
 assert.equal(previewBookNumber('vehicle',{bookDate:'2026-10-18'},51,'Shift B'),'VLB_S/18TH-OCT26/S2/051');
 assert.equal(previewBookNumber('vehicle',{}),'VLB_S/DDTH-MMMYY/{S1|S2|S3|D|N}/001');
});

test('retries a stale save with local corrections and the latest MIS values',async()=>{
 const baseline={remark:'old',trips:[{loadingTime:'08:00',unloadingTime:''}]};
 const draft={remark:'',trips:[{loadingTime:'08:01',unloadingTime:''}]};
 const latest={remark:'old',employeeId:'123',trips:[{loadingTime:'08:00',unloadingTime:'08:16'}]};
 const expected={remark:'',employeeId:'123',trips:[{loadingTime:'08:01',unloadingTime:'08:16'}]};
 const conflict=Object.assign(new Error('Card changed. Reload before saving.'),{status:409});
 const writes=[];
 const result=await saveScanCorrections({revision:2,baseline,draft,
  write:async(revision,draft)=>{writes.push({revision,draft});if(revision===2)throw conflict;return {revision:4};},
  refresh:async()=>({revision:3,status:'review',draft:latest})
 });
 assert.deepEqual(writes,[{revision:2,draft},{revision:3,draft:expected}]);
 assert.deepEqual(result,{saved:{revision:4},draft:expected,rebased:true});

 const cache=new Map();
 const storage={setItem:(key,value)=>cache.set(key,value),getItem:key=>cache.get(key)};
 assert.equal(saveDraftRecovery(storage,'card',2,draft,baseline),true);
 assert.deepEqual(loadDraftRecovery(storage,'card',3,latest),expected);
});

test('a stale save cannot rewrite a card that was already posted',async()=>{
 const conflict=Object.assign(new Error('Card changed. Reload before saving.'),{status:409});
 let writes=0;
 await assert.rejects(saveScanCorrections({revision:2,baseline:{},draft:{remark:'Keep this'},
  write:async()=>{writes++;throw conflict;},
  refresh:async()=>({revision:3,status:'posted',draft:{}})
 }),{message:conflict.message});
 assert.equal(writes,1);
});
test('recovery preserves every draft field and rejects stale revisions and malformed caches',()=>{
 const map=new Map(),storage={setItem:(k,v)=>map.set(k,v),getItem:k=>map.get(k)};
 const draft={openingKmr:'303192',closingKmr:'303250',remark:'Check source',trips:[{equipmentName:'S12',loadingTime:'13:00'}]};
 assert.equal(saveDraftRecovery(storage,'user:card',2,draft),true);assert.deepEqual(loadDraftRecovery(storage,'user:card',2),draft);
 assert.equal(loadDraftRecovery(storage,'user:card',3),null);assert.equal(loadDraftRecovery(storage,'other-user:card',2),null);
 map.set('user:card','broken');assert.equal(loadDraftRecovery(storage,'user:card',2),null);
 assert.equal(saveDraftRecovery({setItem:()=>{throw Error('quota')}},'user:card',2,draft),false);
});
