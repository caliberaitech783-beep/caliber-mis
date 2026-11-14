import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSharedRead} from '../server/routes/vlb-batches.mjs';

test('callers that arrive together share one read, and the copy is reused only for its time',async()=>{
 let time=1000,reads=0,finish;
 const shared=createSharedRead({ttlMs:3000,now:()=>time});
 const read=()=>{reads++;return new Promise(resolve=>{finish=resolve;});};
 const first=shared(read),second=shared(read);
 await new Promise(resolve=>setImmediate(resolve));
 finish(['row']);
 assert.deepEqual(await first,['row']);
 assert.deepEqual(await second,['row']);
 assert.equal(reads,1);
 time+=2999;
 assert.deepEqual(await shared(async()=>{reads++;return ['new'];}),['row']);
 assert.equal(reads,1);
 time+=1;
 assert.deepEqual(await shared(async()=>{reads++;return ['new'];}),['new']);
 assert.equal(reads,2);
});

test('clear() forces a fresh read, even while an older read is still running',async()=>{
 let reads=0,finishOld;
 const shared=createSharedRead({ttlMs:3000});
 await shared(async()=>{reads++;return ['before'];});
 shared.clear();
 const old=shared(()=>{reads++;return new Promise(resolve=>{finishOld=resolve;});});
 shared.clear();
 const fresh=shared(async()=>{reads++;return ['after'];});
 assert.deepEqual(await fresh,['after']);
 finishOld(['stale']);
 assert.deepEqual(await old,['stale']);
 assert.deepEqual(await shared(async()=>{reads++;return ['unused'];}),['after']);
 assert.equal(reads,3);
});

test('a failed read is not kept, and ttlMs 0 reads every time',async()=>{
 const shared=createSharedRead({ttlMs:3000});
 await assert.rejects(shared(async()=>{throw Error('busy');}),/busy/);
 assert.deepEqual(await shared(async()=>['ok']),['ok']);
 let reads=0;const direct=createSharedRead({ttlMs:0});
 await direct(async()=>{reads++;return [];});await direct(async()=>{reads++;return [];});
 assert.equal(reads,2);
});

test('the batch list uses the shared read, cleared by every batch action, and hidden tabs stop polling',()=>{
 const routes=readFileSync(new URL('../server/routes/vlb-batches.mjs',import.meta.url),'utf8');
 assert.match(routes,/sharedBatchRows\.get\(scopeKey\)/);
 assert.match(routes,/const rows=await read\(/);
 assert.match(routes,/app\.use\('\/api\/vlb-batches'.*res\.on\('finish',\(\)=>sharedBatchRows\.clear\(\)\)/);
 const board=readFileSync(new URL('../src/vlb-create-batch.jsx',import.meta.url),'utf8');
 assert.match(board,/setInterval\(\(\)=>\{if\(!entryMode&&document\.visibilityState!=='hidden'\)void load\(\)\},15000\)/);
 assert.match(board,/const tick=\(\)=>\{if\(document\.visibilityState!=='hidden'\)setRefresh\(n=>n\+1\)\};const timer=setInterval\(tick,10000\);document\.addEventListener\('visibilitychange',tick\)/);
 const scan=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 // The scan screen's card total uses the shared visible-tab poll (every 15 s, none while hidden).
 assert.match(scan,/'\/card-counts'[\s\S]{0,500}startVisiblePoll\(refresh,VLB_CARD_COUNT_POLL_MS\)/);
});
