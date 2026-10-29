import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeScannedMeter} from '../scan-meter-text.mjs';
import {extractCard} from '../scan-extraction.mjs';

test('user-confirmed meter decimal notation preserves every written digit',()=>{
 for(const [value,expected]of [['83995:6','83995.6'],['84050:2','84050.2'],[' 00012 : 050 ','00012.050'],['0:0','0.0'],['12：3','12.3'],['84050.2','84050.2'],['12:34:56','12:34:56']])assert.equal(normalizeScannedMeter(value),expected);
 assert.equal(normalizeScannedMeter(null),null);
});
test('OCR text tables, labeled readings and provider hints all accept decimal colons',()=>{
 const text='Opening KMR: 83995:6\nClosing KMR: 84050:2\nOpening HMR: 1924:0\nClosing HMR: 1940:5';
 const labeled=extractCard(text,'vehicle').draft;
 assert.deepEqual([labeled.openingKmr,labeled.closingKmr,labeled.openingHmr,labeled.closingHmr],['83995.6','84050.2','1924.0','1940.5']);
 const table=extractCard('KMR (Kilometer) 83995:6 84050:2\nHMR (Hours) 1924:0 1940:5','vehicle').draft;
 assert.deepEqual([table.openingKmr,table.closingKmr,table.openingHmr,table.closingHmr],['83995.6','84050.2','1924.0','1940.5']);
 const hints={meterReadings:{openingKmr:{value:'83995:6'},closingKmr:{value:'84050:2'}}};
 const draft=extractCard('','vehicle',[],hints).draft;
 assert.equal(draft.openingKmr,'83995.6');assert.equal(draft.closingKmr,'84050.2');assert.equal(hints.meterReadings.openingKmr.value,'83995:6');
});
