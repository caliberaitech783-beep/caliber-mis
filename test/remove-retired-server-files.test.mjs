import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {removeRetiredFiles, retiredFolders, describe} from '../scripts/remove-retired-server-files.mjs';

// A stand-in for one server's deployment file API: folders of files under site/wwwroot.
function fakeServer(folders, {failDelete = '', stubbornFile = ''} = {}) {
  const calls = [];
  const reply = (status, body) => ({status, ok: status >= 200 && status < 300, json: async () => body});
  const request = async (path, options = {}) => {
    const method = options.method || 'GET';
    calls.push(method + ' ' + path);
    assert.ok(path.startsWith('/api/vfs/site/wwwroot/'), 'only the release folder is ever addressed');
    const inside = decodeURIComponent(path.slice('/api/vfs/site/wwwroot/'.length));
    if (inside.endsWith('/')) {
      const folder = inside.slice(0, -1);
      if (!folders[folder]) return reply(404);
      if (method === 'GET') return reply(200, Object.entries(folders[folder]).map(([name, size]) => size === 'folder' ? {name, mime: 'inode/directory', size: 0} : {name, mime: 'application/pdf', size}));
      if (Object.keys(folders[folder]).length) return reply(409);
      delete folders[folder];
      return reply(200);
    }
    assert.equal(method, 'DELETE', 'a single file is only ever deleted, never read or written');
    assert.equal(options.headers['If-Match'], '*');
    const cut = inside.lastIndexOf('/');
    const folder = inside.slice(0, cut), name = inside.slice(cut + 1);
    if (name === failDelete) return reply(500);
    if (!folders[folder] || !(name in folders[folder])) return reply(404);
    if (name !== stubbornFile) delete folders[folder][name];
    return reply(200);
  };
  return {request, calls, folders};
}

const manuals = () => ({'daily-en.pdf': 200000, 'daily-hi.pdf': 210000, 'ot-multiple-duties-en.pdf': 300000, 'vlb-reports-hi.pdf': 250000});

test('listing the old report manuals changes nothing on the server', async () => {
  const server = fakeServer({'public/guides': manuals(), 'dist/guides': manuals()});
  const report = await removeRetiredFiles({request: server.request});
  assert.deepEqual(report.map(line => [line.folder, line.found, line.bytes, line.removed]), [['public/guides', 4, 960000, 0], ['dist/guides', 4, 960000, 0]]);
  assert.ok(server.calls.every(call => call.startsWith('GET ')));
  assert.equal(Object.keys(server.folders['public/guides']).length, 4);
  assert.match(describe(report, false)[0], /^public\/guides: 4 old files found \(0\.9 MB\); nothing deleted, list only$/);
});

test('deleting removes every old manual and the empty folder from both copies', async () => {
  const server = fakeServer({'public/guides': manuals(), 'dist/guides': manuals(), 'public/user-guides': {'mis-user-guide-english.mp4': 5000000}});
  const report = await removeRetiredFiles({request: server.request, remove: true});
  assert.deepEqual(report.map(line => [line.folder, line.found, line.removed, line.folderRemoved, line.kept]), [['public/guides', 4, 4, true, []], ['dist/guides', 4, 4, true, []]]);
  assert.deepEqual(Object.keys(server.folders), ['public/user-guides'], 'the training videos are never touched');
  assert.ok(server.calls.every(call => /\/site\/wwwroot\/(?:public|dist)\/guides\//.test(call)), 'nothing outside the two manual folders is addressed');
  assert.match(describe(report, true)[1], /^dist\/guides: 4 old files found \(0\.9 MB\); 4 deleted; folder removed$/);
});

test('anything that is not an old manual is reported and left, and then the folder stays', async () => {
  const server = fakeServer({'public/guides': {...manuals(), 'new-notice.pdf': 1000, 'Daily-en.pdf': 1000, 'daily-en.pdf.bak': 1000, 'archive': 'folder'}});
  const report = await removeRetiredFiles({request: server.request, remove: true});
  assert.equal(report[0].removed, 4);
  assert.equal(report[0].folderRemoved, false);
  assert.deepEqual(report[0].kept, ['new-notice.pdf', 'Daily-en.pdf', 'daily-en.pdf.bak', 'archive']);
  assert.deepEqual(Object.keys(server.folders['public/guides']), ['new-notice.pdf', 'Daily-en.pdf', 'daily-en.pdf.bak', 'archive']);
  assert.ok(!server.calls.some(call => call === 'DELETE /api/vfs/site/wwwroot/public/guides/'), 'a folder that still holds something is not deleted');
  assert.deepEqual(report[1], {folder: 'dist/guides', present: false, found: 0, bytes: 0, removed: 0, kept: [], folderRemoved: false});
  assert.match(describe(report, true)[0], /4 deleted; folder kept; 4 other entries left alone: new-notice\.pdf, Daily-en\.pdf, daily-en\.pdf\.bak, archive$/);
  assert.equal(describe(report, true)[1], 'dist/guides: folder is not there');
});

test('a delete the server refuses, or a file still there afterwards, is an error and not a success', async () => {
  await assert.rejects(removeRetiredFiles({request: fakeServer({'public/guides': manuals()}, {failDelete: 'daily-hi.pdf'}).request, remove: true}), /Deleting public\/guides\/daily-hi\.pdf failed with HTTP 500/);
  await assert.rejects(removeRetiredFiles({request: fakeServer({'public/guides': manuals()}, {stubbornFile: 'daily-hi.pdf'}).request, remove: true}), /1 retired files are still in public\/guides after deleting/);
  await assert.rejects(removeRetiredFiles({request: async () => ({status: 403, ok: false}), remove: true}), /Listing public\/guides failed with HTTP 403/);
});

test('only the two manual folders and manual file names are on the retired list', () => {
  assert.deepEqual(retiredFolders.map(entry => entry.folder.join('/')), ['public/guides', 'dist/guides']);
  for (const {file} of retiredFolders) {
    for (const name of ['daily-en.pdf', 'daily-hi.pdf', 'ot-multiple-duties-en.pdf', 'fleet-capacity-hi.pdf', 'batch-status-en.pdf']) assert.ok(file.test(name), name);
    for (const name of ['', '.pdf', 'daily.pdf', 'daily-en.PDF', 'Daily-en.pdf', '../daily-en.pdf', 'a/daily-en.pdf', 'daily-en.pdf/', 'daily--en.pdf', '-en.pdf', 'daily-en.pdf.bak', 'mis-user-guide-english.mp4', 'index.html']) assert.ok(!file.test(name), name);
  }
});

test('the workflow only runs by hand, lists unless told to delete, and stays out of the release queue', () => {
  const workflow = readFileSync(new URL('../.github/workflows/remove-retired-server-files.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const triggers = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\nconcurrency:'));
  assert.match(triggers, /^\non:\n  workflow_dispatch:\n/);
  assert.doesNotMatch(triggers, /push|schedule|pull_request|workflow_run/);
  assert.match(triggers, /delete:\n(?: {8}.*\n)*? {8}default: false\n/);
  assert.match(workflow, /DELETE_RETIRED_FILES: \$\{\{ inputs\.delete \}\}/);
  assert.match(workflow, /group: caliber-mis-retired-files\n/);
  assert.doesNotMatch(workflow, /caliber-mis-783-release|az webapp (?:restart|stop|start|deployment)/);
  const script = readFileSync(new URL('../scripts/remove-retired-server-files.mjs', import.meta.url), 'utf8');
  assert.match(script, /const remove = process\.env\.DELETE_RETIRED_FILES === 'true';/);
  assert.doesNotMatch(script, /recursive|api\/command|api\/zip/, 'files are deleted one by one by name, never a whole tree');
});
