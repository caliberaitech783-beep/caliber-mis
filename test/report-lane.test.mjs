import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReportLane,reportKey} from '../server/services/report-lane.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('reports use at most the lane slots; the rest wait their turn instead of taking more database connections',async()=>{
  const lane=createReportLane({slots:2,cacheMs:0});const gates=[deferred(),deferred(),deferred()];let running=0,most=0;
  const jobs=gates.map((gate,i)=>lane.run('key'+i,async()=>{running++;most=Math.max(most,running);await gate.promise;running--;return i;}));
  await tick();
  assert.equal(running,2);assert.deepEqual(lane.stats(),{slots:2,active:2,waiting:1,served:0,shared:0,cached:0});
  gates[0].resolve();await tick();assert.equal(running,2);
  gates[1].resolve();gates[2].resolve();
  assert.deepEqual(await Promise.all(jobs),[0,1,2]);assert.equal(most,2);
  assert.equal(lane.stats().active,0);
});

test('identical requests made together share one read',async()=>{
  const lane=createReportLane({slots:3,cacheMs:0});const gate=deferred();let reads=0;
  const jobs=Array.from({length:5},()=>lane.run('same',async()=>{reads++;await gate.promise;return {rows:1};}));
  await tick();gate.resolve();
  const results=await Promise.all(jobs);
  assert.equal(reads,1);assert.ok(results.every(r=>r===results[0]));assert.equal(lane.stats().shared,4);
});

test('a finished report is reused only for its short window',async()=>{
  let time=1000,reads=0;const lane=createReportLane({slots:1,cacheMs:15000,now:()=>time});
  const read=()=>lane.run('k',async()=>++reads);
  assert.equal(await read(),1);time+=14999;assert.equal(await read(),1);time+=2;assert.equal(await read(),2);
});

test('a failed read is not kept and its slot is returned',async()=>{
  const lane=createReportLane({slots:1,cacheMs:15000});let calls=0;
  await assert.rejects(lane.run('k',async()=>{calls++;throw Object.assign(Error('too big'),{status:400});}),/too big/);
  assert.equal(await lane.run('k',async()=>{calls++;return 'ok';}),'ok');
  assert.equal(calls,2);assert.equal(lane.stats().active,0);
});

test('people with different site access never share a report',()=>{
  const req=sites=>({query:{from:'2026-11-01',to:'2026-11-10'},logBookScope:{sites}});
  assert.notEqual(reportKey('manpower',req(['Jayant OC'])),reportKey('manpower',req(['Sasti OC'])));
  assert.notEqual(reportKey('manpower',req(null)),reportKey('manpower',req(['Jayant OC'])));
  assert.notEqual(reportKey('manpower',req(null)),reportKey('batch-status',req(null)));
  assert.equal(reportKey('manpower',req(['Jayant OC'])),reportKey('manpower',req(['Jayant OC'])));
});

test('production sends the dashboard reports through the shared lane and reports it in health',()=>{
  const logBook=readFileSync(new URL('../server/routes/log-book.mjs',import.meta.url),'utf8');
  assert.match(logBook,/registerManpowerReports\(app,\{[^}]*lane:reportLane\}/);
  assert.match(logBook,/registerBatchStatusReport\(app,\{[^}]*lane:reportLane\}/);
  assert.match(readFileSync(new URL('../server.mjs',import.meta.url),'utf8'),/reportLane:reportLane\.stats\(\)/);
});
