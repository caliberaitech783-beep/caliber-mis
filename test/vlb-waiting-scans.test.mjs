import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {readWaitingScans,waitingScanBlocker,vlbLockScanBlocker,lmvLockScanBlocker,closeScanBlocker,scanEntryBook,WAITING_SCAN_STATUSES} from '../server/rules/vlb-waiting-scans.mjs';
import {lockBlockers,closureBlockers} from '../server/rules/vlb-two-stage.mjs';

// 14 Nov 2026: Dudhichua East 4 Nov C shift was locked and closed with 42 scanned trip cards
// (about 430 trips) still in review. These cards must now stop every stage step.
const entries=[
 {id:'a',name:'CMLL/2026-11-04/DUDHICHUA EAST OB/S3/SHAKTISINGH/B02',book:'vlb',waiting:36,reading:0,failed:0},
 {id:'b',name:'CMLL/2026-11-04/DUDHICHUA EAST OB/S3/SHAKTISINGH/B03',book:'vlb',waiting:2,reading:2,failed:0},
 {id:'c',name:'CMLL/2026-11-04/DUDHICHUA EAST OB/S3/NITESHSHARMA/B01',book:'vlb',waiting:1,reading:0,failed:1},
 {id:'l',name:'CMLL/2026-11-04/DUDHICHUA EAST OB/S3/LMV/B01',book:'lmv',waiting:3,reading:0,failed:0},
 {id:'e',name:'CMLL/2026-11-04/DUDHICHUA EAST OB/S3/ELB/B01',book:'elb',waiting:4,reading:0,failed:0},
];

test('waiting trip cards block Lock VLB with each entry and count named',()=>{
 const message=vlbLockScanBlocker(entries);
 assert.match(message,/^39 scanned trip cards not saved yet: /);
 assert.match(message,/36 in CMLL\/2026-11-04\/DUDHICHUA EAST OB\/S3\/SHAKTISINGH\/B02/);
 assert.match(message,/2 in .*B03 \(2 still reading\)/);
 assert.match(message,/1 in .*NITESHSHARMA\/B01 \(1 failed\)/);
 assert.match(message,/Save or delete each card in its scan entry before locking VLB\.$/);
 assert.doesNotMatch(message,/LMV|ELB/,'LMV and ELB cards do not hold the VLB lock');
 const blockers=lockBlockers({stage:'vlb_open',records:[{id:1}],waitingScans:entries});
 assert.deepEqual(blockers,[message]);
 assert.deepEqual(lockBlockers({stage:'vlb_open',records:[{id:1}],waitingScans:[]}),[],'nothing waiting, nothing blocked');
 assert.deepEqual(lockBlockers({stage:'vlb_open',records:[{id:1}]}),[],'old callers without the list still work');
});

test('Lock LMV waits for trip and LMV cards; Close waits for every kind',()=>{
 assert.match(lmvLockScanBlocker(entries),/^42 scanned trip card \/ LMV cards not saved yet: .*before locking LMV\.$/);
 assert.equal(lmvLockScanBlocker(entries.filter(e=>e.book==='elb')),'','an ELB job card does not hold Lock LMV');
 const close=closeScanBlocker(entries);
 assert.match(close,/^46 scanned trip card \/ LMV card \/ ELB job cards not saved yet: .*before closing the batch\.$/);
 assert.ok(closureBlockers({stage:'elb_open',fleet:[],waitingScans:entries}).includes(close));
 assert.deepEqual(closureBlockers({stage:'elb_open',fleet:[],waitingScans:[]}),[]);
 assert.equal(waitingScanBlocker([{id:'x',name:'E1',book:'vlb',waiting:1,reading:0,failed:0}],['vlb'],'locking VLB'),'1 scanned trip card not saved yet: 1 in E1. Save or delete each card in its scan entry before locking VLB.');
});

test('a database without scan tables has nothing waiting',async()=>{
 const asked=[];
 assert.deepEqual(await readWaitingScans({query:async sql=>{asked.push(sql);return {rows:[{ready:false}]}}},{site:'x',date:'2026-11-04',shift:'S1'}),[]);
 assert.equal(asked.length,1,'the waiting query is not sent when the tables are missing');
});

test('scan entries map to their book',()=>{
 assert.equal(scanEntryBook('vehicle',{location:'x'}),'vlb');
 assert.equal(scanEntryBook('vehicle',{logBookKind:'lmv'}),'lmv');
 assert.equal(scanEntryBook('equipment',{}),'elb');
});

test('the waiting list is read for the batch date and kept to its site and shift',async()=>{
 const calls=[];
 const client={query:async(sql,params)=>{if(sql.includes('to_regclass'))return {rows:[{ready:true}]};calls.push({sql,params});return {rows:[
  {id:'1',name:'right site, C shift',kind:'vehicle',context:{location:'Dudhichua East OC',cardShift:'III',bookDate:'2026-11-04'},waiting:36,reading:0,failed:0},
  {id:'2',name:'right site, A shift',kind:'vehicle',context:{location:'dudhichua east ob',cardShift:'I',bookDate:'2026-11-04'},waiting:5,reading:0,failed:0},
  {id:'3',name:'other site',kind:'vehicle',context:{location:'Dudhichua OB',cardShift:'III',bookDate:'2026-11-04'},waiting:7,reading:0,failed:0},
  {id:'4',name:'ELB',kind:'equipment',context:{location:'dudhichua east ob',cardShift:'III',bookDate:'2026-11-04'},waiting:2,reading:1,failed:0},
 ]}}};
 const rows=await readWaitingScans(client,{site:'dudhichua east ob',date:'2026-11-04',shift:'S3'});
 assert.deepEqual(rows.map(r=>[r.id,r.book,r.waiting]),[['1','vlb',36],['4','elb',2]]);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].params[0],'2026-11-04');
 assert.deepEqual(calls[0].params[1],WAITING_SCAN_STATUSES);
 assert.deepEqual(WAITING_SCAN_STATUSES,['queued','reading','review','approved','error'],'saved (posted) and deleted/rejected cards never wait');
 for(const part of ["c.duplicate_of IS NULL","Card deleted manually by user%","manualDeletion","deletedVlbBatch","'cancelled'"])assert.ok(calls[0].sql.includes(part),part);
});

test('every stage step and trip-card upload checks the waiting cards',()=>{
 const stages=readFileSync(new URL('../server/rules/vlb-batch-stages.mjs',import.meta.url),'utf8');
 assert.match(stages,/lockBlockers\(\{stage,records,holds,unresolved:snapshot\.unresolved,waitingScans:/,'Lock VLB reads the list inside its transaction');
 assert.match(stages,/const waiting=lmvLockScanBlocker\(await batchWaitingScans\(client,batch\)\);\s*if\(waiting\)fail\(waiting,409\);/,'Lock LMV refuses');
 assert.match(stages,/closureBlockers\(\{stage,fleet,holds,duplicates,waitingScans\}\)/,'Close refuses through closeBlockers');
 const routes=readFileSync(new URL('../server/routes/vlb-batches.mjs',import.meta.url),'utf8');
 assert.match(routes,/canLockLmv:[^,]*!stageInfo\.lmvLockBlockers\?\.length/);
 const scans=readFileSync(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
 assert.match(scans,/app\.post\('\/api\/scan-batches\/:id\/cards'[^\n]*await refuseTripCardsAfterVlbLock\(batch\);/,'trip cards are refused at upload once VLB is locked');
 assert.match(scans,/batchStage\(vlbBatch\)==='vlb_open'\)return;/);
});

test('the batch page lists waiting cards once, per stage',async()=>{
 const source=readFileSync(new URL('../src/vlb-waiting-scans.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export function','function');
 const {code}=await transformWithOxc(source,'vlb-waiting-scans.jsx',{jsx:{runtime:'classic'}});
 const {WaitingScans}=new Function('React',code+';return {WaitingScans}')(React);
 const html=renderToStaticMarkup(React.createElement(WaitingScans,{entries,stage:'vlb_open'}));
 assert.match(html,/39 scanned cards not saved yet\./);
 assert.match(html,/Lock VLB stays blocked/);
 assert.match(html,/SHAKTISINGH\/B02: 36 waiting/);
 assert.match(html,/B03: 2 waiting · 2 still reading/);
 assert.doesNotMatch(html,/ELB\/B01/);
 assert.match(renderToStaticMarkup(React.createElement(WaitingScans,{entries,stage:'elb_open'})),/46 scanned cards[\s\S]*Close &amp; lock ELB stays blocked[\s\S]*ELB\/B01: 4 waiting/);
 assert.equal(renderToStaticMarkup(React.createElement(WaitingScans,{entries:[],stage:'vlb_open'})),'');
 assert.equal(renderToStaticMarkup(React.createElement(WaitingScans,{entries,stage:'closed'})),'');
 const page=readFileSync(new URL('../src/vlb-create-batch.jsx',import.meta.url),'utf8');
 assert.match(page,/<WaitingScans entries=\{viewed\.waitingScans\} stage=\{stage\}\/>/);
 assert.match(page,/filter\(text=>text!==viewed\.waitingScanMessage\)/,'the Lock VLB line does not repeat the list');
});
