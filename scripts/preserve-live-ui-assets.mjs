import {execFileSync} from 'node:child_process';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = 'dist/app-assets';
const resource = 'https://management.azure.com/subscriptions/58ca09cf-ab5d-47a8-a438-e1fb2a40d030/resourceGroups/coalmine-fleet-maintenance-rg/providers/Microsoft.Web/sites/caliber-mis-783';
const immutableName = /^[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|mjs|css)$/;

// A tab opened before a release still asks for that release's hashed files, so a release carries old
// files forward. It carries only what an open tab can still need:
//  1. the files of the version that is live right now: always, and the release stops if one cannot be read;
//  2. files that left the build in the last KEEP_DAYS days: newest first, until BUDGET_MS has passed;
//  3. nothing older. An ordinary sign-in lasts 7 days, and a tab that asks for a file that is gone
//     reloads itself once on the new version (src/lazy-feature.jsx).
// RETIRED_FILE travels inside every release and records when each old file left the build, so its age
// is known at the next release. Nothing here deletes a file from a server.
export const KEEP_DAYS = 7;
export const BUDGET_MS = 12 * 60_000;
export const RETIRED_FILE = 'RETIRED_UI_ASSETS.json';
const REQUEST_TIMEOUT_MS = 60_000;
const ATTEMPTS = 3;

export async function withRetries(task, {attempts = ATTEMPTS, pause = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
 for (let attempt = 1; ; attempt++) {
  try { return await task(); }
  catch (error) {
   if (attempt >= attempts) throw error;
   await pause(attempt * 1000);
  }
 }
}

// {"version":1,"retired":[{"at":"2026-11-23T10:00:00.000Z","files":["name-hash.js"]}]}
// A missing or unreadable record is the same as none: every old file then starts its 7 days today.
export function readRetired(text, now = Date.now()) {
 let groups;
 try { groups = JSON.parse(text).retired; } catch { return null; }
 if (!Array.isArray(groups)) return null;
 const retired = new Map();
 for (const group of groups) {
  const at = Date.parse(group?.at);
  if (!Number.isFinite(at) || !Array.isArray(group.files)) continue;
  for (const name of group.files) {
   if (typeof name === 'string' && immutableName.test(name)) retired.set(name, Math.max(retired.get(name) ?? 0, Math.min(at, now)));
  }
 }
 return retired;
}

export function retiredText(retired) {
 const groups = new Map();
 for (const [name, at] of retired) {
  const key = new Date(at).toISOString();
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(name);
 }
 return JSON.stringify({version: 1, retired: [...groups].sort(([a], [b]) => (a < b ? 1 : -1)).map(([at, files]) => ({at, files: files.sort()}))});
}

export async function preserveUiAssets(entries, {
 readPublished, directory = root, indexHtml = '', retired = null,
 now = Date.now(), keepDays = KEEP_DAYS, budgetMs = BUDGET_MS, clock = Date.now,
}) {
 const deadline = clock() + budgetMs;
 const listed = new Set(entries.filter(entry => entry.mime !== 'inode/directory' && immutableName.test(entry.name)).map(entry => entry.name));
 if (!listed.size) throw Error('No published UI assets were found. Stop before replacing the live release.');
 const built = new Set(await readdir(directory));
 const store = (name, content) => writeFile(path.join(directory, name), content, {flag: 'wx'});
 const pool = async (names, task) => {
  let next = 0;
  await Promise.all(Array.from({length: Math.min(8, names.length)}, async () => {
   while (next < names.length) await task(names[next++]);
  }));
 };

 // 1. The version that is live right now. Its page names its files and each file names the files it
 //    loads, so following the names from the live index.html finds every file an open tab can ask for.
 const live = new Set();
 const named = text => {
  const found = [];
  for (const name of new Set(String(text).split(/[^A-Za-z0-9_.-]+/))) {
   if (listed.has(name) && !live.has(name)) { live.add(name); found.push(name); }
  }
  return found;
 };
 let current = 0;
 for (let level = named(indexHtml); level.length;) {
  const texts = [];
  await pool(level, async name => {
   if (built.has(name)) { texts.push(await readFile(path.join(directory, name), 'utf8')); return; }
   const content = await readPublished(name);
   await store(name, content);
   current++;
   texts.push(Buffer.from(content).toString('utf8'));
  });
  level = texts.flatMap(named);
 }

 // 2. Older files. One this release retires is dated now. With a record, a file the record does not
 //    know has just left the build and must travel. With no record and no live page to follow, nothing
 //    tells the files apart, so all of them must travel, as before this rule.
 const keepMs = keepDays * 86_400_000, stamps = new Map(), must = [], recent = [];
 let expired = 0;
 for (const name of listed) {
  if (built.has(name)) continue;
  const known = live.has(name) ? undefined : retired?.get(name);
  stamps.set(name, known ?? now);
  if (live.has(name)) continue;
  if (known === undefined) (retired || !live.size ? must : recent).push(name);
  else if (now - known > keepMs) expired++;
  else recent.push(name);
 }
 await pool(must, async name => store(name, await readPublished(name)));

 // 3. The rest of the last keepDays days, newest first, until the time is used up. A file that cannot
 //    be read or does not fit in the time is left out; its tab reloads itself if it ever asks for it.
 recent.sort((a, b) => stamps.get(b) - stamps.get(a));
 let carriedRecent = 0, leftOut = 0;
 await pool(recent, async name => {
  if (clock() >= deadline) { leftOut++; return; }
  let content;
  try { content = await readPublished(name); } catch { leftOut++; return; }
  await store(name, content);
  carriedRecent++;
 });
 return {carried: current + must.length + carriedRecent, current: current + must.length, recent: carriedRecent, leftOut, expired, retired: stamps};
}

async function run() {
 const token = JSON.parse(execFileSync('az', ['account','get-access-token','--resource','https://management.azure.com/','--output','json'], {
  encoding: 'utf8', stdio: ['ignore','pipe','pipe'],
 })).accessToken;
 const get = (url, {optional = false} = {}) => withRetries(async () => {
  const response = await fetch(url, {headers:{Authorization:'Bearer '+token}, redirect:'error', signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
  if (optional && response.status === 404) return null;
  if (!response.ok) throw Error('Azure asset read failed with HTTP '+response.status);
  return Buffer.from(await response.arrayBuffer());
 });
 const app = JSON.parse(await get(resource+'?api-version=2023-12-01'));
 const host = app.properties?.enabledHostNames?.find(name => /^caliber-mis-783(?:-[a-z0-9]+)?\.scm\.(?:[a-z0-9-]+\.)?azurewebsites\.net$/.test(name));
 if (!host) throw Error('Production deployment host is unavailable.');
 const site = 'https://'+host+'/api/vfs/site/wwwroot/';
 const base = site+root+'/';
 const now = Date.now();
 const entries = JSON.parse(await get(base));
 const record = await get(site+RETIRED_FILE, {optional: true});
 const indexHtml = await get(site+'dist/index.html', {optional: true});
 const result = await preserveUiAssets(entries, {
  readPublished: name => get(base+encodeURIComponent(name)),
  indexHtml: indexHtml ? indexHtml.toString('utf8') : '',
  retired: record ? readRetired(record.toString('utf8'), now) : null,
  now,
 });
 await writeFile(RETIRED_FILE, retiredText(result.retired));
 console.log('Retained '+result.carried+' immutable assets from earlier MIS releases.');
 console.log(' '+result.current+' are files of the version live now or files this release retires; '+result.recent+' left the build in the last '+KEEP_DAYS+' days.');
 console.log(' Not carried: '+result.expired+' older than '+KEEP_DAYS+' days; '+result.leftOut+' not read within '+BUDGET_MS / 60_000+' minutes.');
 if (!record) console.log(' No record of earlier releases was found on the server; every old file starts its '+KEEP_DAYS+' days now.');
 if (result.leftOut) console.log('::warning::'+result.leftOut+' older screen files were left out of this release because reading them took too long. A tab that still needs one reloads itself once.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
