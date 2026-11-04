import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gitUiDeltaPlan} from './ui-delta-plan.mjs';
import {verifyBuiltUiRelease, verifyPublishedUiRelease} from './verify-ui-release.mjs';

const site = 'https://pulse-ll.cmll.in';
const resource = 'https://management.azure.com/subscriptions/58ca09cf-ab5d-47a8-a438-e1fb2a40d030/resourceGroups/coalmine-fleet-maintenance-rg/providers/Microsoft.Web/sites/caliber-mis-783';

// All writes overwrite named files or expand a ZIP additively. No clean, prune,
// delete, database operation or dependency installation is part of this path.
export async function applyUiDelta(ops, plan) {
 if (!plan.eligible) return {applied:false};
 let backup;
 try { backup = await ops.backup(plan); }
 catch (error) { ops.fallback?.(error); return {applied:false}; } // No write occurred.
 await ops.assertBaseline(plan.baseline);
 try {
  await ops.publishAssets(plan);
  await ops.publishSources(plan);
  await ops.publishIdentity(plan);
  await ops.restart();
  await ops.verify(plan.current);
  return {applied:true};
 } catch (failure) {
  try {
   await ops.restore(backup);
   await ops.restart();
   await ops.verify(plan.baseline);
  } catch {
   throw Error('UI deployment and automatic restore could not be verified. The saved rollback artifact is required.');
  }
  throw Error('UI deployment failed; the previous UI was restored and verified.');
 }
}

export async function missingUiAssets(files, {readLocal, readRemote}) {
 const missing = new Array(files.length);
 let next = 0;
 await Promise.all(Array.from({length:Math.min(4, files.length)}, async () => {
  while (next < files.length) {
   const index = next++, file = files[index];
   const local = await readLocal(file), remote = await readRemote(file);
   if (remote === null) missing[index] = file;
   else if (createHash('sha256').update(local).digest('hex') !== createHash('sha256').update(remote).digest('hex')) throw Error('An existing immutable UI asset differs; complete deployment is required.');
  }
 }));
 return missing.filter(Boolean);
}

export async function deployUiDelta({baseline, current, output = process.env.RUNNER_TEMP} = {}) {
 const plan = gitUiDeltaPlan(baseline, current, {healthy:true});
 if (!plan.eligible) return {applied:false};
 if (!output || path.resolve(output) === process.cwd()) throw Error('A separate rollback directory is required.');
 await verifyBuiltUiRelease({expected:current});
 const token = JSON.parse(execFileSync('az', ['account','get-access-token','--resource','https://management.azure.com/','--output','json'], {encoding:'utf8', stdio:['ignore','pipe','pipe']})).accessToken;
 let scm;
 const directory = path.join(output, 'ui-delta-'+current);
 await mkdir(directory, {recursive:true});
 const call = async (url, {method='GET', body, type='application/octet-stream', allowMissing=false} = {}) => {
  const parsed = new URL(url);
  if (![scm, new URL(resource).origin].includes(parsed.origin)) throw Error('Invalid deployment API origin.');
  const response = await fetch(url, {method, body, redirect:'error', signal:AbortSignal.timeout(60000), headers:{Authorization:'Bearer '+token, 'Content-Type':type, ...(method==='PUT'?{'If-Match':'*'}:{})}});
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw Error(`Deployment API returned HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 128*1024*1024) throw Error('UI rollback archive exceeds the safety limit.');
  return bytes;
 };
 const app = JSON.parse((await call(resource+'?api-version=2023-12-01')).toString());
 const scmHost = app.properties?.enabledHostNames?.find(host => /^caliber-mis-783(?:-[a-z0-9]+)?\.scm\.(?:[a-z0-9-]+\.)?azurewebsites\.net$/.test(host));
 if (!scmHost) return {applied:false};
 scm = 'https://'+scmHost;
 const vfs = file => scm+'/api/vfs/site/wwwroot/'+file.split('/').map(encodeURIComponent).join('/');
 const publicJson = async route => {
  const response = await fetch(site+route+'?ui-delta='+Date.now(), {cache:'no-store', signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw Error('Live release is unavailable.');
  return response.json();
 };
 const assertBaseline = async expected => {
  const [health, version] = await Promise.all([publicJson('/api/health'), publicJson('/api/app-version')]);
  if (health.status !== 'ok' || health.database !== 'connected' || health.scheduledJobsEnabled !== false || health.commit !== expected || version.commit !== expected || version.version !== expected) throw Error('Live release changed or is unhealthy; refusing UI update.');
 };
 const restart = () => call(resource+'/restart?api-version=2023-12-01', {method:'POST'});
 const verify = async expected => {
  for (let attempt=0; attempt<24; attempt++) {
   try { await assertBaseline(expected); await verifyPublishedUiRelease({base:site, expected}); return; } catch {}
   await new Promise(resolve=>setTimeout(resolve,5000));
  }
  throw Error('Live UI verification failed.');
 };
 const put = async (file, bytes) => call(vfs(file), {method:'PUT', body:bytes});
 const assetRoot = path.resolve('dist/app-assets');
 let newAssets = [];
 return applyUiDelta({
  assertBaseline, restart, verify,
  fallback: error => console.warn('UI preflight: '+error.message),
  backup: async () => {
   await assertBaseline(baseline);
   // Old hashed assets remain available to both open tabs and rollback. Never
   // overwrite them: compare bytes and upload only absent files. This avoids
   // downloading the potentially large history of previous releases.
   const assets = (await readdir(assetRoot, {recursive:true, withFileTypes:true})).filter(entry=>entry.isFile()).map(entry=>path.relative(assetRoot,path.join(entry.parentPath,entry.name)).replaceAll('\\','/'));
   if (!assets.length || assets.some(file=>file.startsWith('../') || /[\r\n]/.test(file))) throw Error('Built UI assets are missing or invalid.');
   newAssets = await missingUiAssets(assets, {
    readLocal:file=>readFile(path.join(assetRoot,file)),
    readRemote:file=>call(vfs('dist/app-assets/'+file), {allowMissing:true})
   });
   const files = {};
   for (const file of [...plan.files, 'dist/index.html', 'dist/app-version.txt', 'DEPLOYMENT_SHA']) files[file] = (await call(vfs(file))).toString('base64');
   if (Buffer.from(files.DEPLOYMENT_SHA,'base64').toString().trim() !== baseline) throw Error('Disk release differs from live release.');
   await writeFile(path.join(directory,'previous-files.json'), JSON.stringify(files));
   await writeFile(path.join(directory,'previous-assets.json'), JSON.stringify({existingAssetsPreserved:true, newAssets}));
   await writeFile(path.join(directory,'release.json'), JSON.stringify({baseline,current}));
   console.log(`UI assets checked: ${assets.length}; new files: ${newAssets.length}. Existing assets, installers and videos are preserved.`);
   return {files};
  },
  publishAssets: async () => {
   // Publish all hashed assets before the HTML entry point; old assets remain.
   if (!newAssets.length) return;
   const zip = path.join(directory,'new-assets.zip');
   execFileSync('zip', ['-q', zip, '-@'], {cwd:assetRoot, input:newAssets.join('\n')+'\n', stdio:['pipe','pipe','pipe']});
   await call(scm+'/api/zip/site/wwwroot/dist/app-assets/', {method:'PUT', body:await readFile(zip), type:'application/zip'});
  },
  publishSources: async () => { for (const file of plan.files) await put(file, await readFile(file)); },
  publishIdentity: async () => {
   await put('dist/index.html', await readFile('dist/index.html'));
   await put('dist/app-version.txt', await readFile('dist/app-version.txt'));
   await put('DEPLOYMENT_SHA', Buffer.from(current+'\n'));
  },
  restore: async backup => {
   // Previous assets were never touched; restoring exact pointers is sufficient.
   for (const [file, bytes] of Object.entries(backup.files)) await put(file, Buffer.from(bytes,'base64'));
  }
 }, plan);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const result = await deployUiDelta({baseline:process.env.UI_BASELINE_COMMIT, current:process.env.RELEASE_COMMIT});
 if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `applied=${result.applied}\n`, {flag:'a'});
 console.log(result.applied ? 'Additive UI deployment and live verification succeeded.' : 'UI preflight unavailable; complete deployment required.');
}
