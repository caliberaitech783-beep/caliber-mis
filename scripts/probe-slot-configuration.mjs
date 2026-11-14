// Read-only look at what the staging slot of caliber-mis-783 lacks compared with production, and at why its app did
// not come up. It changes nothing on either slot.
//
// On 13 Nov 2026 16:05 IST the staging slot was deleted and created again from production's configuration. The new
// slot accepted the upload, but its app never answered a healthy /api/health: the last good release was ready in
// 29 seconds, this one was not in 12 minutes, so the release stopped before the swap. A slot created that way does
// not get everything production has: its identity, its network link and its storage mounts are set per slot.
//
// The build log is public. A setting is shown by its name and kind, never by its value; log lines are masked and cut.
import {execFileSync} from 'node:child_process';
import {compareSettings, maskLine, safeName, tailLines} from './slot-configuration-compare.mjs';

const group = 'coalmine-fleet-maintenance-rg';
const app = 'caliber-mis-783';
const slot = process.env.MIS_STAGING_SLOT || 'staging';
const az = args => execFileSync('az', args, {encoding: 'utf8', timeout: 90000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']}).trim();
// A parse error could quote the text it failed on, so it is replaced by a fixed message.
function json(args) {
  const text = az([...args, '-o', 'json']);
  try { return JSON.parse(text || 'null'); } catch { throw Error('Azure did not answer with JSON.'); }
}
const where = name => ['-g', group, '-n', app, ...(name === 'staging' ? ['--slot', slot] : [])];
const both = read => ({production: read('production'), staging: read('staging')});
const row = (label, production, staging) =>
  console.log(`${production === staging ? '  same  ' : 'DIFFERS '} ${label}: production = ${production} | staging = ${staging}`);
const names = list => list.map(item => `${item.name} (${item.kind}${item.slotSetting ? ', kept with its slot' : ''})`).join(', ') || 'none';

async function attempt(title, work) {
  console.log('\n--- ' + title);
  try { await work(); } catch (error) { console.log('could not be read: ' + maskLine(error?.stderr || error?.message || error, 300)); }
}

console.log('===================== staging slot against production, ' + new Date().toISOString());

let site = null;
await attempt('the two slots as Azure describes them', () => {
  site = both(name => json(['webapp', 'show', ...where(name)]));
  const read = {
    'state': s => s.state,
    'managed identity': s => s.identity?.type || 'none',
    'identity used for Key Vault references': s => !s.keyVaultReferenceIdentity ? 'not given' : /^SystemAssigned$/i.test(s.keyVaultReferenceIdentity) ? 'system assigned' : 'user assigned',
    'joined to a virtual network': s => s.virtualNetworkSubnetId ? 'yes' : 'no',
    'public network access': s => s.publicNetworkAccess || 'not given',
    'HTTPS only': s => String(s.httpsOnly),
    'App Service plan': s => safeName(String(s.serverFarmId || '').split('/').pop()),
  };
  for (const [label, pick] of Object.entries(read)) row(label, pick(site.production), pick(site.staging));
});

await attempt('general configuration', () => {
  const config = both(name => json(['webapp', 'config', 'show', ...where(name)]));
  const read = {
    'runtime': c => maskLine(c.linuxFxVersion || 'not given', 60),
    'start-up command': c => c.appCommandLine ? maskLine(c.appCommandLine, 120) : 'not given',
    'always on': c => String(c.alwaysOn),
    'health check path': c => c.healthCheckPath ? maskLine(c.healthCheckPath, 60) : 'not given',
    'workers': c => String(c.numberOfWorkers),
    'route all traffic through the network': c => String(c.vnetRouteAllEnabled),
    'web sockets': c => String(c.webSocketsEnabled),
    'access rules (count)': c => String((c.ipSecurityRestrictions || []).length),
    'access rules for the deployment site (count)': c => String((c.scmIpSecurityRestrictions || []).length),
  };
  for (const [label, pick] of Object.entries(read)) row(label, pick(config.production), pick(config.staging));
});

await attempt('app settings, by name and kind only', () => {
  const list = both(name => json(['webapp', 'config', 'appsettings', 'list', ...where(name)]));
  const result = compareSettings(list.production, list.staging);
  console.log(`production has ${result.production}, staging has ${result.staging}`);
  console.log(`Key Vault references: production ${result.keyVaultReferences.production}, staging ${result.keyVaultReferences.staging}`);
  console.log('only in production: ' + names(result.onlyProduction));
  console.log('only in staging: ' + names(result.onlyStaging));
  console.log('in both, value differs: ' + (result.different.map(item => `${item.name} (${item.production} / ${item.staging})`).join(', ') || 'none'));
});

await attempt('whether each Key Vault reference can be read by its slot (name and status only)', async () => {
  if (!site?.production?.id) throw Error('the site was not read');
  const token = az(['account', 'get-access-token', '--resource', 'https://management.azure.com/', '--query', 'accessToken', '-o', 'tsv']);
  for (const [name, id] of [['production', site.production.id], ['staging', site.production.id + '/slots/' + slot]]) {
    const response = await fetch('https://management.azure.com' + id + '/config/configreferences/appsettings?api-version=2023-12-01', {headers: {Authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(30000)});
    if (!response.ok) { console.log(`${name}: HTTP ${response.status}`); continue; }
    const items = (await response.json()).value || [];
    const failed = items.filter(item => !/^resolved$/i.test(item.properties?.status || ''));
    console.log(`${name}: ${items.length} references, ${items.length - failed.length} resolved`);
    for (const item of failed) console.log(`  ${safeName(item.name)}: ${maskLine(item.properties?.status || 'no status', 60)}`);
  }
});

await attempt('connection strings, by name and kind only', () => {
  const list = both(name => json(['webapp', 'config', 'connection-string', 'list', ...where(name)]));
  const result = compareSettings(list.production, list.staging);
  console.log(`production has ${result.production}, staging has ${result.staging}`);
  console.log('only in production: ' + names(result.onlyProduction));
  console.log('only in staging: ' + names(result.onlyStaging));
  console.log('in both, value differs: ' + (result.different.map(item => item.name).join(', ') || 'none'));
});

await attempt('storage mounts (name, kind, path and state only)', () => {
  const list = both(name => json(['webapp', 'config', 'storage-account', 'list', ...where(name)]));
  const line = item => `${safeName(item.name)}: ${safeName(item.value?.type)} at ${maskLine(item.value?.mountPath, 80)}, ${safeName(item.value?.state)}`;
  for (const name of ['production', 'staging']) {
    console.log(`${name}: ${(list[name] || []).length} mounts`);
    for (const item of list[name] || []) console.log('  ' + line(item));
  }
  const paths = name => (list[name] || []).map(item => String(item.value?.mountPath)).sort().join('|');
  console.log(paths('production') === paths('staging') ? '  same   mount paths' : 'DIFFERS  mount paths');
});

await attempt('virtual network links', () => {
  const list = both(name => json(['webapp', 'vnet-integration', 'list', ...where(name)]));
  row('network links (count)', String((list.production || []).length), String((list.staging || []).length));
});

// The app's own output and the platform's container log are files on the slot's drive, readable while the app is stopped.
await attempt('staging: the newest start-up logs of the app (masked, last lines)', async () => {
  const token = az(['account', 'get-access-token', '--resource', 'https://management.azure.com/', '--query', 'accessToken', '-o', 'tsv']);
  const hosts = json(['webapp', 'show', ...where('staging'), '--query', 'enabledHostNames']);
  const host = (hosts || []).find(value => value.startsWith(app) && /^[a-z0-9-]+\.scm\.(?:[a-z0-9-]+\.)?azurewebsites\.net$/.test(value));
  if (!host) throw Error('Azure did not return a recognized deployment hostname.');
  const headers = {Authorization: 'Bearer ' + token, 'Accept-Encoding': 'identity'};
  const get = route => fetch('https://' + host + route, {headers, redirect: 'error', signal: AbortSignal.timeout(45000)});
  const listing = await get('/api/vfs/LogFiles/');
  if (!listing.ok) throw Error('log folder: HTTP ' + listing.status);
  const files = (await listing.json()).filter(file => /docker\.log$/i.test(file.name)).sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
  console.log('container log files: ' + files.length);
  const app_ = files.find(file => /_default_docker\.log$/i.test(file.name));
  const platform = files.find(file => !/_default_docker\.log$/i.test(file.name));
  for (const [what, file] of [['the platform, starting the container', platform], ['the app itself', app_]]) {
    if (!file) { console.log(`\n${what}: no log file`); continue; }
    console.log(`\n${what}: ${safeName(file.name)}, ${file.size} bytes, changed ${safeName(file.mtime)}`);
    if (file.size > 8 * 1024 * 1024) { console.log('  larger than 8 MB, not read'); continue; }
    const response = await get('/api/vfs/LogFiles/' + encodeURIComponent(file.name));
    if (!response.ok) { console.log('  HTTP ' + response.status); continue; }
    for (const line of tailLines(await response.text(), 45, 260)) console.log('  ' + line);
  }
});
