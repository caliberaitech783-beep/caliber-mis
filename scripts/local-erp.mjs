import {loadErpOracleConfig} from './erp-oracle-config.mjs';
import EmbeddedPostgres from 'embedded-postgres';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import pg from 'pg';

const root=path.resolve(import.meta.dirname,'..');
const state=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.local','share'),'CaliberERP');
await mkdir(state,{recursive:true});
const configFile=path.join(state,'database.json');
let config;
try{config=JSON.parse(await readFile(configFile,'utf8'));}catch(error){
 if(error.code!=='ENOENT')throw error;
 config={user:'erp_local',password:randomBytes(32).toString('hex'),port:55432,database:'caliber_erp'};
 await writeFile(configFile,JSON.stringify(config),{mode:0o600});
}
const databaseDir=path.join(state,'postgres');
const database=new EmbeddedPostgres({databaseDir,user:config.user,password:config.password,port:config.port,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
try{await access(path.join(databaseDir,'PG_VERSION'));}catch{console.log('Initializing independent ERP PostgreSQL database…');await database.initialise();}
await database.start();
const admin=new pg.Client({host:'127.0.0.1',port:config.port,user:config.user,password:config.password,database:'postgres'});
await admin.connect();
if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[config.database])).rowCount)await admin.query('CREATE DATABASE caliber_erp');
await admin.end();
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|windir|comspec|pathext|temp|tmp|userprofile|appdata|localappdata|programdata|systemdrive|homedrive|homepath|username)$/i.test(key)));
Object.assign(env,{DATABASE_URL:`postgresql://${config.user}:${config.password}@127.0.0.1:${config.port}/${config.database}`,DATABASE_SSL:'false',DISABLE_SCHEDULED_JOBS:'true',META_WHATSAPP_DELIVERY_PAUSED:'true',PORT:'4175',LISTEN_HOST:'127.0.0.1',PUBLIC_APP_URL:'http://127.0.0.1:4174',BACKUP_STORAGE_ROOT:path.join(state,'backups')});
const erpOracleConfig=loadErpOracleConfig();if(erpOracleConfig)env.NEXUS_ERP_ORACLE_CONFIG=JSON.stringify(erpOracleConfig);
env.HANDWRITING_MODEL_CACHE=path.join(state,'handwriting-model');env.MIS_SSO_MODE='off';env.MIS_LOCAL_SCANNER_DATABASE='true';env.LOCAL_SCAN_ENABLED='true';env.LOCAL_SCAN_INBOX=path.join(os.homedir(),'OneDrive','Desktop','scan folder');env.LOCAL_SCAN_OUTPUT_ROOT=path.join(state,'scanner');
env.PULSE_SYNC_STATE_FILE=path.join(state,'pulse-master-session.json');
const backend=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:'inherit',windowsHide:true});
let closing=false;
async function close(){if(closing)return;closing=true;backend.kill();await database.stop();}
process.on('SIGINT',()=>void close().then(()=>process.exit()));
process.on('SIGTERM',()=>void close().then(()=>process.exit()));
backend.on('exit',()=>void close());
console.log('ERP PostgreSQL: 127.0.0.1:55432 / caliber_erp');
console.log('ERP backend: http://127.0.0.1:4175 (scheduled integrations disabled)');
