import test from 'node:test';
import assert from 'node:assert/strict';
import {scanFleetIssues,scanFleetSignature} from '../scan-fleet-assignment.mjs';
import {fleetReviewKey,nextFleetReviewPrompt} from '../src/scan-fleet-review-prompt.mjs';

function card(door='V99'){
 const draft={doorText:door,location:'Sasti OC'};
 return {id:door,status:'review',draft,raw_fields:{fleetReview:{signature:scanFleetSignature(draft),issues:scanFleetIssues([{door:'V1',currentLocation:'Majri OC'}],draft)}}};
}

test('missing and off-site equipment trigger the choices without opening the review list',()=>{
 for(const door of ['V99','V1']){
  const row=card(door);
  assert.equal(nextFleetReviewPrompt([row],new Set()),row);
 }
});

test('dismissed and transfer-pending cards do not reopen on polling; other cards still prompt',()=>{
 const first=card(),second=card('V1');
 const dismissed=new Set([fleetReviewKey(first)]);
 assert.equal(nextFleetReviewPrompt([first],dismissed),undefined);
 assert.equal(nextFleetReviewPrompt([first,second],dismissed),second);
 second.raw_fields.fleetReview.decision='transfer-pending';
 assert.equal(nextFleetReviewPrompt([first,second],dismissed),undefined);
});

test('stale checks, unavailable Pulse and saved or rejected cards do not trigger equipment choices',()=>{
 for(const patch of [row=>row.status='posted',row=>row.status='rejected',row=>row.draft.location='Majri OC',row=>row.raw_fields.fleetReview.error='Pulse offline',row=>row.raw_fields.fleetReview.issues=[]]){
  const row=card();patch(row);assert.equal(nextFleetReviewPrompt([row],new Set()),undefined);
 }
});
