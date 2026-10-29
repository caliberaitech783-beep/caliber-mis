import test from 'node:test';import assert from 'node:assert/strict';
import {paddleLayout} from '../paddle-layout.mjs';import {extractCard} from '../scan-extraction.mjs';import {machineSummary} from '../trip-card-rules.mjs';import {paddleFixture} from './paddle-fixture.mjs';
test('spatial extraction retains every populated row, split merged times, and repeats equipment only on occupied rows',()=>{
 const source=paddleFixture({invalidTime:true}),hints=paddleLayout(source),{draft}=extractCard(source.text,'vehicle',[],hints);
 assert.equal(draft.trips.length,18);assert.deepEqual(draft.trips.map(t=>t.rowNumber),Array.from({length:18},(_,i)=>i+1));
 assert.equal(draft.trips[1].loadingTime,'01:12');assert.equal(draft.trips[1].unloadingTime,'01:19');assert.equal(draft.trips[3].loadingTime,'');
 assert.deepEqual(machineSummary(draft.trips),[{equipmentName:'VPC19',tripCount:17},{equipmentName:'SPC6',tripCount:1}]);assert.deepEqual(draft.scanMachineSummary.map(({equipmentName,tripCount})=>({equipmentName,tripCount})),[{equipmentName:'VPC19',tripCount:17},{equipmentName:'SPC6',tripCount:1}]);
 assert.equal(draft.bookDate,'2026-10-18');assert.equal(draft.aFormNo,'1042');assert.equal(draft.openingHmr,'200');assert.equal(draft.closingKmr,'140');assert.ok(draft.extractionReviewFields.includes('trips'));assert.ok(draft.meterReviewFields.includes('openingHmr'));
});
test('unknown layouts and incomplete OCR geometry do not manufacture trip rows',()=>{
 const source=paddleFixture();source.pages[0].rec_texts=source.pages[0].rec_texts.map(t=>t==='Loading Time'?'Unknown heading':t);assert.equal(paddleLayout(source).tripGrid,undefined);
 assert.deepEqual(paddleLayout({pages:[{rec_texts:['test'],rec_boxes:[]}]}),{});
});
test('an unclear OCR date is left blank instead of parsing the first three numbers as a different year',()=>{
 const source=paddleFixture();source.text='DATE 19 1 10 /26';source.regions.bookDate.text='19 110/ 26';
 const {draft}=extractCard(source.text,'vehicle',[],paddleLayout(source));assert.equal(draft.bookDate,'');assert.equal(draft.bookDateSource,'scan-unreadable');
 source.regions.bookDate.text='19/1/10';source.pages[0].rec_texts.push('19/10/26');source.pages[0].rec_boxes.push([250,225,500,265]);source.pages[0].rec_scores.push(.95);
 assert.equal(extractCard(source.text,'vehicle',[],paddleLayout(source)).draft.bookDate,'');
});
