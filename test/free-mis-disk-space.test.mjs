import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {freeDiskSpace, REMOVABLE, LOOK_ONLY, sizeFrom, FreeStop} from '../scripts/free-mis-disk-space.mjs';

// Owner, 24 Nov 2026: "plz clear unwanted files". The plan's shared drive was full (500 of 500 GB) and every release
// was refused. The tool lists first; with delete it removes only a fixed list, and never the app's data.
const slots = [{name: 'production', host: 'live.scm'}, {name: 'staging', host: 'stage.scm'}];
function server({present = {}, rounds = 1} = {}) {
 const calls = [], left = new Map();
 const request = async (host, line) => {
  calls.push({host, line});
  if (line === 'df -Pk /home') return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n//share 524288000 524288000 0 100% /home';
  const size = line.match(/^if \[ -e (\S+) \]; then timeout 35 du -sk \1/);
  if (size) {const kb = present[host + size[1]];return kb === undefined ? 'absent' : kb === null ? 'exit=124' : `${kb}\t${size[1]}\nexit=0`;}
  const removal = line.match(/^timeout 35 (rm -rf|find) (\S+)/);
  if (removal) {const key = host + removal[2], n = (left.get(key) ?? rounds) - 1;left.set(key, n);return n > 0 ? 'left' : 'gone';}
  throw Error('unexpected command: ' + line);
 };
 return {calls, request};
}

test('list only: sizes and free space are read, nothing is removed', async () => {
 const lines = [], fake = server({present: {'live.scm/home/site/wwwroot/.git': 53_000_000, 'live.scm/home/LogFiles/kudu/trace': null, 'live.scm/home/data': 9_000_000}});
 const report = await freeDiskSpace({request: fake.request, slots, log: line => lines.push(line)});
 assert.equal(fake.calls.filter(call => /rm -rf|-delete/.test(call.line)).length, 0, 'no removal without delete');
 assert.deepEqual(report.before, {totalGb: 500, usedGb: 500, freeGb: 0});
 const text = lines.join('\n');
 assert.match(text, /\/home\/site\/wwwroot\/\.git: 50\.54 GB/);
 assert.match(text, /\/home\/LogFiles\/kudu\/trace: too many files to size in 35 s/);
 assert.match(text, /staging slot[\s\S]*\/home\/site\/wwwroot\/\.git: not present/);
 assert.match(text, /Nothing was changed\./);
});

test('delete removes only the fixed list, repeating a removal that is not finished', async () => {
 const fake = server({present: {'live.scm/home/site/wwwroot/.git': 53_000_000, 'live.scm/home/LogFiles/kudu/trace': 2_000_000, 'live.scm/home/data': 9_000_000, 'stage.scm/home/data': 1}, rounds: 3});
 const report = await freeDiskSpace({request: fake.request, slots, remove: true, log: () => {}});
 const removals = fake.calls.filter(call => /^timeout 35 (rm -rf|find)/.test(call.line));
 assert.deepEqual([...new Set(removals.map(call => call.line.split(' 2>')[0]))], ['timeout 35 rm -rf /home/site/wwwroot/.git', 'timeout 35 find /home/LogFiles/kudu/trace -mindepth 1 -delete']);
 assert.equal(removals.length, 6, 'each item was tried until it was gone');
 assert.ok(removals.every(call => call.host === 'live.scm'), 'only where the item is present');
 assert.deepEqual(report.removed, ['production /home/site/wwwroot/.git', 'production /home/LogFiles/kudu/trace']);
 assert.ok(fake.calls.every(call => !/(rm|delete)[^\n]*\/home\/data/.test(call.line)), '/home/data is never removed');
 assert.ok(report.after, 'free space is read again afterwards');
});

test('a removal that does not finish is said, so the run can be started again', async () => {
 const fake = server({present: {'live.scm/home/LogFiles/kudu/trace': null}, rounds: 99});
 const report = await freeDiskSpace({request: fake.request, slots, remove: true, log: () => {}});
 assert.deepEqual(report.left, ['production /home/LogFiles/kudu/trace']);
});

test('the fixed lists and the workflow', () => {
 assert.deepEqual(REMOVABLE.map(item => item.path), ['/home/site/wwwroot/.git', '/home/LogFiles/kudu/trace']);
 assert.ok(LOOK_ONLY.every(item => !REMOVABLE.some(removable => removable.path === item.path)));
 assert.ok(REMOVABLE.every(item => !item.path.startsWith('/home/data') && !/integration\.key|bdms-backups|scanned-cards/.test(item.remove)));
 assert.equal(sizeFrom('123\t/home/data\nexit=0'), 123);
 assert.equal(sizeFrom('exit=124'), null);
 assert.ok(new FreeStop('x') instanceof Error);
 const workflow = readFileSync(new URL('../.github/workflows/free-mis-disk-space.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
 assert.match(workflow, /^on:\n  workflow_dispatch:\n/m, 'started by hand only');
 assert.match(workflow, /default: false/, 'lists unless delete is ticked');
 assert.match(workflow, /concurrency:\n  group: caliber-mis-783-release\n  cancel-in-progress: false/, 'never while a release uses a slot');
 assert.match(workflow, /if \[ "\$FREE_DELETE" = "true" \]; then node scripts\/free-mis-disk-space\.mjs --delete; else node scripts\/free-mis-disk-space\.mjs; fi/);
});
