import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {compareSettings, maskLine, safeName, settingKind, tailLines} from '../scripts/slot-configuration-compare.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a setting is described by name and kind, and its value never leaves the comparison', () => {
  const production = [
    {name: 'DATABASE_URL', value: 'postgres://mis:live-secret-1@db.example/mis', slotSetting: false},
    {name: 'GEMINI_KEY', value: '@Microsoft.KeyVault(SecretUri=https://vault.example/secrets/gemini)', slotSetting: false},
    {name: 'HOT_SCAN_PATH', value: '/mounts/hot', slotSetting: true},
    {name: 'SAME', value: 'one', slotSetting: false},
    {name: 'DISABLE_SCHEDULED_JOBS', value: '', slotSetting: false},
  ];
  const staging = [
    {name: 'DATABASE_URL', value: 'postgres://mis:stage-secret-2@db.example/mis', slotSetting: false},
    {name: 'GEMINI_KEY', value: 'plain-copy-of-the-key', slotSetting: false},
    {name: 'SAME', value: 'one', slotSetting: false},
    {name: 'DISABLE_SCHEDULED_JOBS', value: 'true', slotSetting: false},
    {name: 'ONLY_HERE', value: 'x', slotSetting: false},
  ];
  const result = compareSettings(production, staging);
  assert.equal(result.production, 5);
  assert.equal(result.staging, 5);
  assert.deepEqual(result.onlyProduction, [{name: 'HOT_SCAN_PATH', kind: 'plain', slotSetting: true}]);
  assert.deepEqual(result.onlyStaging, [{name: 'ONLY_HERE', kind: 'plain', slotSetting: false}]);
  assert.deepEqual(result.different, [
    {name: 'DATABASE_URL', production: 'plain', staging: 'plain'},
    {name: 'DISABLE_SCHEDULED_JOBS', production: 'empty', staging: 'plain'},
    {name: 'GEMINI_KEY', production: 'key vault reference', staging: 'plain'},
  ]);
  assert.deepEqual(result.keyVaultReferences, {production: 1, staging: 0});
  const printed = JSON.stringify(result);
  for (const secret of ['live-secret-1', 'stage-secret-2', 'vault.example', 'plain-copy-of-the-key', '/mounts/hot']) assert.ok(!printed.includes(secret), secret);
});

test('a missing list and an object value are handled without printing the value', () => {
  assert.deepEqual(compareSettings(null, undefined), {production: 0, staging: 0, onlyProduction: [], onlyStaging: [], different: [], keyVaultReferences: {production: 0, staging: 0}});
  const result = compareSettings([{name: 'main db', value: {value: 'Server=live;Password=p1', type: 'PostgreSQL'}}], [{name: 'main db', value: {value: 'Server=stage;Password=p2', type: 'PostgreSQL'}}]);
  assert.deepEqual(result.different, [{name: 'main?db', production: 'plain', staging: 'plain'}]);
  assert.equal(settingKind(null), 'empty');
  assert.equal(safeName('A B/C<script>'), 'A?B?C?script?');
});

test('a log line is masked before it is printed', () => {
  const line = maskLine('connect to postgres://mis_user:Sup3rSecret@caliber-db.postgres.database.azure.com:5432/mis failed from 10.0.4.17, password=abc123 token: "xyz 987" key AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 mail ops@example.com');
  for (const secret of ['Sup3rSecret', 'mis_user', 'caliber-db', '10.0.4.17', 'abc123', 'xyz 987', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'ops@example.com']) assert.ok(!line.includes(secret), secret + ' in ' + line);
  assert.match(line, /<hidden>@/);
  assert.match(line, /failed from <ip>/);
  assert.equal(maskLine('a\nb\tc'), 'a b c');
  assert.equal(maskLine('x'.repeat(20) + ' ' + 'y'.repeat(20), 25).length, 25);
  assert.equal(maskLine('Error: database "mis" does not accept connections'), 'Error: database "mis" does not accept connections');
});

test('only the last lines of a log are kept, each masked', () => {
  const text = Array.from({length: 60}, (_, index) => 'line ' + (index + 1)).join('\n') + '\n\nBearer abc.def.ghi\n';
  const lines = tailLines(text, 3);
  assert.deepEqual(lines, ['line 59', 'line 60', 'Bearer <hidden>']);
});

test('the probe only reads, and never prints a value', () => {
  const source = read('scripts/probe-slot-configuration.mjs');
  // Every az call is a read: no word that changes a slot appears as an argument.
  assert.doesNotMatch(source, /'(set|delete|restart|start|stop|create|swap|assign|add|remove|update|exec|deploy|config-zip)'/);
  // Requests to a slot and to Azure are plain GETs.
  assert.doesNotMatch(source, /method\s*:/);
  // A value is only ever handed to the comparison or masked; no line prints one directly.
  for (const line of source.split('\n').filter(text => /console\.log/.test(text))) assert.doesNotMatch(line, /\.value(?!\?\.(type|mountPath|state)\b)/, line);
  assert.match(source, /compareSettings\(list\.production, list\.staging\)/);
  assert.match(source, /catch \{ throw Error\('Azure did not answer with JSON\.'\); \}/);
});

test('the diagnosis workflow runs the comparison by hand or on a change to itself, never on a schedule', () => {
  const workflow = read('.github/workflows/diagnose-mis-deployment.yml');
  assert.match(workflow, /- name: Compare the staging slot with production\n\s+if: always\(\) && inputs\.target != 'scan-engine'\n\s+env:\n\s+MIS_STAGING_SLOT: \$\{\{ vars\.MIS_STAGING_SLOT \|\| 'staging' \}\}\n\s+run: node scripts\/probe-slot-configuration\.mjs/);
  assert.doesNotMatch(workflow, /schedule:/);
});
