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
