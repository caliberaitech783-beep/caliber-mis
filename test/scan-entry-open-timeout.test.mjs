import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SCAN_ENTRY_OPEN_TIMEOUT_MS,SCAN_PROGRESS_READ_TIMEOUT_MS,scanEntryOpenError} from '../shared/scan-progress-poll.mjs';

// 14 Nov 2026: clicking a 40-card scan entry showed "signal timed out" and 0/0 cards,
// because the screen gave up on the whole read after 20 s while the server was busy.

test('opening a scan entry waits longer than a progress poll',()=>{
 assert.ok(SCAN_ENTRY_OPEN_TIMEOUT_MS>=60000);
 assert.equal(SCAN_PROGRESS_READ_TIMEOUT_MS,20000);
 const page=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 assert.match(page,/AbortSignal\.timeout\(fresh\?SCAN_ENTRY_OPEN_TIMEOUT_MS:SCAN_PROGRESS_READ_TIMEOUT_MS\)/);
 assert.doesNotMatch(page,/const read=\{signal:AbortSignal\.timeout\(20000\)\}/);
 assert.match(page,/setNotice\('Opening scan entry…/,'the click shows that the entry is opening');
 assert.match(page,/setError\(scanEntryOpenError\(e\)\)/);
});

test('a timed-out open explains itself instead of "signal timed out"',()=>{
 const timeout=new DOMException('signal timed out','TimeoutError');
 assert.match(scanEntryOpenError(timeout),/server is busy.*Click the entry again/);
 assert.match(scanEntryOpenError(new DOMException('This operation was aborted','AbortError')),/server is busy/);
 assert.equal(scanEntryOpenError(Error('This scan entry belongs to a different log book.')),'This scan entry belongs to a different log book.');
});

test('a single slow progress poll stays quiet; a second one explains itself',async()=>{
 const {scanProgressPollError,SCAN_PROGRESS_FAILURES_BEFORE_NOTICE}=await import('../shared/scan-progress-poll.mjs');
 const timeout=new DOMException('signal timed out','TimeoutError');
 assert.equal(SCAN_PROGRESS_FAILURES_BEFORE_NOTICE,2);
 assert.equal(scanProgressPollError(timeout,1),null);
 assert.match(scanProgressPollError(timeout,2),/server is busy.*Nothing was lost/);
 assert.doesNotMatch(scanProgressPollError(timeout,3),/signal timed out/);
 assert.equal(scanProgressPollError(Error('This scan entry belongs to another site, date or shift.'),1),'This scan entry belongs to another site, date or shift.');
 const page=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 assert.match(page,/progressFailures\+\+;const message=scanProgressPollError\(e,progressFailures\)/);
 assert.doesNotMatch(page,/load\(activeRef\.current,false,retryPending\)\.catch\(e=>setConnectionError\(e\.message\)\)/);
});

test('red banners never show the browser\'s bare "signal timed out"',async()=>{
 const {scanScreenErrorText,SCAN_BUSY_MESSAGE}=await import('../shared/scan-progress-poll.mjs');
 for(const raw of ['signal timed out','The operation was aborted due to timeout','The operation timed out.','This operation was aborted'])assert.equal(scanScreenErrorText(raw),SCAN_BUSY_MESSAGE);
 assert.equal(scanScreenErrorText('Saving is blocked. Check Scan setup and remove mismatch cards first.'),'Saving is blocked. Check Scan setup and remove mismatch cards first.');
 const page=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 assert.match(page,/className="scan-error">\{scanScreenErrorText\(connectionError\)\}/);
 assert.match(page,/className="scan-error">\{scanScreenErrorText\(error\)\}/);
});
