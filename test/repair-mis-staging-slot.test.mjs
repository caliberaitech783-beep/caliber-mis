import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  APP, GROUP, KEY_FILE, ROLES, STAGING_ALWAYS, SUBSCRIPTION, maskLine, parseKeyVaultReference, repairStagingSlot, settingsToAdd,
} from '../scripts/repair-mis-staging-slot.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const SITE = `/subscriptions/${SUBSCRIPTION}/resourceGroups/${GROUP}/providers/Microsoft.Web/sites/${APP}`;
const STAGING = SITE + '/slots/staging';
const PLAN = `/subscriptions/${SUBSCRIPTION}/resourceGroups/${GROUP}/providers/Microsoft.Web/serverfarms/the-plan`;
const LIVE_HOST = 'caliber-mis-783-live1.centralindia-01.azurewebsites.net', LIVE_SCM = 'caliber-mis-783-live1.scm.centralindia-01.azurewebsites.net';
const STAGE_HOST = 'caliber-mis-783-staging-new2.centralindia-01.azurewebsites.net', STAGE_SCM = 'caliber-mis-783-staging-new2.scm.centralindia-01.azurewebsites.net';
const VAULT = `/subscriptions/${SUBSCRIPTION}/resourceGroups/vault-group/providers/Microsoft.KeyVault/vaults/marker-vault-77`;
const STORAGE = `/subscriptions/${SUBSCRIPTION}/resourceGroups/store-group/providers/Microsoft.Storage/storageAccounts/markerscanacct9`;
const SECRET_SCOPE = VAULT + '/secrets/marker-db-secret';
const BLOB_SCOPE = STORAGE + '/blobServices/default/containers/marker-cards';
const NEW_PRINCIPAL = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'marker-token-AAAA';
const LIVE_KEY = Buffer.alloc(32, 7), OTHER_KEY = Buffer.alloc(32, 9);
const LIVE_SETTINGS = {
  DATABASE_URL: '@Microsoft.KeyVault(VaultName=marker-vault-77;SecretName=marker-db-secret)',
  GEMINI_API_KEY: 'marker-gemini-key-value',
  META_WHATSAPP_DELIVERY_PAUSED: 'false',
  MIS_SCAN_BLOB_ENABLED: 'true',
  MIS_SCAN_BLOB_ACCOUNT: 'markerscanacct9',
  MIS_SCAN_BLOB_CONTAINER: 'marker-cards',
  PUBLIC_APP_URL: 'https://marker-public.example',
  DISABLE_SCHEDULED_JOBS: 'true',
};
// Nothing in this list may ever be printed.
const MARKERS = [TOKEN, 'marker-gemini-key-value', 'marker-vault-77', 'marker-db-secret', 'markerscanacct9', 'marker-cards', 'marker-public.example',
  NEW_PRINCIPAL, LIVE_KEY.toString('hex'), LIVE_KEY.toString('base64'), 'marker-azure-error-text', LIVE_HOST, STAGE_SCM];

// A stand-in for Azure: the management API, the two deployment sites and the staging app's health address.
function standIn({canGrant = true, seeResources = true, stagingKey = null, stagingSettings = {DISABLE_SCHEDULED_JOBS: 'true'}, scanReadyAfterRestarts = 0} = {}) {
  const calls = [], unexpected = [];
  const state = {identity: null, settings: {...stagingSettings}, key: stagingKey, files: new Map(), assignments: [], running: false, restarts: 0};
  const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  const slotBody = (identity, host, scm, running) => ({identity, properties: {state: running ? 'Running' : 'Stopped', serverFarmId: PLAN, enabledHostNames: [host, scm], defaultHostName: host}});
  const granted = scope => state.assignments.some(item => item.scope === scope);
  async function fetchImpl(url, options = {}) {
    const address = new URL(url), method = options.method || 'GET', path = address.pathname;
    const call = {method, host: address.host, path, search: decodeURIComponent(address.search), headers: options.headers || {}, body: options.body};
    calls.push(call);
    if (address.host === 'management.azure.com') {
      assert.equal(call.headers.Authorization, 'Bearer ' + TOKEN);
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : undefined;
      if (path === SITE && method === 'GET') return json(slotBody({type: 'SystemAssigned', principalId: 'aaaaaaaa-0000-4000-8000-000000000001'}, LIVE_HOST, LIVE_SCM, true));
      if (path === STAGING && method === 'GET') return json(slotBody(state.identity, STAGE_HOST, STAGE_SCM, state.running));
      if (path === STAGING && method === 'PATCH') { state.identity = {type: body.identity.type, principalId: NEW_PRINCIPAL}; return json({identity: state.identity}); }
      if (path === SITE + '/config/appsettings/list' && method === 'POST') return json({properties: LIVE_SETTINGS});
      if (path === STAGING + '/config/appsettings/list' && method === 'POST') return json({properties: state.settings});
      if (path === STAGING + '/config/appsettings' && method === 'PUT') { state.settings = body.properties; return json({properties: state.settings}); }
      if (path === `/subscriptions/${SUBSCRIPTION}/resources` && method === 'GET') {
        if (!seeResources) return json({value: []});
        return json({value: [{id: call.search.includes('Microsoft.KeyVault/vaults') ? VAULT : STORAGE}]});
      }
      const roles = /^(.*)\/providers\/Microsoft\.Authorization\/roleAssignments(?:\/([0-9a-f-]{36}))?$/.exec(path);
      if (roles && method === 'GET') return json({value: state.assignments.filter(item => item.scope === roles[1]).map(item => ({properties: item}))});
      if (roles && roles[2] && method === 'PUT') {
        if (!canGrant) return json({error: {code: 'AuthorizationFailed', message: 'marker-azure-error-text for ' + NEW_PRINCIPAL}}, 403);
        state.assignments.push({scope: roles[1], ...body.properties});
        return json({properties: body.properties}, 201);
      }
      if (path === STAGING + '/config/configreferences/appsettings/refresh' && method === 'POST') return json({});
      if (path === STAGING + '/config/configreferences/appsettings' && method === 'GET') {
        const names = Object.keys(state.settings).filter(name => /^@Microsoft\.KeyVault\(/.test(state.settings[name]));
        return json({value: names.map(name => ({name, properties: {status: state.identity && granted(SECRET_SCOPE) ? 'Resolved' : 'AccessToKeyVaultDenied'}}))});
      }
      if (path === STAGING + '/start' && method === 'POST') { state.running = true; return json({}); }
      if (path === STAGING + '/restart' && method === 'POST') { state.running = true; state.restarts++; return json({}); }
      if (path === STAGING + '/stop' && method === 'POST') { state.running = false; return json({}); }
    }
    const keyPath = '/api/vfs/' + KEY_FILE.join('/');
    if (address.host === LIVE_SCM && method === 'GET' && path === keyPath) return new Response(LIVE_KEY);
    if (address.host === STAGE_SCM) {
      assert.equal(call.headers.Authorization, 'Bearer ' + TOKEN);
      if (method === 'GET' && path === keyPath) return state.key ? new Response(state.key) : new Response('', {status: 404});
      if (method === 'PUT' && path.endsWith('/')) return new Response('', {status: 201});
      if (method === 'PUT' && path === keyPath) {
        if (state.key && call.headers['If-Match'] !== '*') return new Response('', {status: 412});
        state.key = Buffer.from(options.body);
        return new Response('', {status: 201});
      }
      if (method === 'PUT' && path.startsWith(keyPath + '.replaced-')) { state.files.set(path, Buffer.from(options.body)); return new Response('', {status: 201}); }
      if (method === 'GET' && path === '/api/vfs/LogFiles/') return json([]);
    }
    if (address.host === STAGE_HOST && path === '/api/health') {
      if (!state.running) return new Response('', {status: 403});
      const usable = state.identity && granted(SECRET_SCOPE) && state.key?.equals(LIVE_KEY) && state.settings.DATABASE_URL;
      if (!usable) return new Response('', {status: 503});
      return json({status: 'ok', database: 'connected', scheduledJobsEnabled: state.settings.DISABLE_SCHEDULED_JOBS !== 'true',
        hotScanStorage: {enabled: true, ready: granted(BLOB_SCOPE) && state.restarts >= scanReadyAfterRestarts}, commit: '1187e91aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'});
    }
    unexpected.push(`${method} ${address.host}${path}`);
    return new Response('', {status: 404});
  }
  return {fetchImpl, calls, state, unexpected};
}

async function run(azure, apply) {
  const lines = [];
  const result = await repairStagingSlot({apply, token: TOKEN, fetchImpl: azure.fetchImpl, log: line => lines.push(String(line)), sleep: async () => {}});
  const printed = lines.join('\n');
  for (const marker of MARKERS) assert.ok(!printed.includes(marker), 'printed: ' + marker);
  assert.deepEqual(azure.unexpected, []);
  return {result, printed};
}
// Everything that is not a read. Listing app settings is a POST in Azure's API, and it changes nothing.
const writes = azure => azure.calls.filter(call => call.method !== 'GET' && !(call.method === 'POST' && call.path.endsWith('/config/appsettings/list')));

test('a Key Vault reference is read in both of its forms, and anything else is not one', () => {
  assert.deepEqual(parseKeyVaultReference('@Microsoft.KeyVault(VaultName=Coalmine-KV-1;SecretName=database-url-production)'), {vault: 'coalmine-kv-1', secret: 'database-url-production'});
  assert.deepEqual(parseKeyVaultReference('@Microsoft.KeyVault(SecretUri=https://my-vault.vault.azure.net/secrets/db-url/0123abcd)'), {vault: 'my-vault', secret: 'db-url'});
  assert.deepEqual(parseKeyVaultReference(' @Microsoft.KeyVault(SecretUri=https://my-vault.vault.azure.net/secrets/db-url/) '), {vault: 'my-vault', secret: 'db-url'});
  for (const value of ['postgres://user:pass@host/db', '', null, '@Microsoft.KeyVault(VaultName=x)', '@Microsoft.KeyVault(SecretUri=https://evil.example/secrets/a)']) {
    assert.equal(parseKeyVaultReference(value), null);
  }
});

test('only the settings staging lacks are added, with production\'s values, and staging never delivers or runs timed jobs', () => {
  const add = settingsToAdd({A: 'live-a', B: 'live-b', META_WHATSAPP_DELIVERY_PAUSED: 'false', DISABLE_SCHEDULED_JOBS: 'false'}, {B: 'stage-b'});
  assert.deepEqual(add, {A: 'live-a', META_WHATSAPP_DELIVERY_PAUSED: 'true', DISABLE_SCHEDULED_JOBS: 'true'});
  assert.deepEqual(settingsToAdd({A: '1'}, {A: '2'}), {});
  assert.deepEqual(settingsToAdd(null, undefined), {});
  assert.deepEqual(STAGING_ALWAYS, {DISABLE_SCHEDULED_JOBS: 'true', META_WHATSAPP_DELIVERY_PAUSED: 'true'});
});

test('without --apply it only lists what is missing: nothing is written anywhere', async () => {
  const azure = standIn();
  const {result, printed} = await run(azure, false);
  assert.deepEqual(writes(azure), []);
  assert.equal(result.repaired, false);
  assert.match(printed, /list only, nothing is changed/);
  assert.match(printed, /1\. identity of the staging slot\nMISSING: would be switched on/);
  assert.match(printed, /2\. integration key file on the staging drive\nMISSING: would be copied from the live drive/);
  assert.match(printed, /production has 8, staging has 1\nMISSING, would be added \(7\): DATABASE_URL, GEMINI_API_KEY, META_WHATSAPP_DELIVERY_PAUSED, MIS_SCAN_BLOB_ACCOUNT, MIS_SCAN_BLOB_CONTAINER, MIS_SCAN_BLOB_ENABLED, PUBLIC_APP_URL/);
  assert.match(printed, /would be granted: Key Vault Secrets User for reading the database secret/);
  assert.match(printed, /would be granted: Storage Blob Data Contributor for the scanned-cards storage container/);
  assert.match(printed, /Nothing was changed\. Run again with --apply/);
  assert.equal(azure.state.identity, null);
  assert.equal(azure.state.key, null);
});

test('with --apply and an owner sign-in the staging slot is repaired, and production is only read', async () => {
  const azure = standIn();
  const {result, printed} = await run(azure, true);
  assert.equal(result.repaired, true, printed);
  assert.deepEqual(result.remaining, []);
  assert.match(printed, /STAGING SLOT REPAIRED/);
  // Identity, key file, settings.
  assert.deepEqual(azure.state.identity, {type: 'SystemAssigned', principalId: NEW_PRINCIPAL});
  assert.ok(azure.state.key.equals(LIVE_KEY));
  assert.deepEqual(azure.state.settings, {...LIVE_SETTINGS, META_WHATSAPP_DELIVERY_PAUSED: 'true'});
  // The two grants: the right role, on the right thing, for the new staging identity only.
  const role = id => `/subscriptions/${SUBSCRIPTION}/providers/Microsoft.Authorization/roleDefinitions/${id}`;
  assert.deepEqual(azure.state.assignments, [
    {scope: SECRET_SCOPE, roleDefinitionId: role(ROLES.secret.id), principalId: NEW_PRINCIPAL, principalType: 'ServicePrincipal'},
    {scope: BLOB_SCOPE, roleDefinitionId: role(ROLES.blobs.id), principalId: NEW_PRINCIPAL, principalType: 'ServicePrincipal'},
  ]);
  assert.match(printed, /DATABASE_URL: Resolved/);
  assert.match(printed, /status ok, database connected, timed jobs off, scan storage ready, commit 1187e91\nstaging app stopped again, as it was found/);
  assert.equal(azure.state.running, false);
  // Every write lands on the staging slot, its drive, or a grant for its identity. Production is never written.
  for (const call of writes(azure)) {
    const onStaging = call.host === 'management.azure.com' ? call.path.startsWith(STAGING) || call.path.includes('/providers/Microsoft.Authorization/roleAssignments/') : call.host === STAGE_SCM;
    assert.ok(onStaging, `${call.method} ${call.host}${call.path}`);
  }
  assert.deepEqual(azure.calls.filter(call => call.host === LIVE_SCM).map(call => call.method), ['GET']);
  // The new key file is created, never forced over an existing one.
  const keyWrite = azure.calls.find(call => call.host === STAGE_SCM && call.method === 'PUT' && call.path.endsWith('/integration.key'));
  assert.equal(keyWrite.headers['If-None-Match'], '*');
  assert.equal(keyWrite.headers['If-Match'], undefined);
});

test('a second run finds nothing left to do and writes nothing but the start-up check', async () => {
  const azure = standIn();
  await run(azure, true);
  azure.calls.length = 0;
  const {result, printed} = await run(azure, true);
  assert.equal(result.repaired, true);
  assert.match(printed, /already switched on/);
  assert.match(printed, /already the same as on the live drive/);
  assert.match(printed, /nothing is missing on staging/);
  assert.match(printed, /already granted: Key Vault Secrets User/);
  assert.match(printed, /already granted: Storage Blob Data Contributor/);
  assert.deepEqual(writes(azure).map(call => call.path.replace(STAGING, '')), ['/config/configreferences/appsettings/refresh', '/start', '/stop']);
});

test('a sign-in that may not grant access still does the rest, says what remains, and does not start the app', async () => {
  const azure = standIn({canGrant: false});
  const {result, printed} = await run(azure, true);
  assert.equal(result.repaired, false);
  assert.equal(result.ownerNeeded, true);
  assert.deepEqual(azure.state.identity, {type: 'SystemAssigned', principalId: NEW_PRINCIPAL});
  assert.ok(azure.state.key.equals(LIVE_KEY));
  assert.equal(azure.state.settings.GEMINI_API_KEY, LIVE_SETTINGS.GEMINI_API_KEY);
  assert.deepEqual(azure.state.assignments, []);
  assert.match(printed, /NOT FINISHED\. Still needed:/);
  assert.match(printed, /Key Vault Secrets User for reading the database secret: this sign-in is not allowed to grant access\./);
  assert.match(printed, /Storage Blob Data Contributor for the scanned-cards storage container: this sign-in is not allowed to grant access\./);
  assert.match(printed, /6\. start-up check of the staging app\nnot run: the repair is not complete/);
  assert.match(printed, /An Azure owner can finish it\./);
  assert.ok(!azure.calls.some(call => /\/(start|restart|stop)$/.test(call.path)));
});

test('a sign-in that cannot see the vault or the storage account says so and grants nothing', async () => {
  const azure = standIn({seeResources: false});
  const {result, printed} = await run(azure, true);
  assert.equal(result.repaired, false);
  assert.equal(result.ownerNeeded, true);
  assert.match(printed, /The Key Vault that holds the database secret cannot be seen with this sign-in/);
  assert.match(printed, /The scan storage account cannot be seen with this sign-in/);
  assert.ok(!azure.calls.some(call => call.method === 'PUT' && call.path.includes('roleAssignments')));
});

test('a different key file on the staging drive is kept beside the one copied from the live drive', async () => {
  const azure = standIn({stagingKey: OTHER_KEY});
  const {result, printed} = await run(azure, true);
  assert.equal(result.repaired, true, printed);
  assert.ok(azure.state.key.equals(LIVE_KEY));
  assert.equal(azure.state.files.size, 1);
  const [[path, bytes]] = [...azure.state.files];
  assert.match(path, /\/integration\.key\.replaced-\d{14}$/);
  assert.ok(bytes.equals(OTHER_KEY));
  const keyWrite = azure.calls.find(call => call.host === STAGE_SCM && call.method === 'PUT' && call.path.endsWith('/integration.key'));
  assert.equal(keyWrite.headers['If-Match'], '*');
  assert.match(printed, /replaced with the one from the live drive \(the old file is kept beside it\)/);
});

test('scan storage that is not ready at the first start is given a restart, not reported as a failure', async () => {
  const azure = standIn({scanReadyAfterRestarts: 1});
  const {result, printed} = await run(azure, true);
  assert.equal(result.repaired, true, printed);
  assert.equal(azure.state.restarts, 1);
  assert.equal(azure.state.running, false);
});

test('a staging slot that already runs is restarted for the check and left running', async () => {
  const azure = standIn();
  azure.state.running = true;
  const {result} = await run(azure, true);
  assert.equal(result.repaired, true);
  assert.equal(azure.state.running, true);
  assert.ok(!azure.calls.some(call => call.path.endsWith('/stop')));
});

test('a log line is masked before it is shown', () => {
  const line = maskLine('connect postgres://mis:hunter2@db.internal:5432/mis failed token=abc123 from 10.1.2.3 to store.blob.core.windows.net key AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  for (const secret of ['hunter2', 'abc123', '10.1.2.3', 'store.blob.core.windows.net', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']) assert.ok(!line.includes(secret), secret);
});

test('the repair never runs by itself, waits for a release, and only repairs when ticked', () => {
  const workflow = read('.github/workflows/repair-mis-staging-slot.yml');
  assert.match(workflow, /^on:\n  workflow_dispatch:\n    inputs:\n      apply:\n(?:        .*\n)*?        default: false\n/m);
  assert.doesNotMatch(workflow, /^\s+(push|schedule|pull_request):/m);
  assert.match(workflow, /concurrency:\n  group: caliber-mis-783-release\n  cancel-in-progress: false\n/);
  assert.match(workflow, /if \[ "\$REPAIR_APPLY" = "true" \]; then node scripts\/repair-mis-staging-slot\.mjs --apply; else node scripts\/repair-mis-staging-slot\.mjs; fi/);
  assert.match(workflow, /REPAIR_APPLY: \$\{\{ inputs\.apply \}\}/);
});

test('recovering a stalled app no longer deletes the staging slot, and editing that workflow no longer runs it', () => {
  const workflow = read('.github/workflows/recover-stalled-mis.yml');
  assert.doesNotMatch(workflow, /slot delete|slot create/);
  assert.match(workflow, /^on:\n  workflow_dispatch:\npermissions:/m);
  assert.doesNotMatch(workflow, /^\s+push:/m);
});
