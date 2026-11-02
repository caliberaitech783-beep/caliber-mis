#!/usr/bin/env node
// Prepares a restored copy of the Pulse-II database for the TEST platform.
//
// A backup of the live database carries the stored notification credentials,
// queued messages and sign-in sessions of the live site. Run this once after
// scripts/restore-database.mjs, before the test app is restarted, so the test
// copy can never message operators or accept live tokens. It refuses to run
// against the live database server. Optionally it gives one account a known
// password, because synced users carry random MIS passwords and the test
// platform signs in without Pulse (MIS_SSO_MODE=off).
//
//   node scripts/prepare-test-platform-database.mjs --database-url <test url> --yes [--login <login>]
//
// With --login, set TEST_LOGIN_PASSWORD in the environment (never on the
// command line). See docs/test-platform-setup.md, section 4.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClient,parseCliArgs,quoteIdentifier,redactDatabaseUrl} from '../database-backup.mjs';
import {hashPassword} from '../password-auth.mjs';

export const PRODUCTION_DATABASE_HOST='coalmine-fleet-pg-783.postgres.database.azure.com';

export function assertTestDatabaseUrl(value){
  let url;
  try{url=new URL(String(value||''));}catch{throw new Error('A PostgreSQL connection URL for the test database is required.');}
  if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('The test database URL must be a postgres:// connection string.');
  if(url.hostname.toLowerCase()===PRODUCTION_DATABASE_HOST)throw new Error(`Refusing to run against the live database server ${PRODUCTION_DATABASE_HOST}.`);
  if(decodeURIComponent(url.pathname.slice(1))!=='caliber_mis')throw new Error('Pulse-II connects only to a database named caliber_mis; create the test database with that name.');
  return url;
}

// Tables emptied in the test copy, each with what it prevents.
export const TABLES_TO_EMPTY=[
  ['mis_integration_secrets','stored MIS Telegram bot and Pulse connection secrets (encrypted with the live server key, unreadable and unwanted here)'],
  ['mis_telegram_links','Telegram chat links of live users; a test bot is linked afresh, never to live chats'],
  ['mis_telegram_pending','pending Telegram link tokens'],
  ['mis_telegram_outbox','queued Telegram messages copied from live, which the test copy must never send'],
  ['auth_sessions','live sign-in sessions'],
  ['mis_sso_sessions','live Pulse single sign-on sessions'],
  ['mis_credential_sessions','live separate-credential sessions'],
  ['password_reset_sessions','live password reset OTP sessions'],
  ['password_change_sessions','live password change sessions'],
  ['remote_assistance_sessions','live remote assistance sessions'],
];

// Settings rows changed in the test copy. The WhatsApp switch stored in Report
// settings overrides META_WHATSAPP_DELIVERY_PAUSED, so it is switched off here.
export const SETTING_STATEMENTS=[
  ['WhatsApp provider credentials saved in Report settings','DELETE FROM app_settings WHERE setting_key = $1',['meta_whatsapp']],
  ['WhatsApp delivery switched off in Report settings',"UPDATE app_settings SET setting_value = setting_value || '{\"enabled\":false}'::jsonb, updated_at = NOW() WHERE setting_key = $1",['whatsapp_report_settings']],
];

export async function prepareTestPlatformDatabase({client,login='',password='',log=()=>{}}){
  if(login&&password.length<8)throw new Error('Set TEST_LOGIN_PASSWORD to at least 8 characters to give the account a test password.');
  const result={emptied:[],missing:[],settings:[],passwordSet:false};
  await client.query('BEGIN');
  try{
    for(const [table,reason] of TABLES_TO_EMPTY){
      const {rows}=await client.query('SELECT to_regclass($1) AS table',[table]);
      if(!rows[0]?.table){result.missing.push(table);log(`Skipped ${table}: not in this database`);continue;}
      await client.query(`TRUNCATE TABLE ${quoteIdentifier(table)}`);
      result.emptied.push(table);log(`Emptied ${table}: ${reason}`);
    }
    for(const [reason,sql,params] of SETTING_STATEMENTS){
      const {rowCount}=await client.query(sql,params);
      result.settings.push({reason,rowCount});log(`${reason}: ${rowCount} row${rowCount===1?'':'s'}`);
    }
    if(login){
      const {rowCount}=await client.query(
        `UPDATE master_records SET record_data = record_data || jsonb_build_object('passwordHash', $1::text)
         WHERE master_name = 'Users & employees' AND lower(record_data->>'login') = lower($2)`,
        [hashPassword(password),login]);
      if(rowCount!==1)throw new Error(`Expected exactly one Users & employees record with login "${login}", found ${rowCount}. Use the exact Login name shown in Users & employees.`);
      result.passwordSet=true;log(`Test password set for ${login}`);
    }
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }
  return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {options}=parseCliArgs(process.argv.slice(2));
  const databaseUrl=typeof options['database-url']==='string'?options['database-url']:'';
  const login=typeof options.login==='string'?options.login.trim():'';
  try{assertTestDatabaseUrl(databaseUrl);}
  catch(error){console.error(error.message);console.error('Usage: node scripts/prepare-test-platform-database.mjs --database-url <test url> --yes [--login <login>]');process.exit(2);}
  console.log(`Test database: ${redactDatabaseUrl(databaseUrl)}`);
  if(options.yes!==true){
    console.error('This empties the stored credentials, queued messages and sessions of this database copy. Re-run with --yes to continue.');
    process.exit(3);
  }
  const client=createClient(databaseUrl,{ssl:options['no-ssl']!==true});
  try{
    await client.connect();
    const result=await prepareTestPlatformDatabase({client,login,password:process.env.TEST_LOGIN_PASSWORD||'',log:line=>console.log(`  ${line}`)});
    console.log(`Test platform copy prepared: ${result.emptied.length} tables emptied, ${result.settings.length} settings changed${result.passwordSet?', test password set':''}.`);
    console.log('Restart the test app now so it reads the prepared copy.');
  }catch(error){
    console.error(`Preparation failed and was rolled back: ${error.message}`);
    process.exitCode=1;
  }finally{
    await client.end().catch(()=>{});
  }
}
