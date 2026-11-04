import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPerformanceMonitor,normalizeRoutePath,percentile,performanceDiagnostic} from '../server/services/performance-monitor.mjs';

const clock=(start=Date.UTC(2026,10,4,10,0,0))=>{let time=start;return {now:()=>time,advance:ms=>{time+=ms;}};};
const quiet={warn(){}};

test('route paths group record identifiers together',()=>{
  assert.equal(normalizeRoutePath('/api/requests/BD-2026-0042/trip-card'),'/api/requests/:id/trip-card');
  assert.equal(normalizeRoutePath('/api/scan-cards/3f2c1d9e-1111-4c4c-9999-abcdefabcdef/retry?x=1'),'/api/scan-cards/:id/retry');
  assert.equal(normalizeRoutePath('/api/diagnostics'),'/api/diagnostics');
  assert.equal(percentile([5,1,9,3],0.95),9);
  assert.equal(percentile([],0.95),0);
});

test('request timing is summarised per route and abandoned requests are not counted twice',()=>{
  const time=clock(),monitor=createPerformanceMonitor({now:time.now,log:quiet});
  for(const ms of [100,200,1500]){const finish=monitor.beginRequest('GET','/api/requests/BD-1');time.advance(ms);finish(200);finish(200);}
  const finish=monitor.beginRequest('POST','/api/scan-batches/7/upload');time.advance(50);finish(500);
  const snapshot=monitor.snapshot();
  const feed=snapshot.slowestRoutes.find(row=>row.route==='GET /api/requests/:id');
  assert.deepEqual({count:feed.count,averageMs:feed.averageMs,maxMs:feed.maxMs,slow:feed.slow},{count:3,averageMs:600,maxMs:1500,slow:1});
  assert.equal(snapshot.busiestRoutes[0].route,'GET /api/requests/:id');
  assert.equal(snapshot.slowestRoutes.find(row=>row.route.startsWith('POST')).errors,1);
  assert.equal(snapshot.totals.requests,4);
  assert.equal(snapshot.lastHour.slowRequests,1);
  assert.deepEqual(snapshot.runningNow.requests,[]);
});

test('a late timer is recorded as a freeze naming the running requests and jobs',async()=>{
  const time=clock(),pool={waitingCount:3,totalCount:10,idleCount:0,options:{max:10}};
  const monitor=createPerformanceMonitor({now:time.now,pool,log:quiet});
  monitor.tick();
  monitor.beginRequest('POST','/api/scan-batches/12/pdf');
  let release;const job=monitor.trackJob('Scan card reading',()=>new Promise(resolve=>{release=resolve;}));
  time.advance(500+2400);monitor.tick();
  const snapshot=monitor.snapshot();
  assert.equal(snapshot.totals.freezes,1);
  assert.equal(snapshot.recentFreezes[0].blockedMs,2400);
  assert.deepEqual(snapshot.recentFreezes[0].jobs,['Scan card reading']);
  assert.match(snapshot.recentFreezes[0].requests[0],/^POST \/api\/scan-batches\/:id\/pdf/);
  assert.equal(snapshot.lastHour.poolMaxWaiting,3);
  release();await job;
  assert.deepEqual(monitor.snapshot().runningNow.jobs,[]);
  const diagnostic=performanceDiagnostic(snapshot);
  assert.equal(diagnostic.status,'warn');
  assert.ok(diagnostic.facts.some(([label,value])=>label==='Last freeze was during'&&value.includes('Scan card reading')));
});

test('a job that finished just before the late timer is still named in the freeze',async()=>{
  const time=clock(),monitor=createPerformanceMonitor({now:time.now,log:quiet});
  await monitor.trackJob('Daily PDF report',async()=>{time.advance(1500);});
  const finish=monitor.beginRequest('GET','/api/requests');finish(200);
  time.advance(100);monitor.tick();
  const freeze=monitor.snapshot().recentFreezes[0];
  assert.deepEqual(freeze.jobs,['Daily PDF report']);
  assert.deepEqual(freeze.requests,['GET /api/requests (finished)']);
});

test('diagnostic reports ok when quiet and fail on repeated or long freezes',()=>{
  const time=clock(),monitor=createPerformanceMonitor({now:time.now,log:quiet});
  assert.equal(performanceDiagnostic(monitor.snapshot()).status,'ok');
  monitor.recordFreeze(3500,time.now());
  assert.equal(performanceDiagnostic(monitor.snapshot()).status,'fail');
});

test('server measures every API request and exposes the numbers to administrators only',async()=>{
  const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  assert.ok(server.includes("const performanceMonitor=createPerformanceMonitor({pool});"));
  assert.ok(server.includes("performanceMonitor.beginRequest(req.method,req.path);res.on('close',()=>finish(res.statusCode));"));
  assert.ok(server.includes("app.get('/api/diagnostics/performance',requireSuper,requireAdministrator,"));
  assert.ok(server.includes("performanceMonitor.trackJob(`${module}: ${action}`,task)"));
  assert.ok(server.includes('trackJob:(name,task)=>withoutRowSecurityRequest(()=>performanceMonitor.trackJob(name,task)),'));
  const page=await readFile(new URL('../src/diagnostics-page.jsx',import.meta.url),'utf8');
  assert.ok(page.includes('fetch("/api/diagnostics/performance"'));
});
