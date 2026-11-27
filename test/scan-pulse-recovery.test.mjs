import {scanFleetReviewNeedsRefresh,scanFleetSignature} from '../shared/scan-fleet-assignment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
test('expired Pulse warning is retried without editing card, while healthy checks stay cached',()=>{
 const now=Date.now(),draft={doorText:'V683',location:'Gauri Pauni OC (2nd)',bookDate:'2026-11-26'};
 const card={draft,raw_fields:{fleetReview:{signature:scanFleetSignature(draft),error:'Pulse sign-in expired. Sign in normally again to reconnect.',checkedAt:new Date(now-30000).toISOString(),actor:'owner'}}};
 assert.equal(scanFleetReviewNeedsRefresh(card,'owner',now),true);
 card.raw_fields.fleetReview.checkedAt=new Date(now).toISOString();
 assert.equal(scanFleetReviewNeedsRefresh(card,'owner',now),false);
 assert.equal(scanFleetReviewNeedsRefresh(card,'reviewer',now),true);
 card.raw_fields.fleetReview.error='';card.raw_fields.fleetReview.issues=[{door:'V683'}];
 assert.equal(scanFleetReviewNeedsRefresh(card,'reviewer',now+60000),false);
 card.draft={...draft,doorText:'V684'};
 assert.equal(scanFleetReviewNeedsRefresh(card,'owner',now),true);
});
test('legacy saved failures with no timestamp recover on the next batch read',()=>{
 const draft={};assert.equal(scanFleetReviewNeedsRefresh({draft,raw_fields:{fleetReview:{signature:scanFleetSignature(draft),error:'Pulse unavailable'}}},'owner'),true);
});
