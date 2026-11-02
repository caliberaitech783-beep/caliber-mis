import test from 'node:test';
import assert from 'node:assert/strict';
import {assertTestDatabaseUrl,prepareTestPlatformDatabase,PRODUCTION_DATABASE_HOST,TABLES_TO_EMPTY} from '../scripts/prepare-test-platform-database.mjs';
import {verifyPassword} from '../password-auth.mjs';

const testUrl='postgresql://caliber_test_admin:secret@caliber-mis-test-pg-783.postgres.database.azure.com:5432/caliber_mis';

function fakeClient({missing=[],userRows=1}={}){
  const queries=[];
  return {
    queries,
    async query(sql,params=[]){
      queries.push({sql:String(sql).replace(/\s+/g,' ').trim(),params});
      if(/^SELECT to_regclass/.test(sql))return {rows:[{table:missing.includes(params[0])?null:params[0]}],rowCount:1};
      if(/^UPDATE master_records/.test(sql))return {rows:[],rowCount:userRows};
      if(/^DELETE FROM app_settings/.test(sql))return {rows:[],rowCount:1};
      if(/^UPDATE app_settings/.test(sql))return {rows:[],rowCount:1};
      return {rows:[],rowCount:0};
    },
  };
}

test('the preparation refuses the live database server and any database other than caliber_mis',()=>{
  assert.throws(()=>assertTestDatabaseUrl(`postgresql://admin:secret@${PRODUCTION_DATABASE_HOST}:5432/caliber_mis`),/Refusing to run against the live database server/);
  assert.throws(()=>assertTestDatabaseUrl(`postgresql://admin:secret@${PRODUCTION_DATABASE_HOST.toUpperCase()}:5432/caliber_mis`),/live database server/);
  assert.throws(()=>assertTestDatabaseUrl('postgresql://admin:secret@caliber-mis-test-pg-783.postgres.database.azure.com:5432/caliber_mis_test'),/named caliber_mis/);
  assert.throws(()=>assertTestDatabaseUrl('https://caliber-mis-test-pg-783.postgres.database.azure.com/caliber_mis'),/postgres:\/\//);
  assert.throws(()=>assertTestDatabaseUrl(''),/required/);
  assert.equal(assertTestDatabaseUrl(testUrl).hostname,'caliber-mis-test-pg-783.postgres.database.azure.com');
});

test('a restored copy loses every stored credential, queued message and live session inside one transaction',async()=>{
  const client=fakeClient();
  const result=await prepareTestPlatformDatabase({client});
  const statements=client.queries.map(query=>query.sql);
  assert.equal(statements[0],'BEGIN');
  assert.equal(statements.at(-1),'COMMIT');
  for(const [table] of TABLES_TO_EMPTY)assert.ok(statements.includes(`TRUNCATE TABLE "${table}"`),table);
  assert.deepEqual(result.emptied,TABLES_TO_EMPTY.map(([table])=>table));
  assert.deepEqual(result.missing,[]);
  const settingQueries=client.queries.filter(query=>/app_settings/.test(query.sql));
  assert.deepEqual(settingQueries.map(query=>query.params),[['meta_whatsapp'],['whatsapp_report_settings']]);
  assert.match(settingQueries[0].sql,/^DELETE FROM app_settings WHERE setting_key = \$1$/);
  assert.match(settingQueries[1].sql,/^UPDATE app_settings SET setting_value = setting_value \|\| '\{"enabled":false\}'::jsonb/);
  assert.ok(!statements.some(sql=>/master_records/.test(sql)),'no password is changed unless a login is named');
  assert.equal(result.passwordSet,false);
  for(const table of ['mis_integration_secrets','mis_telegram_outbox','mis_telegram_links','auth_sessions','mis_sso_sessions'])assert.ok(TABLES_TO_EMPTY.some(([name])=>name===table),table);
});

test('tables that this copy does not have are skipped instead of failing the preparation',async()=>{
  const client=fakeClient({missing:['remote_assistance_sessions']});
  const result=await prepareTestPlatformDatabase({client});
  assert.deepEqual(result.missing,['remote_assistance_sessions']);
  assert.ok(!client.queries.some(query=>query.sql==='TRUNCATE TABLE "remote_assistance_sessions"'));
  assert.equal(client.queries.at(-1).sql,'COMMIT');
});

test('a named account receives a scrypt test password that the login route can verify',async()=>{
  const client=fakeClient();
  const result=await prepareTestPlatformDatabase({client,login:'Mohit',password:'TestPlatform-2026'});
  assert.equal(result.passwordSet,true);
  const update=client.queries.find(query=>/^UPDATE master_records/.test(query.sql));
  assert.match(update.sql,/master_name = 'Users & employees' AND lower\(record_data->>'login'\) = lower\(\$2\)/);
  assert.equal(update.params[1],'Mohit');
  assert.ok(verifyPassword('TestPlatform-2026',update.params[0]));
  assert.ok(!verifyPassword('wrong',update.params[0]));
});

test('a short password or an unknown login rolls the whole preparation back',async()=>{
  await assert.rejects(prepareTestPlatformDatabase({client:fakeClient(),login:'Mohit',password:'short'}),/at least 8 characters/);
  const client=fakeClient({userRows:0});
  await assert.rejects(prepareTestPlatformDatabase({client,login:'nobody',password:'TestPlatform-2026'}),/exactly one Users & employees record/);
  assert.equal(client.queries.at(-1).sql,'ROLLBACK');
  assert.ok(!client.queries.some(query=>query.sql==='COMMIT'));
});
