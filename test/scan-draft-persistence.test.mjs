import test from 'node:test';import assert from 'node:assert/strict';
import{previewBookNumber}from'../book-number-preview.mjs';import{saveDraftRecovery,loadDraftRecovery}from'../scan-draft-cache.mjs';
test('book preview shows date, marked shift and source-specific series without allocating a number',()=>{
 assert.equal(previewBookNumber('vehicle',{bookDate:'2026-10-18',cardShift:'II'}),'VLB_S/18TH-OCT26/S2/001');
 for(const [shift,code]of [['I','S1'],['III','S3'],['Day','D'],['Night','N']])assert.equal(previewBookNumber('vehicle',{bookDate:'2026-10-18',cardShift:shift},12),`VLB_S/18TH-OCT26/${code}/012`);
 assert.equal(previewBookNumber('vehicle',{bookDate:'2026-10-18'},51,'Shift B'),'VLB_S/18TH-OCT26/S2/051');
 assert.equal(previewBookNumber('vehicle',{}),'VLB_S/DDTH-MMMYY/{S1|S2|S3|D|N}/001');
});
test('recovery preserves every draft field and rejects stale revisions and malformed caches',()=>{
 const map=new Map(),storage={setItem:(k,v)=>map.set(k,v),getItem:k=>map.get(k)};
 const draft={openingKmr:'303192',closingKmr:'303250',remark:'Check source',trips:[{equipmentName:'S12',loadingTime:'13:00'}]};
 assert.equal(saveDraftRecovery(storage,'user:card',2,draft),true);assert.deepEqual(loadDraftRecovery(storage,'user:card',2),draft);
 assert.equal(loadDraftRecovery(storage,'user:card',3),null);assert.equal(loadDraftRecovery(storage,'other-user:card',2),null);
 map.set('user:card','broken');assert.equal(loadDraftRecovery(storage,'user:card',2),null);
 assert.equal(saveDraftRecovery({setItem:()=>{throw Error('quota')}},'user:card',2,draft),false);
});
