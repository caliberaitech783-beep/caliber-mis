import test from 'node:test';import assert from 'node:assert/strict';import {createCanvas} from '@napi-rs/canvas';
import {createPaddleEvidence,validatePaddleEvidence,paddleEvidenceResult} from '../paddle-evidence.mjs';import {paddleFixture} from './paddle-fixture.mjs';
const image=()=>{const c=createCanvas(1435,1800);return c.toBuffer('image/png')};
test('local OCR is bound to the exact scan and cannot supply approval or a ready-made draft',()=>{
 const bytes=image(),e=createPaddleEvidence({...paddleFixture(),status:'approved',draft:{assetId:'999'},checked:true},bytes);
 assert.equal(e.status,undefined);assert.equal(e.draft,undefined);assert.equal(e.checked,undefined);assert.equal(paddleEvidenceResult(e,bytes,'vehicle').tripGrid.rows.length,18);
 assert.throws(()=>validatePaddleEvidence(e,Buffer.concat([bytes,Buffer.from('different scan')])));
 for(const bad of [{...e,confidence:NaN},{...e,imageSize:[1,1]},{...e,pages:[{...e.pages[0],rec_boxes:[[0,0,99999,99999]]}]}])assert.throws(()=>validatePaddleEvidence(bad,bytes));
});
