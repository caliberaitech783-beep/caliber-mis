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

test('the open entry describes itself from the card status summary so the chip and the tiles agree',()=>{
 assert.equal(describeScanEntry({cards:37,posted:24},{total:37,saved:24,waiting:11,attention:2,pending:0}),'37 cards · 24 saved · 11 waiting to save · 2 need attention');
 assert.equal(describeScanEntry({cards:3,posted:1,duplicates:1},{total:3,saved:1,waiting:1,attention:1,pending:0}),'3 cards · 1 saved · 1 waiting to save · 1 needs attention · 1 duplicate skipped');
 assert.equal(describeScanEntry({cards:5,posted:5},{total:5,saved:5,waiting:0,attention:0,pending:0}),'5 cards · 5 saved');
 assert.equal(describeScanEntry({cards:4,posted:0},{total:4,saved:0,waiting:0,attention:1,pending:3}),'4 cards · 1 needs attention · 3 reading');
});
