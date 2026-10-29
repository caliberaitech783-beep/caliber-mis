import {CONTENT_DELETION_POLICY} from '../content-deletion-policy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const slice = server.slice(server.indexOf("const LOG_RETENTION_SETTING_KEY="), server.indexOf("app.get('/api/log-retention'"));

// Run the real settings reader and daily job against a recording fake database.
function harness(stored, {lastRunDate = ''} = {}) {
  const statements = [];
  const pool = {
    async query(sql, values = []) {
      if (sql.startsWith('SELECT setting_value')) return {rows: [{setting_value: stored, updated_at: null}]};
      if (sql.startsWith('SELECT value,updated_at FROM app_metadata')) return {rows: lastRunDate ? [{value: lastRunDate, updated_at: null}] : []};
      statements.push({sql: sql.replace(/\s+/g, ' ').trim(), values});
      return {rowCount: 3, rows: []};
    },
  };
  const api = new Function('pool', 'AUDIT_PURGE_MAX_DAYS', 'auditIndiaDateKey', 'CONTENT_DELETION_POLICY',
    `${slice};return {storedLogRetention,runLogRetention,LOG_RETENTION_KEYS};`)(pool, 3650, () => '2026-09-22', CONTENT_DELETION_POLICY);
  return {...api, statements};
}

const now = new Date('2026-09-22T06:30:00Z');
const daysBefore = (days) => new Date(now.getTime() - days * 86400000).toISOString();

test('automatic retention stays blocked for every saved setting and leaves all records untouched',async()=>{
 for(const stored of [{auditDays:5,activityDays:0},{auditDays:0},{auditDays:5,activityDays:30,whatsappDays:90,notificationDays:60,mediaDays:365}]){
  const {runLogRetention,statements}=harness(stored);const result=await runLogRetention(now);
  assert.equal(result.skipped,true);assert.match(result.reason,/approval and WhatsApp OTP/);assert.equal(statements.length,0);
 }
});

test('stored values outside 0 to 3650 fall back to the safe default', async () => {
  const {storedLogRetention} = harness({auditDays: 5, whatsappDays: -4, notificationDays: 'lots', mediaDays: 99999});
  const retention = await storedLogRetention();
  assert.equal(retention.whatsappDays, 0);
  assert.equal(retention.notificationDays, 0);
  assert.equal(retention.mediaDays, 0, 'an unreadable media setting must never switch media removal on');
});

test("the owner's 22-09-2026 numbers are applied once and keep every other part", async () => {
  const writes = [];
  let marker = false;
  const stored = {auditDays: 5, activityDays: 30, whatsappDays: 0, notificationDays: 0, mediaDays: 0};
  const pool = {
    async query(sql, values = []) {
      if (sql.startsWith('SELECT key FROM app_metadata')) return {rows: marker ? [{key: values[0]}] : []};
      if (sql.startsWith('SELECT setting_value')) return {rows: [{setting_value: stored, updated_at: null}]};
      if (sql.startsWith('SELECT value,updated_at FROM app_metadata')) return {rows: []};
      writes.push({sql: sql.replace(/\s+/g, ' ').trim(), values});
      if (sql.includes('INSERT INTO app_metadata')) marker = true;
      return {rowCount: 1, rows: []};
    },
  };
  const {applyOwnerLogRetention} = new Function('pool', 'AUDIT_PURGE_MAX_DAYS', 'auditIndiaDateKey',
    `${slice};return {applyOwnerLogRetention};`)(pool, 3650, () => '2026-09-22', CONTENT_DELETION_POLICY);

  const result = await applyOwnerLogRetention();
  assert.deepEqual(result.next, {auditDays: 2, activityDays: 30, whatsappDays: 10, notificationDays: 10, mediaDays: 0});
  const saved = JSON.parse(writes.find(({sql}) => sql.startsWith('INSERT INTO app_settings')).values[1]);
  assert.equal(saved.auditDays, 2);
  assert.equal(saved.whatsappDays, 10);
  assert.equal(saved.notificationDays, 10);
  assert.equal(saved.activityDays, 30, 'user activity keeps its saved value');
  assert.equal(saved.mediaDays, 0, 'photos and audio stay off');
  assert.ok(writes.some(({sql}) => sql.startsWith("DELETE FROM app_metadata WHERE key='log_retention_last_run'")), 'applies today');

  const count = writes.length;
  assert.deepEqual(await applyOwnerLogRetention(), {skipped: true});
  assert.equal(writes.length, count, 'a later restart never overwrites a change made in the dialog');
});
