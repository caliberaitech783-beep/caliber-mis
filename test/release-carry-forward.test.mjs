import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {BUDGET_MS, KEEP_DAYS, RETIRED_FILE, preserveUiAssets, readRetired, retiredText, withRetries} from '../scripts/preserve-live-ui-assets.mjs';

const DAY = 86_400_000;
const now = Date.parse('2026-11-23T10:00:00.000Z');
const daysAgo = days => now - days * DAY;
const listing = names => names.map(name => ({name}));

// The new build's folder, holding the files the new build produced.
async function buildFolder(t, files = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mis-carry-forward-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(directory, name), content);
  return directory;
}

// The live server: its files by name. Reading one is recorded, and can be made to fail.
function liveServer(files, {failing = []} = {}) {
  const asked = [];
  return {
    asked,
    readPublished: async name => {
      asked.push(name);
      if (failing.includes(name)) throw Error('Azure asset read failed with HTTP 500');
      return Buffer.from(files[name] ?? 'old ' + name);
    },
  };
}

test('the keep period is the 7 days an ordinary sign-in lasts, and older files stop after 12 minutes', () => {
  assert.equal(KEEP_DAYS, 7);
  assert.equal(BUDGET_MS, 12 * 60_000);
});

test('a release carries files retired in the last 7 days and leaves older ones out', async t => {
  const directory = await buildFolder(t, {'index-v2-NewBuild1.js': 'new'});
  const live = liveServer({});
  const result = await preserveUiAssets(
    listing(['index-v2-NewBuild1.js', 'report-v2-TwoDays01.js', 'report-v2-SixDays01.css', 'report-v2-EightDay1.js', 'report-v2-Forty0001.js']),
    {directory, now, readPublished: live.readPublished, retired: new Map([
      ['report-v2-TwoDays01.js', daysAgo(2)], ['report-v2-SixDays01.css', daysAgo(6.9)],
      ['report-v2-EightDay1.js', daysAgo(7.1)], ['report-v2-Forty0001.js', daysAgo(40)],
    ])},
  );
  assert.deepEqual(live.asked.sort(), ['report-v2-SixDays01.css', 'report-v2-TwoDays01.js']);
  assert.deepEqual((await readdir(directory)).sort(), ['index-v2-NewBuild1.js', 'report-v2-SixDays01.css', 'report-v2-TwoDays01.js']);
  assert.equal(await readFile(path.join(directory, 'index-v2-NewBuild1.js'), 'utf8'), 'new', 'a newly built file is never replaced');
  assert.deepEqual({carried: result.carried, recent: result.recent, expired: result.expired, leftOut: result.leftOut}, {carried: 2, recent: 2, expired: 2, leftOut: 0});
  // A file left out keeps its date. If the server still lists it at the next release it must not look new.
  assert.equal(result.retired.get('report-v2-Forty0001.js'), daysAgo(40));
  assert.equal(result.retired.get('report-v2-TwoDays01.js'), daysAgo(2));
  assert.equal(result.retired.has('index-v2-NewBuild1.js'), false, 'a file of the new build is not an old file');
});

test('a file the record does not know has just left the build: it is dated now and must travel', async t => {
  const directory = await buildFolder(t);
  const live = liveServer({});
  const result = await preserveUiAssets(listing(['screen-v2-JustLeft1.js', 'screen-v2-Known001.js']), {
    directory, now, readPublished: live.readPublished, retired: new Map([['screen-v2-Known001.js', daysAgo(1)]]),
  });
  assert.equal(result.retired.get('screen-v2-JustLeft1.js'), now);
  assert.equal(result.current, 1);
  assert.equal(result.recent, 1);

  const second = await buildFolder(t);
  await assert.rejects(preserveUiAssets(listing(['screen-v2-JustLeft1.js', 'screen-v2-Known001.js']), {
    directory: second, now, retired: new Map([['screen-v2-Known001.js', daysAgo(1)]]),
    readPublished: liveServer({}, {failing: ['screen-v2-JustLeft1.js']}).readPublished,
  }), /HTTP 500/, 'the release stops rather than go live without a file open tabs are using');
});

test('the files of the version live now are found from its page and always travel', async t => {
  // index.html names the entry file and stylesheet; the entry names a screen it loads later, and that
  // screen names another. The new build kept the vendor file, so that one is read from the build.
  const files = {
    'index-v2-LiveNow01.js': 'import"./vendor-v2-Shared001.js";const deps=["app-assets/scan-v2-LiveNow02.js","app-assets/scan-v2-LiveNow03.css"]',
    'scan-v2-LiveNow02.js': 'import("./deep-v2-LiveNow04.js")',
    'deep-v2-LiveNow04.js': 'export default 1',
    'scan-v2-LiveNow03.css': '.a{}',
    'index-v2-LiveNow05.css': '.b{}',
  };
  const indexHtml = '<script type="module" src="/app-assets/index-v2-LiveNow01.js"></script><link rel="stylesheet" href="/app-assets/index-v2-LiveNow05.css?release=abc">';
  const directory = await buildFolder(t, {'vendor-v2-Shared001.js': 'import"./polyfill-v2-Shared002.js"', 'polyfill-v2-Shared002.js': 'kept', 'index-v2-NewBuild1.js': 'new'});
  const live = liveServer(files);
  const result = await preserveUiAssets(
    listing([...Object.keys(files), 'vendor-v2-Shared001.js', 'polyfill-v2-Shared002.js', 'index-v2-NewBuild1.js', 'old-v2-LongAgo01.js']),
    // The record calls one live file 30 days old (a change that was taken back makes an old file current again).
    {directory, now, indexHtml, readPublished: live.readPublished, retired: new Map([['deep-v2-LiveNow04.js', daysAgo(30)], ['old-v2-LongAgo01.js', daysAgo(30)]])},
  );
  assert.deepEqual(live.asked.sort(), Object.keys(files).sort(), 'only the live version is read; the 30 day old file is not');
  assert.equal(result.current, 5);
  assert.equal(result.expired, 1);
  for (const name of Object.keys(files)) {
    assert.equal(await readFile(path.join(directory, name), 'utf8'), files[name]);
    assert.equal(result.retired.get(name), now, name + ' starts its 7 days at this release');
  }
  assert.equal(await readFile(path.join(directory, 'vendor-v2-Shared001.js'), 'utf8'), 'import"./polyfill-v2-Shared002.js"');

  const second = await buildFolder(t);
  await assert.rejects(preserveUiAssets(listing(Object.keys(files)), {
    directory: second, now, indexHtml, retired: new Map(),
    readPublished: liveServer(files, {failing: ['deep-v2-LiveNow04.js']}).readPublished,
  }), /HTTP 500/, 'a missing file of the live version stops the release');
});

test('the first release with no record: the live version must travel, the old pile is dated now and may be cut by time', async t => {
  const files = {'index-v2-LiveNow01.js': 'x', 'pile-v2-Unknown01.js': 'a', 'pile-v2-Unknown02.js': 'b'};
  const indexHtml = '<script src="/app-assets/index-v2-LiveNow01.js"></script>';
  const directory = await buildFolder(t);
  const result = await preserveUiAssets(listing(Object.keys(files)), {
    directory, now, indexHtml, retired: null,
    readPublished: liveServer(files, {failing: ['pile-v2-Unknown02.js']}).readPublished,
  });
  assert.deepEqual({current: result.current, recent: result.recent, leftOut: result.leftOut}, {current: 1, recent: 1, leftOut: 1});
  assert.deepEqual([...result.retired.values()], [now, now, now]);
  assert.deepEqual((await readdir(directory)).sort(), ['index-v2-LiveNow01.js', 'pile-v2-Unknown01.js']);
});

test('with no record and no live page nothing tells the files apart, so every one must travel as before', async t => {
  const directory = await buildFolder(t);
  const names = ['pile-v2-Unknown01.js', 'pile-v2-Unknown02.js'];
  const result = await preserveUiAssets(listing(names), {directory, now, readPublished: liveServer({}).readPublished, budgetMs: 0});
  assert.deepEqual({carried: result.carried, current: result.current, leftOut: result.leftOut}, {carried: 2, current: 2, leftOut: 0});
  await assert.rejects(preserveUiAssets(listing(names), {
    directory: await buildFolder(t), now, readPublished: liveServer({}, {failing: ['pile-v2-Unknown02.js']}).readPublished,
  }), /HTTP 500/);
});

test('when the time is used up the newest retired files are in and the oldest are left out, never the live version', async t => {
  const names = Array.from({length: 40}, (_, index) => 'screen-v2-Day' + String(index).padStart(5, '0') + '.js');
  // File 0 was retired most recently, file 39 longest ago; all inside the 7 days.
  const retired = new Map(names.map((name, index) => [name, now - (index + 1) * 60_000]));
  const indexHtml = '<script src="/app-assets/index-v2-LiveNow01.js"></script>';
  const directory = await buildFolder(t);
  const live = liveServer({});
  // Every read takes one minute on this clock, eight at a time; the limit is two minutes.
  let time = 0;
  const result = await preserveUiAssets(listing([...names].reverse().concat('index-v2-LiveNow01.js')), {
    directory, now, indexHtml, retired, budgetMs: 2 * 60_000, clock: () => time,
    readPublished: async name => { const content = await live.readPublished(name); if (name !== 'index-v2-LiveNow01.js') time += 60_000 / 8; return content; },
  });
  assert.equal(result.current, 1);
  assert.equal(result.recent + result.leftOut, 40);
  assert.ok(result.recent >= 16 && result.recent < 40, 'carried ' + result.recent);
  const carried = live.asked.filter(name => name !== 'index-v2-LiveNow01.js');
  assert.deepEqual(carried, names.slice(0, carried.length), 'newest retired first');
  assert.equal(result.retired.size, 41, 'files left out for lack of time stay in the record');
  assert.equal(result.retired.get(names[39]), retired.get(names[39]));
});

test('nothing listed on the live server stops the release, and unsafe names are never read', async t => {
  await assert.rejects(preserveUiAssets(listing(['index.html', '../escape-AbCd1234.js']), {directory: await buildFolder(t), readPublished: async () => 'x'}), /No published UI assets/);
  const live = liveServer({});
  await preserveUiAssets([{name: 'ok-v2-AbCd1234.js'}, {name: '../escape-AbCd1234.js'}, {name: 'folder-AbCd1234.js', mime: 'inode/directory'}, {name: 'photo-AbCd1234.png'}], {
    directory: await buildFolder(t), now, readPublished: live.readPublished,
    indexHtml: '<script src="/app-assets/../escape-AbCd1234.js"></script><script src="/app-assets/folder-AbCd1234.js"></script>',
  });
  assert.deepEqual(live.asked, ['ok-v2-AbCd1234.js']);
});

test('the record of retired files survives a round trip and a damaged one counts as none', () => {
  const retired = new Map([['a-v2-AbCd1234.js', daysAgo(1)], ['b-v2-AbCd1234.css', daysAgo(1)], ['c-v2-AbCd1234.js', daysAgo(5)]]);
  const text = retiredText(retired);
  const parsed = JSON.parse(text);
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.retired.map(group => group.files.length), [2, 1], 'one line per release date, newest first');
  assert.deepEqual(readRetired(text, now), retired);
  for (const damaged of ['', 'not json', '{}', '{"retired":{}}', 'null']) assert.equal(readRetired(damaged, now), null, damaged);
  const odd = readRetired(JSON.stringify({retired: [
    {at: new Date(now + 3 * DAY).toISOString(), files: ['future-v2-AbCd1234.js']},
    {at: 'yesterday', files: ['undated-v2-AbCd1234.js']},
    {at: new Date(daysAgo(9)).toISOString(), files: ['../escape-AbCd1234.js', 7, 'twice-v2-AbCd1234.js']},
    {at: new Date(daysAgo(2)).toISOString(), files: ['twice-v2-AbCd1234.js']},
    null,
  ]}), now);
  assert.deepEqual([...odd], [['future-v2-AbCd1234.js', now], ['twice-v2-AbCd1234.js', daysAgo(2)]], 'a date ahead of the clock counts as now; the later of two dates wins');
});

test('one slow or failed read is tried three times before it counts as failed', async () => {
  let calls = 0;
  const pauses = [];
  const pause = async ms => { pauses.push(ms); };
  assert.equal(await withRetries(async () => { if (++calls < 3) throw Error('timeout'); return 'read'; }, {pause}), 'read');
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [1000, 2000]);
  calls = 0;
  await assert.rejects(withRetries(async () => { calls++; throw Error('still down'); }, {pause}), /still down/);
  assert.equal(calls, 3);
});

test('the release step has its own time limit, runs before the package is staged, and the record travels in the package', async () => {
  const workflow = (await readFile(new URL('../.github/workflows/main_caliber-mis-783.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start = workflow.indexOf('      - name: Carry forward immutable assets used by open MIS tabs');
  const step = workflow.slice(start, workflow.indexOf('\n      - name:', start + 1));
  assert.match(step, /\n        if: steps\.ui-delta\.outputs\.applied != 'true'\n        timeout-minutes: 20\n        run: node scripts\/preserve-live-ui-assets\.mjs\n/);
  const stage = workflow.indexOf(`rsync -a --exclude='/.git' ./ "$RUNNER_TEMP/pulse-runtime/"`);
  assert.ok(start > 0 && stage > start, 'old files and the record are in place before the package is staged');
  assert.ok(workflow.indexOf('Swap the release into production') > stage);
  // The record sits beside DEPLOYMENT_SHA, outside dist, so the site never serves it.
  assert.match(RETIRED_FILE, /^[A-Z_]+\.json$/);
  const script = await readFile(new URL('../scripts/preserve-live-ui-assets.mjs', import.meta.url), 'utf8');
  assert.match(script, /await writeFile\(RETIRED_FILE, retiredText\(result\.retired\)\)/);
  assert.match(script, /get\(site\+RETIRED_FILE, \{optional: true\}\)/);
  assert.doesNotMatch(script, /method\s*:\s*['"](?:DELETE|PUT|POST)['"]/, 'this step only reads from the live server');
});

test('a tab that asks for a screen file or stylesheet that is gone reloads itself', async () => {
  const source = await readFile(new URL('../src/lazy-feature.jsx', import.meta.url), 'utf8');
  const [, body, flags] = source.match(/const CHUNK_FAILURE_PATTERN = \/(.+)\/([a-z]*);/);
  const pattern = new RegExp(body, flags);
  assert.ok(pattern.test('TypeError: Failed to fetch dynamically imported module: https://pulse-ll.cmll.in/app-assets/scan-v2-AbCd1234.js'));
  assert.ok(pattern.test('Error: Unable to preload CSS for /app-assets/scan-v2-AbCd1234.css'));
  assert.equal(pattern.test('TypeError: meterLimitIssues is not defined'), false);
});
