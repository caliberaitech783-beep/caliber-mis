import test from 'node:test';import assert from 'node:assert/strict';import {scanProgressNeedsValidation} from '../src/scan-reader-status.mjs';
import {chooseScanCard,scanStatusLabels,scanCardStatus} from '../src/scan-reader-status.mjs';
test('first available Gemini draft opens automatically without replacing an edited or completed card',()=>{const cards=[{id:'one',status:'queued'},{id:'two',status:'review'}];assert.equal(chooseScanCard(cards,'one'), 'two');assert.equal(chooseScanCard(cards,'one',null,{dirty:true}), 'one');assert.equal(chooseScanCard(cards,'two'), 'two');assert.equal(chooseScanCard(cards,'','one'),'one');assert.equal(chooseScanCard([],'one'),'');});
test('Gemini queue reports actual A/B stages, keeping existing non-Gemini labels',()=>{assert.equal(scanStatusLabels('gemini-hybrid').queued,'Waiting for Gemini');assert.equal(scanCardStatus({status:'reading',raw_fields:{scanProgress:{stage:'B'}}},'gemini-hybrid'),'Gemini Priority B');assert.equal(scanStatusLabels().queued,'Waiting for OCR');});

test('single Gemini request shows extraction status without A/B stages',()=>{assert.equal(scanStatusLabels('gemini').queued,'Waiting for Gemini');assert.equal(scanCardStatus({status:'reading',raw_fields:{scanProgress:{stage:'extracting'}}},'gemini'),'Gemini extraction');});

test('temporary API failures show the retry and actual reason',()=>{assert.equal(scanCardStatus({status:'reading',raw_fields:{scanProgress:{stage:'retrying',attempt:2,maxAttempts:2,reason:'HTTP 503'}}},'gemini'),'Gemini retry 2/2 · HTTP 503');});

test('polling revalidates finished extraction and same-revision fleet updates',()=>{
 const row={id:'1',status:'review',revision:2};
 assert.equal(scanProgressNeedsValidation([{...row,status:'reading'}],[]),false);
 assert.equal(scanProgressNeedsValidation([row],[{...row,status:'reading'}]),true);
 assert.equal(scanProgressNeedsValidation([row],[{...row,validationPending:true}]),false);
 assert.equal(scanProgressNeedsValidation([{...row,raw_fields:{fleetReview:{checkedAt:'now'}}}],[{...row,validationPending:true}]),true);
 assert.equal(scanProgressNeedsValidation([row],[{...row,checks:{errors:[]}}]),false);
});
