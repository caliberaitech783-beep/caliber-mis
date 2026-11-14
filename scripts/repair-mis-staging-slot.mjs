// Repairs the staging slot of caliber-mis-783.
//
// On 13 Nov 2026 (16:05 IST) the staging slot was deleted and created again. A new slot does not get what Azure keeps
// per slot, so it came back with 1 of production's 18 app settings (no database address), no identity of its own and
// an empty drive. Its app exits 16 seconds after starting, so every release stops before the swap.
//
// This puts back, on the staging slot only:
//   1. its own managed identity;
//   2. the integration key file of the live drive (a release refuses to run unless both drives hold the same key,
//      and an app that starts without one writes a new key, which cannot read the saved integration secrets);
//   3. what the new identity needs: reading the database secret, and the scanned-cards storage container;
//   4. the app settings production has and staging lacks (copied inside Azure, never shown).
// Then it starts the staging app once, checks that it answers healthy, and leaves the slot as it found it.
// It never changes the production slot, its settings or its drive: production is only read.
//
// Run it where `az` is signed in, and only while no release is running (the "Repair MIS staging slot" workflow waits
// for one by itself; in Azure Cloud Shell look at the Actions page first):
//   node repair-mis-staging-slot.mjs            lists what is missing and changes nothing
//   node repair-mis-staging-slot.mjs --apply    repairs the staging slot
// Step 3 needs a sign-in that may grant access (an Azure owner). When this sign-in may not, everything else is still
// done and the grants that remain are listed.
//
// The output can be a public build log: a setting is named, its value is never shown, and no key, token, account
// name or address is printed. Azure's own error text can quote a setting, so only its short error code is kept.
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const SUBSCRIPTION = '58ca09cf-ab5d-47a8-a438-e1fb2a40d030';
export const GROUP = 'coalmine-fleet-maintenance-rg';
export const APP = 'caliber-mis-783';
const ARM = 'https://management.azure.com';
const WEB_API = '2023-12-01';
const ROLE_API = '2022-04-01';
export const ROLES = {
  secret: {id: '4633458b-17de-408a-b874-0445c86b69e6', name: 'Key Vault Secrets User'},
  blobs: {id: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe', name: 'Storage Blob Data Contributor'},
};
// Staging answers only before a swap. Whatever production is set to, it never runs timed jobs or delivers messages.
export const STAGING_ALWAYS = {DISABLE_SCHEDULED_JOBS: 'true', META_WHATSAPP_DELIVERY_PAUSED: 'true'};
// Where the server keeps its integration key (server.mjs) and where a release expects it on both drives
// (scripts/sync-production-slot-data.mjs). Kudu serves /home as /api/vfs/.
export const KEY_FILE = ['data', 'caliber-mis', 'integration.key'];
const OWNER_HELP = [
  'An Azure owner can finish it. While no release is running, open Cloud Shell (Bash) in the Azure portal and run:',
  '  curl -fsSL https://raw.githubusercontent.com/caliberaitech783-beep/caliber-mis/main/scripts/repair-mis-staging-slot.mjs -o repair.mjs && node repair.mjs --apply',
].join('\n');

// A message of this script's own making: safe to print as it is.
export class RepairStop extends Error {}

export const safeName = name => String(name ?? '').replace(/[^\w.:-]/g, '?').slice(0, 80);

// One log line made safe to print: credentials, keys, long values, addresses and hosts are replaced, then it is cut.
export function maskLine(value, length = 240) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/:\/\/[^/\s:@]+:[^@\s]+@/g, '://<hidden>@')
    .replace(/\b(password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key|account[-_]?key|authorization|bearer|sig|signature)\b(\s*[=:]\s*|\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1$2<hidden>')
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, '<long value>')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>')
    .replace(/\b(?:[a-z0-9-]+\.)+(?:azure\.com|azure\.net|windows\.net|azurewebsites\.net)\b/gi, '<azure host>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
    .slice(0, length);
}

// The vault and secret a Key Vault reference points at, or null when the value is not one.
export function parseKeyVaultReference(value) {
  const match = /^@Microsoft\.KeyVault\((.*)\)$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  const fields = {};
  for (const part of match[1].split(';')) {
    const at = part.indexOf('=');
    if (at > 0) fields[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
  }
  if (fields.secreturi) {
    const uri = /^https:\/\/([a-z0-9-]{3,24})\.vault\.azure\.net\/secrets\/([A-Za-z0-9-]{1,127})(?:\/[A-Za-z0-9]*)?\/?$/i.exec(fields.secreturi);
    return uri ? {vault: uri[1].toLowerCase(), secret: uri[2]} : null;
  }
  const vault = fields.vaultname || '', secret = fields.secretname || '';
  return /^[a-z0-9-]{3,24}$/i.test(vault) && /^[A-Za-z0-9-]{1,127}$/.test(secret) ? {vault: vault.toLowerCase(), secret} : null;
}

// The settings production has and staging lacks, with production's values. A setting staging already has is left alone.
export function settingsToAdd(production, staging) {
  const add = {};
  for (const [name, value] of Object.entries(production || {})) {
    if (Object.hasOwn(staging || {}, name)) continue;
    add[name] = Object.hasOwn(STAGING_ALWAYS, name) ? STAGING_ALWAYS[name] : value;
  }
  return add;
}

const lower = value => String(value ?? '').toLowerCase();
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notResolved = item => !/^resolved$/i.test(item.status);

export async function repairStagingSlot({
  apply = false, token, slot = 'staging', fetchImpl = fetch, log = console.log,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (!/^[a-z0-9-]{1,40}$/.test(slot) || slot === 'production') throw new RepairStop('The staging slot name is not valid.');
  if (!token) throw new RepairStop('No Azure sign-in was found.');
  const site = `/subscriptions/${SUBSCRIPTION}/resourceGroups/${GROUP}/providers/Microsoft.Web/sites/${APP}`;
  const stagingId = `${site}/slots/${slot}`;
  const authorization = {Authorization: 'Bearer ' + token};

  async function arm(method, path, {body, api = WEB_API} = {}) {
    const url = ARM + path + (path.includes('?') ? '&' : '?') + 'api-version=' + api;
    const response = await fetchImpl(url, {
      method,
      headers: body === undefined ? authorization : {...authorization, 'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    let json = null;
    try { json = await response.json(); } catch { json = null; }
    return {ok: response.ok, status: response.status, json: response.ok ? json : null, code: response.ok ? '' : safeName(json?.error?.code || '').slice(0, 60)};
  }
  const scm = (host, route, {method = 'GET', headers = {}, body} = {}) => fetchImpl('https://' + host + route, {
    method, body, headers: {...authorization, 'Accept-Encoding': 'identity', ...headers}, redirect: 'error', signal: AbortSignal.timeout(60000),
  });
  const failed = (what, result) => `${what} (HTTP ${result.status}${result.code ? ', ' + result.code : ''}).`;
  const head = text => log('\n--- ' + text);
  const remaining = [];
  let ownerNeeded = false;

  log(`===================== staging slot repair, ${apply ? 'APPLY' : 'list only, nothing is changed'}, ${new Date().toISOString()}`);

  head('the two slots');
  const live = await arm('GET', site);
  if (!live.ok) throw new RepairStop(failed('The production slot could not be read', live));
  const stage = await arm('GET', stagingId);
  if (stage.status === 404) throw new RepairStop('The staging slot does not exist. It has to be created before it can be repaired.');
  if (!stage.ok) throw new RepairStop(failed('The staging slot could not be read', stage));
  if (!live.json?.properties?.serverFarmId || lower(live.json.properties.serverFarmId) !== lower(stage.json?.properties?.serverFarmId)) {
    throw new RepairStop('The two slots are not on the same App Service plan. Nothing was changed.');
  }
  const identityKind = item => safeName(item?.identity?.type || 'none');
  const wasRunning = /^running$/i.test(stage.json.properties.state || '');
  log(`production: ${safeName(live.json.properties.state)}, identity ${identityKind(live.json)}`);
  log(`staging: ${safeName(stage.json.properties.state)}, identity ${identityKind(stage.json)}`);

  head('1. identity of the staging slot');
  let principal = /SystemAssigned/i.test(stage.json.identity?.type || '') ? String(stage.json.identity.principalId || '') : '';
  if (principal) log('already switched on');
  else if (stage.json.identity?.type && !/^none$/i.test(stage.json.identity.type)) {
    remaining.push('The staging slot has another kind of identity. It was left alone: switch its system-assigned identity on by hand.');
    log('another kind of identity is set: left alone');
  } else if (!apply) log('MISSING: would be switched on');
  else {
    const set = await arm('PATCH', stagingId, {body: {identity: {type: 'SystemAssigned'}}});
    if (!set.ok) remaining.push(failed('The identity of the staging slot could not be switched on', set));
    else {
      principal = String(set.json?.identity?.principalId || '');
      for (let attempt = 0; !principal && attempt < 6; attempt++) {
        await sleep(5000);
        principal = String((await arm('GET', stagingId)).json?.identity?.principalId || '');
      }
      if (principal) log('switched on');
      else remaining.push('Azure did not report the new identity of the staging slot. Run the repair again.');
    }
  }
  if (!GUID.test(principal)) principal = '';

  head('2. integration key file on the staging drive');
  const scmHost = item => (item.json?.properties?.enabledHostNames || []).find(value => String(value).startsWith(APP) && /^[a-z0-9-]+\.scm\.(?:[a-z0-9-]+\.)?azurewebsites\.net$/.test(value));
  const liveScm = scmHost(live), stageScm = scmHost(stage);
  const route = parts => '/api/vfs/' + parts.map(encodeURIComponent).join('/');
  const keyRoute = route(KEY_FILE);
  if (!liveScm || !stageScm || liveScm === stageScm) remaining.push('Azure did not return the two deployment hostnames. The integration key file was not carried across.');
  else {
    const source = await scm(liveScm, keyRoute);
    const key = source.ok ? Buffer.from(await source.arrayBuffer()) : null;
    const current = key ? await scm(stageScm, keyRoute) : null;
    const present = current?.ok ? Buffer.from(await current.arrayBuffer()) : null;
    if (!key || key.length !== 32) remaining.push(`The integration key file of the live drive could not be read (HTTP ${source.status}). The staging drive was not given one.`);
    else if (present?.equals(key)) log('already the same as on the live drive');
    else if (!current.ok && current.status !== 404) remaining.push(`The staging drive could not be read (HTTP ${current.status}). The integration key file was not carried across.`);
    else if (!apply) log(present ? 'DIFFERS from the live drive: would be replaced (the old file is kept beside it)' : 'MISSING: would be copied from the live drive');
    else {
      const put = (path, body, headers) => scm(stageScm, path, {method: 'PUT', headers, body});
      const binary = {'Content-Type': 'application/octet-stream'};
      let problem = '';
      for (let depth = 1; depth < KEY_FILE.length && !problem; depth++) {
        const folder = await put(route(KEY_FILE.slice(0, depth)) + '/', undefined, {'If-None-Match': '*'});
        if (!folder.ok && ![409, 412].includes(folder.status)) problem = `its folder could not be made (HTTP ${folder.status})`;
      }
      if (!problem && present) {
        const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
        const kept = await put(keyRoute + '.replaced-' + stamp, present, {...binary, 'If-None-Match': '*'});
        if (!kept.ok) problem = `the old file could not be kept (HTTP ${kept.status})`;
      }
      if (!problem) {
        const written = await put(keyRoute, key, {...binary, ...(present ? {'If-Match': '*'} : {'If-None-Match': '*'})});
        if (!written.ok) problem = `the file could not be written (HTTP ${written.status})`;
      }
      if (!problem) {
        const check = await scm(stageScm, keyRoute);
        if (!check.ok || !Buffer.from(await check.arrayBuffer()).equals(key)) problem = 'the copy did not read back the same';
      }
      if (problem) remaining.push(`The integration key file was not carried to the staging drive: ${problem}.`);
      else log(present ? 'replaced with the one from the live drive (the old file is kept beside it)' : 'copied from the live drive');
    }
  }

  // Listing app settings is a POST in Azure's API; it changes nothing.
  const liveSettings = await arm('POST', site + '/config/appsettings/list');
  const stageSettings = await arm('POST', stagingId + '/config/appsettings/list');
  if (!liveSettings.ok) throw new RepairStop(failed('The app settings of production could not be read', liveSettings));
  if (!stageSettings.ok) throw new RepairStop(failed('The app settings of staging could not be read', stageSettings));
  const production = liveSettings.json?.properties || {}, staging = stageSettings.json?.properties || {};

  // Access comes before the settings, so the database secret can be read as soon as the setting that names it is saved.
  head('3. access for the staging identity');
  async function findResource(type, name) {
    const filter = encodeURIComponent(`resourceType eq '${type}' and name eq '${name}'`);
    const found = await arm('GET', `/subscriptions/${SUBSCRIPTION}/resources?$filter=${filter}`, {api: '2021-04-01'});
    const id = String(found.json?.value?.[0]?.id || '');
    const expected = new RegExp(`^/subscriptions/${SUBSCRIPTION}/resourceGroups/[^/]+/providers/${type.replace('.', '\\.')}/${name}$`, 'i');
    return expected.test(id) ? id : '';
  }
  const grants = [];
  const reference = parseKeyVaultReference(production.DATABASE_URL);
  if (!reference) log('the database address is not a Key Vault reference: nothing to grant for it');
  else {
    const vault = await findResource('Microsoft.KeyVault/vaults', reference.vault);
    if (vault) grants.push({what: 'reading the database secret', role: ROLES.secret, scope: `${vault}/secrets/${reference.secret}`});
    else { ownerNeeded = true; remaining.push('The Key Vault that holds the database secret cannot be seen with this sign-in, so reading it was not granted.'); }
  }
  if (production.MIS_SCAN_BLOB_ENABLED !== 'true') log('scan storage is switched off: nothing to grant for it');
  else {
    const account = String(production.MIS_SCAN_BLOB_ACCOUNT || ''), container = String(production.MIS_SCAN_BLOB_CONTAINER || 'scanned-cards');
    const valid = /^[a-z0-9]{3,24}$/.test(account) && /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(container);
    const storage = valid ? await findResource('Microsoft.Storage/storageAccounts', account) : '';
    if (storage) grants.push({what: 'the scanned-cards storage container', role: ROLES.blobs, scope: `${storage}/blobServices/default/containers/${container}`});
    else { ownerNeeded = true; remaining.push('The scan storage account cannot be seen with this sign-in, so the scanned-cards container was not granted.'); }
  }
  for (const grant of grants) {
    const label = `${grant.role.name} for ${grant.what}`;
    if (!principal) {
      if (apply) remaining.push(`${label}: not granted, the staging slot has no identity yet.`);
      else log(`would be granted: ${label}`);
      continue;
    }
    const filter = encodeURIComponent(`principalId eq '${principal}'`);
    const listed = await arm('GET', `${grant.scope}/providers/Microsoft.Authorization/roleAssignments?$filter=${filter}`, {api: ROLE_API});
    if ((listed.json?.value || []).some(item => lower(item.properties?.roleDefinitionId).endsWith('/' + grant.role.id))) { log(`already granted: ${label}`); continue; }
    if (!apply) { log(`MISSING, would be granted: ${label}`); continue; }
    const created = await arm('PUT', `${grant.scope}/providers/Microsoft.Authorization/roleAssignments/${randomUUID()}`, {
      api: ROLE_API,
      body: {properties: {
        roleDefinitionId: `/subscriptions/${SUBSCRIPTION}/providers/Microsoft.Authorization/roleDefinitions/${grant.role.id}`,
        principalId: principal, principalType: 'ServicePrincipal',
      }},
    });
    if (created.ok || created.code === 'RoleAssignmentExists') log(`granted: ${label}`);
    else if ([401, 403].includes(created.status)) {
      ownerNeeded = true;
      remaining.push(`${label}: this sign-in is not allowed to grant access.`);
      log(`NOT granted, this sign-in is not allowed to: ${label}`);
    } else {
      remaining.push(failed(`${label}: not granted`, created));
      log(`NOT granted: ${label}`);
    }
  }

  head('4. app settings (names only)');
  const add = settingsToAdd(production, staging);
  const names = Object.keys(add).sort();
  let settingsNow = staging;
  log(`production has ${Object.keys(production).length}, staging has ${Object.keys(staging).length}`);
  if (!names.length) log('nothing is missing on staging');
  else {
    log(`${apply ? 'adding' : 'MISSING, would be added'} (${names.length}): ${names.map(safeName).join(', ')}`);
    if (apply) {
      const saved = await arm('PUT', stagingId + '/config/appsettings', {body: {properties: {...staging, ...add}}});
      const now = saved.json?.properties || {};
      if (!saved.ok || names.some(name => !Object.hasOwn(now, name))) remaining.push(failed('The app settings of the staging slot could not be saved', saved));
      else { settingsNow = now; log(`saved: staging now has ${Object.keys(now).length}`); }
    }
  }

  head('5. the database secret, as the staging slot reads it');
  const references = async () => {
    const result = await arm('GET', stagingId + '/config/configreferences/appsettings');
    return result.ok ? (result.json?.value || []).map(item => ({name: safeName(item.name), status: safeName(item.properties?.status || 'no status')})) : null;
  };
  const refresh = () => arm('POST', stagingId + '/config/configreferences/appsettings/refresh', {api: '2022-03-01'});
  if (apply) await refresh();
  let read = await references();
  // A new grant takes a minute or two to reach Key Vault. Azure reads the secret again when asked to, and whenever the
  // settings are saved; saving the same settings once more is the fallback when asking is not enough.
  for (let attempt = 0; apply && !remaining.length && attempt < 12 && (!read || read.some(notResolved)); attempt++) {
    await sleep(20000);
    if (attempt % 4 === 3) await arm('PUT', stagingId + '/config/appsettings', {body: {properties: settingsNow}});
    else await refresh();
    read = await references();
  }
  if (!read) log('could not be read');
  else if (!read.length) log('staging has no Key Vault reference');
  else for (const item of read) log(`${item.name}: ${item.status}`);
  if (apply && reference && (!read || !read.length || read.some(notResolved))) remaining.push('The staging slot cannot read the database secret yet.');

  head('6. start-up check of the staging app');
  const hostName = String(stage.json.properties.defaultHostName || '');
  if (!apply) log('not run: nothing was changed');
  else if (remaining.length) log('not run: the repair is not complete');
  else if (!/^[a-z0-9.-]+\.azurewebsites\.net$/.test(hostName)) remaining.push('Azure did not return the address of the staging app, so its start-up was not checked.');
  else {
    const started = await arm('POST', stagingId + (wasRunning ? '/restart' : '/start'));
    if (!started.ok) remaining.push(failed('The staging app could not be started', started));
    else {
      let last = 'no answer', healthy = false, restarts = 0;
      for (let attempt = 0; attempt < 54 && !healthy; attempt++) {
        await sleep(10000);
        let code = 0, health = null;
        try {
          const response = await fetchImpl('https://' + hostName + '/api/health', {signal: AbortSignal.timeout(15000)});
          code = response.status;
          health = response.ok ? await response.json() : null;
        } catch { health = null; }
        const up = health?.status === 'ok' && health?.database === 'connected';
        const scanReady = !health?.hotScanStorage?.enabled || health.hotScanStorage.ready === true;
        last = !health ? `HTTP ${code || 'none'}` : `status ${safeName(health.status)}, database ${safeName(health.database)}, timed jobs ${health.scheduledJobsEnabled === false ? 'off' : 'ON'}, scan storage ${scanReady ? 'ready' : 'not ready'}, commit ${safeName(health.commit).slice(0, 7)}`;
        healthy = up && health.scheduledJobsEnabled === false && scanReady;
        // The app checks scan storage once, when it starts. A grant made a minute ago may not have reached it yet.
        if (up && !scanReady && restarts < 3 && attempt % 12 === 11) { restarts++; await arm('POST', stagingId + '/restart'); }
      }
      log(last);
      if (!healthy) {
        remaining.push('The staging app did not answer healthy: ' + last + '.');
        await startupLog();
      }
    }
    if (!wasRunning) {
      const stopped = await arm('POST', stagingId + '/stop');
      log(stopped.ok ? 'staging app stopped again, as it was found' : failed('The staging app could not be stopped again', stopped));
    }
  }

  // The newest start-up log lines of the staging app, masked, so a start-up that still fails explains itself here.
  async function startupLog() {
    try {
      const listing = await scm(stageScm, '/api/vfs/LogFiles/');
      if (!listing.ok) { log(`start-up logs: HTTP ${listing.status}`); return; }
      const files = (await listing.json()).filter(file => /docker\.log$/i.test(file.name)).sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
      const own = files.find(file => /_default_docker\.log$/i.test(file.name)), platform = files.find(file => !/_default_docker\.log$/i.test(file.name));
      for (const [what, file] of [['the platform, starting the container', platform], ['the app itself', own]]) {
        if (!file) { log(`${what}: no log file`); continue; }
        if (file.size > 8 * 1024 * 1024) { log(`${what}: larger than 8 MB, not read`); continue; }
        const response = await scm(stageScm, '/api/vfs/LogFiles/' + encodeURIComponent(file.name));
        if (!response.ok) { log(`${what}: HTTP ${response.status}`); continue; }
        log(`${what}, last lines:`);
        for (const line of (await response.text()).split(/\r?\n/).filter(text => text.trim()).slice(-20)) log('  ' + maskLine(line));
      }
    } catch { log('start-up logs could not be read'); }
  }

  log('\n=====================');
  if (!apply) {
    log('Nothing was changed. Run again with --apply to repair the staging slot.');
    for (const item of remaining) log('  could not be checked: ' + item);
  } else if (!remaining.length) log('STAGING SLOT REPAIRED. The next release can use it.');
  else {
    log('NOT FINISHED. Still needed:');
    for (const item of remaining) log('  - ' + item);
  }
  if (ownerNeeded) log(OWNER_HELP);
  return {apply, repaired: apply && !remaining.length, remaining, ownerNeeded};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes('--apply');
  try {
    const token = execFileSync('az', ['account', 'get-access-token', '--resource', ARM + '/', '--query', 'accessToken', '-o', 'tsv'],
      {encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe']}).trim();
    const result = await repairStagingSlot({apply, token, slot: process.env.MIS_STAGING_SLOT || 'staging'});
    if (apply && !result.repaired) process.exitCode = 1;
  } catch (error) {
    console.log('The repair stopped: ' + (error instanceof RepairStop ? error.message : maskLine(error?.message || 'unexpected error', 160)));
    process.exitCode = 1;
  }
}
