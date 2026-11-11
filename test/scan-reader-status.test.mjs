import test from 'node:test';import assert from 'node:assert/strict';import {scanProgressNeedsValidation} from '../src/scan-reader-status.mjs';
import {chooseScanCard,scanStatusLabels,scanCardStatus,scanProgressChanged,mergeScanProgressStages} from '../src/scan-reader-status.mjs';
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

test('a slim progress poll reloads the entry only when a card, its status or its fleet check changed',()=>{
 const shown=[{id:'1',status:'review',revision:2,raw_fields:{fleetReview:{checkedAt:'t1'}},draft:{trips:[]}},{id:'2',status:'reading',revision:5,raw_fields:{scanProgress:{stage:'extracting'}}}];
 const poll=[{id:'1',status:'review',revision:2,raw_fields:{fleetReview:{checkedAt:'t1'}}},{id:'2',status:'reading',revision:7,raw_fields:{scanProgress:{stage:'retrying',attempt:2}}}];
 assert.equal(scanProgressChanged(poll,shown),false,'a reading card changes revision with every extraction stage');
 assert.equal(scanProgressChanged([poll[0],{...poll[1],status:'review'}],shown),true,'extraction finished');
 assert.equal(scanProgressChanged([{...poll[0],revision:3},poll[1]],shown),true,'a review card changed');
 assert.equal(scanProgressChanged([{...poll[0],raw_fields:{fleetReview:{checkedAt:'t2'}}},poll[1]],shown),true,'a fleet check completed');
 assert.equal(scanProgressChanged([poll[0]],shown),true,'a card was removed');
 assert.equal(scanProgressChanged([...poll,{id:'3',status:'queued',revision:1}],shown),true,'a card was added');
 assert.equal(scanProgressChanged(poll,[]),true);
 const merged=mergeScanProgressStages(shown,poll);
 assert.equal(merged[0],shown[0],'cards that are not reading keep their object');
 assert.deepEqual(merged[1].raw_fields,{scanProgress:{stage:'retrying',attempt:2}});
 assert.equal(mergeScanProgressStages(merged,poll),merged,'an unchanged stage returns the same array');
});
