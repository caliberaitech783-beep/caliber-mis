import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = 'dist/app-assets';
const resource = 'https://management.azure.com/subscriptions/58ca09cf-ab5d-47a8-a438-e1fb2a40d030/resourceGroups/coalmine-fleet-maintenance-rg/providers/Microsoft.Web/sites/caliber-mis-783';
const immutableName = /^[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|mjs|css)$/;

export async function preserveUiAssets(entries, {readPublished, directory = root}) {
 const assets = entries.filter(entry => entry.mime !== 'inode/directory' && immutableName.test(entry.name));
 if (!assets.length) throw Error('No published UI assets were found. Stop before replacing the live release.');
 let next = 0, retained = 0;
 await Promise.all(Array.from({length: Math.min(8, assets.length)}, async () => {
  while (next < assets.length) {
   const {name} = assets[next++];
   const target = path.join(directory, name);
   const exists = await readFile(target).then(() => true, error => {
    if (error.code !== 'ENOENT') throw error;
    return false;
   });
   if (exists) continue;
   await writeFile(target, await readPublished(name), {flag: 'wx'});
   retained++;
  }
 }));
 return retained;
}

async function run() {
 const token = JSON.parse(execFileSync('az', ['account','get-access-token','--resource','https://management.azure.com/','--output','json'], {
  encoding: 'utf8', stdio: ['ignore','pipe','pipe'],
 })).accessToken;
 const get = async url => {
  const response = await fetch(url, {headers:{Authorization:'Bearer '+token}, redirect:'error', signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw Error('Azure asset read failed with HTTP '+response.status);
  return response;
 };
 const app = await (await get(resource+'?api-version=2023-12-01')).json();
 const host = app.properties?.enabledHostNames?.find(name => /^caliber-mis-783(?:-[a-z0-9]+)?\.scm\.(?:[a-z0-9-]+\.)?azurewebsites\.net$/.test(name));
 if (!host) throw Error('Production deployment host is unavailable.');
 const base = 'https://'+host+'/api/vfs/site/wwwroot/'+root+'/';
 const entries = await (await get(base)).json();
 const retained = await preserveUiAssets(entries, {
  readPublished: async name => Buffer.from(await (await get(base+encodeURIComponent(name))).arrayBuffer()),
 });
 console.log('Retained '+retained+' immutable assets from earlier MIS releases.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
