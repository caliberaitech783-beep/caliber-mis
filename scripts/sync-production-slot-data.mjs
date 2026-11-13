import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {SlotBusyError, busyStatus, retryTransient} from './slot-data-retry.mjs';

const group = 'coalmine-fleet-maintenance-rg';
const app = 'caliber-mis-783';
const slot = process.env.MIS_STAGING_SLOT;
const direction = process.argv[2];
if (!slot || !['to-staging', 'to-production'].includes(direction)) {
  throw Error('Expected a staging slot and a synchronization direction.');
}

const az = args => execFileSync('az', args, {encoding: 'utf8', timeout: 60000}).trim();
const token = az(['account', 'get-access-token', '--resource', 'https://management.azure.com/', '--query', 'accessToken', '-o', 'tsv']);
function scm(extraArgs) {
  const hosts = JSON.parse(az(['webapp', 'show', '-g', group, '-n', app, ...extraArgs, '--query', 'enabledHostNames', '-o', 'json']));
  const host = hosts.find(value => /^caliber-mis-783[a-z0-9-]*\.scm\.(?:[a-z0-9-]+\.)?azurewebsites\.net$/.test(value));
  if (!host) throw Error('Azure did not return a recognized deployment hostname.');
  return 'https://' + host;
}

const production = scm([]);
const staging = scm(['--slot', slot]);
const [source, destination] = direction === 'to-staging' ? [production, staging] : [staging, production];
const headers = {Authorization: 'Bearer ' + token, 'Accept-Encoding': 'identity'};
const vfs = parts => '/api/vfs/' + parts.map(encodeURIComponent).join('/');
const request = (host, route, options = {}, timeout = 60000) => fetch(host + route, {
  ...options,
  headers: {...headers, ...options.headers},
  redirect: 'error',
  signal: AbortSignal.timeout(timeout),
});
// A read that changes nothing on either slot: tried again when the slot stalls, drops the connection or says it is busy.
const read = (host, route, options) => retryTransient(async () => {
  const response = await request(host, route, options);
  if (busyStatus(response.status)) throw new SlotBusyError('Slot data read failed with HTTP ' + response.status);
  return response;
});
async function command(host, code, timeout) {
  const encoded = Buffer.from(code).toString('base64');
  const result = await request(host, '/api/command', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({command: `node -e "eval(Buffer.from('${encoded}','base64').toString())"`, dir: '/home'}),
  }, timeout);
  if (busyStatus(result.status)) throw new SlotBusyError('Slot data command failed with HTTP ' + result.status);
  if (!result.ok) throw Error('Slot data command failed with HTTP ' + result.status);
  const {Output, ExitCode} = await result.json();
  if (ExitCode !== 0) throw Error('Slot data command failed.');
  return Output;
}

// One file check may take three minutes. Azure cuts a request that has sent nothing back after 230 seconds, so a
// longer wait could never be answered.
const CHECK_TIMEOUT = 180000;
let checked = 0, slowestCheck = 0;
const homePath = parts => '/home/' + parts.join('/');
async function checksum(host, parts) {
  // Hash on the slot so existing archives don't have to be downloaded again. Hashing changes nothing, so a check
  // that stalls is tried again: on 12 Nov 2026 one check on the staging slot ran past 60 seconds in two releases
  // and each time failed the whole release before the swap.
  const code = `const fs=require('node:fs'),h=require('node:crypto').createHash('sha256');const s=fs.createReadStream(${JSON.stringify(homePath(parts))});s.on('data',b=>h.update(b));s.on('end',()=>console.log(h.digest('hex')));s.on('error',()=>{process.exitCode=1});`;
  const started = Date.now();
  const Output = await retryTransient(() => command(host, code, CHECK_TIMEOUT), {what: 'Slot file check'});
  slowestCheck = Math.max(slowestCheck, Date.now() - started);
  const digest = Output?.trim();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw Error('Slot file checksum could not be verified.');
  return digest;
}

const key = vfs(['data', 'caliber-mis', 'integration.key']);
const [sourceKey, destinationKey] = await Promise.all([read(source, key), read(destination, key)]);
if (!sourceKey.ok || !destinationKey.ok ||
    !Buffer.from(await sourceKey.arrayBuffer()).equals(Buffer.from(await destinationKey.arrayBuffer()))) {
  throw Error('Slot integration keys must exist and match before synchronizing data.');
}

let copied = 0;
async function copyDirectory(parts) {
  const route = vfs(parts) + '/';
  const listing = await read(source, route);
  if (listing.status === 404) return;
  if (!listing.ok) throw Error('Source directory read failed with HTTP ' + listing.status);
  const entries = await listing.json();
  const directory = await request(destination, route, {method: 'PUT', headers: {'If-None-Match': '*'}});
  if (!directory.ok && ![409, 412].includes(directory.status)) throw Error('Destination directory setup failed with HTTP ' + directory.status);

  for (const entry of entries) {
    if (!entry.name || ['.', '..'].includes(entry.name) || /[\\/]/.test(entry.name)) throw Error('Invalid slot data filename.');
    if (/^\.slot-sync-[a-f0-9-]+\.tmp$/.test(entry.name)) continue;
    const child = [...parts, entry.name];
    if (entry.mime === 'inode/directory') {
      await copyDirectory(child);
      continue;
    }
    const file = vfs(child);
    const existing = await read(destination, file, {method: 'HEAD'});
    if (existing.ok) {
      if (Number(existing.headers.get('content-length')) !== entry.size) throw Error('Slot data file conflicts with an existing file.');
      const [original, duplicate] = await Promise.all([checksum(source, child), checksum(destination, child)]);
      if (original !== duplicate) throw Error('Slot data file conflicts with an existing file.');
      checked++;
      continue;
    }
    if (existing.status !== 404) throw Error('Destination file check failed with HTTP ' + existing.status);
    const incoming = await request(source, file, {}, 900000);
    if (!incoming.ok) throw Error('Source file read failed with HTTP ' + incoming.status);
    const hash = createHash('sha256');
    const temp = [...parts, '.slot-sync-' + randomUUID() + '.tmp'];
    try {
      const uploaded = await request(destination, vfs(temp), {
        method: 'PUT',
        headers: {'Content-Type': 'application/octet-stream', 'Content-Length': String(entry.size), 'If-None-Match': '*'},
        body: incoming.body.pipeThrough(new TransformStream({
          transform(chunk, controller) {
            hash.update(chunk);
            controller.enqueue(chunk);
          },
        })),
        duplex: 'half',
      }, 900000);
      if (!uploaded.ok) throw Error('Slot data copy failed with HTTP ' + uploaded.status);
      const digest = hash.digest('hex');
      if (await checksum(destination, temp) !== digest) throw Error('Slot data copy checksum did not verify.');
      const args = ['-n', '--', homePath(temp), homePath(child)];
      await command(destination, `require('node:child_process').execFileSync('mv',${JSON.stringify(args)});`);
      if (await checksum(destination, child) !== digest) throw Error('A concurrent slot data file conflicts with the copy.');
    } finally {
      const removed = await request(destination, vfs(temp), {method: 'DELETE', headers: {'If-Match': '*'}});
      if (!removed.ok && removed.status !== 404) throw Error('Temporary slot data file cleanup failed.');
    }
    copied++;
  }
}

// Backup and archive files are stored on the slot's content share.
for (const path of [['data', 'bdms-backups'], ['data', 'caliber-mis', 'scanned-cards']]) await copyDirectory(path);
// The slowest check is printed so a check creeping towards the three-minute wait shows up before it fails a release.
console.log('Slot data synchronization completed. Files copied: ' + copied + '. Files already there and checked: ' + checked +
  '. Slowest file check: ' + Math.round(slowestCheck / 1000) + ' s.');
