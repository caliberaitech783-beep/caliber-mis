import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseScanEntry,rememberScanEntry,recallScanEntry,describeScanEntry,entryCancelled,scanEntryStorageKey} from '../src/scan-entry-recovery.mjs';

const memory=()=>{const map=new Map();return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};};

test('the entry this browser last worked in reopens first, otherwise the newest entry with unsaved cards',()=>{
 const entries=[
  {id:'e3',name:'B03 continued',cards:0,posted:0,expected_context:{}},
  {id:'e2',name:'JAYANT 40 CARDS.pdf',cards:40,posted:0,expected_context:{}},
  {id:'e1',name:'earlier',cards:12,posted:12,expected_context:{}},
 ];
 assert.equal(chooseScanEntry(entries).id,'e2','empty newest entry is skipped, saved-out entry is skipped');
 assert.equal(chooseScanEntry(entries,{remembered:'e1'}).id,'e1','a remembered entry wins even when fully saved');
 assert.equal(chooseScanEntry(entries,{remembered:'missing'}).id,'e2');
 assert.equal(chooseScanEntry([{id:'c',cards:5,posted:0,expected_context:{cancelled:true}}]),null,'a cancelled entry never reopens');
 assert.equal(chooseScanEntry([{id:'d',cards:5,posted:0,expected_context:{deletedVlbBatch:'x'}}],{remembered:'d'}),null);
 assert.equal(chooseScanEntry([],{remembered:'e1'}),null);
 assert.equal(chooseScanEntry(null),null);
 assert.ok(entryCancelled({expected_context:{cancelled:true}}));
});

test('the entry is remembered per VLB batch and kind in local storage, and failures are swallowed',()=>{
 const storage=memory();
 assert.ok(rememberScanEntry(storage,'vehicle','vlb1','e2'));
 assert.equal(recallScanEntry(storage,'vehicle','vlb1'),'e2');
 assert.equal(recallScanEntry(storage,'equipment','vlb1'),'');
 assert.equal(scanEntryStorageKey('vehicle','vlb1'),'scan-entry:vehicle:vlb1');
 assert.ok(rememberScanEntry(storage,'vehicle','vlb1',''));
 assert.equal(recallScanEntry(storage,'vehicle','vlb1'),'');
 assert.equal(rememberScanEntry(null,'vehicle','vlb1','e2'),false);
 assert.equal(rememberScanEntry({setItem(){throw Error('quota')}},'vehicle','vlb1','e2'),false);
 assert.equal(recallScanEntry({getItem(){throw Error('blocked')}},'vehicle','vlb1'),'');
});

test('entry summary names cards, saved, unsaved and skipped duplicates',()=>{
 assert.equal(describeScanEntry({cards:40,posted:21,duplicates:2}),'40 cards · 21 saved · 19 unsaved · 2 duplicates skipped');
 assert.equal(describeScanEntry({cards:1,posted:1}),'1 card · 1 saved');
 assert.equal(describeScanEntry({}),'0 cards');
});
