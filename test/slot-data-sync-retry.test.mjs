import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {SlotBusyError, busyStatus, isTransient, retryTransient} from '../scripts/slot-data-retry.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = readFileSync(new URL('../scripts/sync-production-slot-data.mjs', import.meta.url), 'utf8');
const timedOut = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

test('a slot read that stalls is tried again, with a pause, and its answer is returned', async () => {
  const pauses = [], lines = [];
  let calls = 0;
  const answer = await retryTransient(async attempt => {
    calls++;
    if (attempt < 3) throw timedOut();
    return 'digest';
  }, {sleep: async ms => { pauses.push(ms); }, report: line => lines.push(line), what: 'Slot file check'});
  assert.equal(answer, 'digest');
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [5000, 15000]);
  assert.deepEqual(lines, [
    'Slot file check did not answer in time or was cut off; trying again (2 of 3).',
    'Slot file check did not answer in time or was cut off; trying again (3 of 3).',
  ]);
});

test('a slot that never answers still fails after three tries, and a real fault fails at once', async () => {
  let calls = 0;
  await assert.rejects(retryTransient(async () => { calls++; throw timedOut(); }, {sleep: async () => {}, report: () => {}}), {name: 'TimeoutError'});
  assert.equal(calls, 3);

  calls = 0;
  const pauses = [];
  await assert.rejects(retryTransient(async () => { calls++; throw Error('Slot data command failed.'); }, {sleep: async ms => { pauses.push(ms); }, report: () => {}}), /Slot data command failed\./);
  assert.equal(calls, 1);
  assert.deepEqual(pauses, []);
});

test('only a stall, a dropped connection or a busy slot counts as worth a second try', () => {
  assert.equal(isTransient(timedOut()), true);
  assert.equal(isTransient(new TypeError('fetch failed')), true);
  assert.equal(isTransient(new TypeError('terminated')), true);
  assert.equal(isTransient(new SlotBusyError('Slot data read failed with HTTP 503')), true);
  assert.equal(isTransient(Error('Slot data file conflicts with an existing file.')), false);
  assert.equal(isTransient(new TypeError('Cannot read properties of undefined')), false);
  assert.equal(isTransient(undefined), false);
  assert.deepEqual([408, 429, 500, 502, 503, 504].map(busyStatus), [true, true, true, true, true, true]);
  assert.deepEqual([200, 201, 401, 403, 404, 409, 412].map(busyStatus), [false, false, false, false, false, false, false]);
});

test('only reads are tried again; uploads, moves and deletes on a slot are sent once', () => {
  assert.equal(script.match(/retryTransient\(/g).length, 2);
  assert.match(script, /const read = \(host, route, options\) => retryTransient\(async \(\) => \{\s*const response = await request\(host, route, options\);/);
  assert.match(script, /await retryTransient\(\(\) => command\(host, code, CHECK_TIMEOUT\), \{what: 'Slot file check'\}\)/);
  assert.match(script, /await Promise\.all\(\[read\(source, key\), read\(destination, key\)\]\)/);
  assert.match(script, /const listing = await read\(source, route\);/);
  assert.match(script, /const existing = await read\(destination, file, \{method: 'HEAD'\}\);/);
  assert.match(script, /const directory = await request\(destination, route, \{method: 'PUT'/);
  assert.match(script, /const incoming = await request\(source, file, \{\}, 900000\);/);
  assert.match(script, /const uploaded = await request\(destination, vfs\(temp\), \{/);
  assert.match(script, /await command\(destination, `require\('node:child_process'\)\.execFileSync\('mv',/);
  assert.match(script, /const removed = await request\(destination, vfs\(temp\), \{method: 'DELETE'/);
  // Azure cuts a request that has sent nothing back after 230 seconds; a longer wait would only hide that as a stall.
  const wait = Number(script.match(/const CHECK_TIMEOUT = (\d+);/)[1]);
  assert.ok(wait > 60000 && wait < 230000);
});

// Runs the real script against a stand-in for Azure: one backup file that is already on both slots.
function release(direction, settings = {}) {
  const env = {...process.env, MIS_STAGING_SLOT: 'staging', ...settings};
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const fake = pathToFileURL(root + 'test/helpers/slot-sync-fake-azure.mjs').href;
  return spawnSync(process.execPath, ['--import', fake, 'scripts/sync-production-slot-data.mjs', direction], {cwd: root, env, encoding: 'utf8', timeout: 60000});
}

test('the release step passes when the staging slot stalls on a file check once or twice', () => {
  const calm = release('to-staging');
  assert.equal(calm.status, 0, calm.stderr);
  assert.doesNotMatch(calm.stdout, /trying again/);
  assert.match(calm.stdout, /Slot data synchronization completed\. Files copied: 0\. Files already there and checked: 1\. Slowest file check: \d+ s\./);
  assert.match(calm.stdout, /fake-azure: staging file checks 1, writes 0/);

  for (const direction of ['to-staging', 'to-production']) {
    const once = release(direction, {SLOT_SYNC_STALLS: '1'});
    assert.equal(once.status, 0, once.stderr);
    assert.match(once.stdout, /Slot file check did not answer in time or was cut off; trying again \(2 of 3\)\./);
    assert.match(once.stdout, /Files copied: 0\. Files already there and checked: 1\./);
    assert.match(once.stdout, /fake-azure: staging file checks 2, writes 0/);
    // The build log is public: a retry line names no file and no host.
    assert.doesNotMatch(once.stdout.replace(/^fake-azure:.*$/m, ''), /backup\.zip|azurewebsites|2026-11/);
  }

  const twice = release('to-staging', {SLOT_SYNC_STALLS: '2'});
  assert.equal(twice.status, 0, twice.stderr);
  assert.match(twice.stdout, /trying again \(3 of 3\)\./);
  assert.match(twice.stdout, /fake-azure: staging file checks 3, writes 0/);
});

test('the release step still stops before the swap when the staging slot never answers', () => {
  const stuck = release('to-staging', {SLOT_SYNC_STALLS: '99'});
  assert.notEqual(stuck.status, 0);
  assert.match(stuck.stderr, /TimeoutError/);
  assert.doesNotMatch(stuck.stdout, /Slot data synchronization completed/);
  assert.match(stuck.stdout, /fake-azure: staging file checks 3, writes 0/);
});

test('a directory listing that answers "busy" is read again, and a slot that stays busy stops the step', () => {
  const once = release('to-staging', {SLOT_SYNC_BUSY: '1'});
  assert.equal(once.status, 0, once.stderr);
  assert.match(once.stdout, /Slot data read did not answer in time or was cut off; trying again \(2 of 3\)\./);
  assert.match(once.stdout, /Files already there and checked: 1\./);

  const stuck = release('to-staging', {SLOT_SYNC_BUSY: '99'});
  assert.notEqual(stuck.status, 0);
  assert.match(stuck.stderr, /Slot data read failed with HTTP 503/);
  assert.match(stuck.stdout, /fake-azure: staging file checks 0, writes 0/);
});
