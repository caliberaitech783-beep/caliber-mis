import test from 'node:test';
import assert from 'node:assert/strict';
import {scanReviewFieldSection,scanTripPageSize,scanTripReviewPage,scanReviewTabForKey,scanReviewHelp} from '../src/scan-review-layout.mjs';

test('routine field guidance is concise while specific validation messages remain intact',()=>{
 assert.equal(scanReviewHelp('Book date needs checking: enter the value from the scan.'),'Enter book date from scan.');
 assert.equal(scanReviewHelp('Equipment Master is empty in this MIS database. Sync/import it before matching scans.'),'Equipment master is empty.');
 const conflict='Closing HMR must be greater than or equal to opening HMR.';
 assert.equal(scanReviewHelp(conflict),conflict);
});

test('section tabs support arrow keys and Home/End without treating typing as navigation',()=>{
 assert.equal(scanReviewTabForKey('details','ArrowLeft'),'summary');
 assert.equal(scanReviewTabForKey('summary','ArrowRight'),'details');
 assert.equal(scanReviewTabForKey('trips','Home'),'details');
 assert.equal(scanReviewTabForKey('details','End'),'summary');
 assert.equal(scanReviewTabForKey('details','a'),null);
});

test('details keep identification and shift fields; readings stay together in Summary',()=>{
 for(const key of ['bookDate','location','doorText','assetId','employeeId','shiftId','cardShift','shiftHours','workOrderId'])assert.equal(scanReviewFieldSection(key),'details');
 for(const key of ['openingKmr','closingKmr','openingHmr','closingHmr'])assert.equal(scanReviewFieldSection(key),'summary');
});

test('all 30 trip rows remain reachable once each without shrinking their controls',()=>{
 for(const height of [620,720,1080]){
  const size=scanTripPageSize(height),seen=[];
  for(let page=0;page<Math.ceil(30/size);page++){
   const range=scanTripReviewPage(30,page,size);
   seen.push(...Array.from({length:range.end-range.start},(_,i)=>range.start+i));
  }
  assert.deepEqual(seen,Array.from({length:30},(_,i)=>i));
 }
});

test('removing the last row clamps to an existing page; empty and new rows have valid ranges',()=>{
 assert.deepEqual(scanTripReviewPage(0,9),{page:0,pages:1,size:4,start:0,end:0});
 assert.deepEqual(scanTripReviewPage(4,1),{page:0,pages:1,size:4,start:0,end:4});
 assert.deepEqual(scanTripReviewPage(5,1),{page:1,pages:2,size:4,start:4,end:5});
});
