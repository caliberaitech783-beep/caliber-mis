import test from 'node:test';
import assert from 'node:assert/strict';
import {remainingScanCards,scanReviewPosition} from '../src/scan-review-queue.mjs';
import {applySavedScanCard} from '../scan-batch-report.mjs';

test('10 uploaded cards become six review cards after four saves, then five after an explicit save',()=>{
 let cards=Array.from({length:10},(_,i)=>({id:String(i+1),batch_id:'batch',ordinal:i+1,status:i<4?'posted':'review'}));
 let queue=remainingScanCards(cards);
 assert.deepEqual(queue.map(row=>scanReviewPosition(queue,row.id)),['1/6','2/6','3/6','4/6','5/6','6/6']);
 assert.deepEqual(queue.map(row=>row.ordinal),[5,6,7,8,9,10]);
 cards=cards.map(row=>row.id==='5'?applySavedScanCard(row,{id:55,book_no:'TEST/0005',data:{scanCardId:'5',scanBatchId:'batch'}}):row);
 queue=remainingScanCards(cards);
 assert.equal(scanReviewPosition(queue,'6'),'1/5');assert.equal(scanReviewPosition(queue,'10'),'5/5');
 assert.equal(scanReviewPosition(queue,'5'),'');assert.equal(queue.length,5);
 assert.deepEqual(cards.map(row=>row.ordinal),[1,2,3,4,5,6,7,8,9,10]);
});

test('draft saves stay in the count; rejected and posted cards leave it; processing cards remain pending',()=>{
 const cards=[{id:'draft',status:'review'},{id:'approved',status:'approved'},{id:'reading',status:'reading'},{id:'queued',status:'queued'},{id:'rejected',status:'rejected'},{id:'saved',status:'posted'}];
 assert.deepEqual(remainingScanCards(cards).map(row=>row.id),['draft','approved','reading','queued']);
 assert.equal(scanReviewPosition([],null),'');
});
