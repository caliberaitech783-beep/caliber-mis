import test from 'node:test';
import assert from 'node:assert/strict';
import {transferScannerPages} from '../public/scanner-transfer.mjs';

test('next page is prepared during upload while uploads remain ordered and bounded',async()=>{
 const reads=[],sent=[];let active=0;
 await transferScannerPages([1,2,3],{
  read:async card=>{reads.push(card);return Uint8Array.of(card).buffer},
  send:async(card,bytes)=>{assert.equal(++active,1);assert.deepEqual(reads,card===1?[1,2]:[1,2,3]);assert.equal(new Uint8Array(bytes)[0],card);await Promise.resolve();sent.push(card);active--;},
 });
 assert.deepEqual(sent,[1,2,3]);
});
test('failed upload stops further sends and preserves retry IDs and source buffers',async()=>{
 const cards=[{id:'one'},{id:'two'},{id:'three'}],read=[],sent=[];
 await assert.rejects(transferScannerPages(cards,{
  read:async card=>{read.push(card.id);return new ArrayBuffer(1)},
  send:async card=>{sent.push(card.id);throw Error('offline')},
 }),/offline/);
 assert.deepEqual(read,['one','two']);assert.deepEqual(sent,['one']);
});
test('prefetch failure is reported after the preceding upload without sending a missing page',async()=>{
 const sent=[];
 await assert.rejects(transferScannerPages([1,2],{
  read:async card=>{if(card===2)throw Error('missing image');return new ArrayBuffer(1)},
  send:async card=>{await new Promise(resolve=>setTimeout(resolve,5));sent.push(card)},
 }),/missing image/);
 assert.deepEqual(sent,[1]);
});
