import test from 'node:test';
import assert from 'node:assert/strict';
import {misDatabaseConfig} from '../mis-database-config.mjs';

test('MIS refuses missing or shared Pulse database configuration', () => {
  for (const DATABASE_URL of ['', 'postgresql://u:p@server.postgres.database.azure.com/postgres', 'postgresql://u:p@server.postgres.database.azure.com/tender_tracker']) {
    assert.throws(() => misDatabaseConfig({DATABASE_URL}));
  }
});
test('Azure MIS validates TLS even if URL attempts to disable verification', () => {
  const config = misDatabaseConfig({DATABASE_URL: 'postgresql://u:p@server.postgres.database.azure.com/caliber_mis?sslmode=no-verify'});
  assert.deepEqual(config.ssl, {rejectUnauthorized:true});
  assert.equal(new URL(config.connectionString).searchParams.has('sslmode'), false);
});
test('local development still uses the dedicated database', () => {
  assert.equal(misDatabaseConfig({DATABASE_URL:'postgresql://u:p@127.0.0.1/caliber_mis'}).ssl, false);
  assert.throws(() => misDatabaseConfig({DATABASE_URL:'postgresql://u:p@other.example/caliber_mis'}));
});
