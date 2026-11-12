import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeScannedMeter,recoverScannedMeterDecimals} from '../server/rules/scan-meter-text.mjs';
import {extractCard} from '../server/rules/scan-extraction.mjs';

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
test('impossible OCR decimal pairs recover only when the aligned integer readings satisfy shift limits',()=>{
 const recovered=recoverScannedMeterDecimals({shiftHours:8,openingHmr:'2886.7',closingHmr:'28874',openingKmr:'3842.7',closingKmr:'38432.0'});
 assert.deepEqual([recovered.openingHmr,recovered.closingHmr,recovered.openingKmr,recovered.closingKmr],['28867','28874','384270','384320']);
 assert.deepEqual(recovered.meterDecimalRecoveries.map(row=>row.meter),['HMR','KMR']);
});
test('genuine decimals and ambiguous or replacement readings are never changed',()=>{
 for(const draft of [
  {shiftHours:8,openingHmr:'100.1',closingHmr:'108.1',openingKmr:'83995.6',closingKmr:'84050.2'},
  {shiftHours:8,openingHmr:'100.1',closingHmr:'108.1',openingKmr:'3842.7',closingKmr:'99999.0'},
  {shiftHours:8,openingHmr:'1000.0',closingHmr:'900.0',openingKmr:'1000',closingKmr:'900'}
 ])assert.equal(recoverScannedMeterDecimals(draft),draft);
});
test('card extraction applies safe paired recovery without changing genuine decimal cards',()=>{
 const bad=extractCard('','vehicle',[],{meterReadings:{openingHmr:{value:'2886.7'},closingHmr:{value:'28874'},openingKmr:{value:'3842.7'},closingKmr:{value:'38432.0'}},cardShift:'II'}).draft;
 assert.deepEqual([bad.openingHmr,bad.closingHmr,bad.openingKmr,bad.closingKmr],['28867','28874','384270','384320']);
 const good=extractCard('','vehicle',[],{meterReadings:{openingHmr:{value:'100.1'},closingHmr:{value:'108.1'},openingKmr:{value:'83995.6'},closingKmr:{value:'84050.2'}},cardShift:'II'}).draft;
 assert.deepEqual([good.openingHmr,good.closingHmr,good.openingKmr,good.closingKmr],['100.1','108.1','83995.6','84050.2']);
});
