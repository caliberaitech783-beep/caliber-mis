import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {PULSE_MASTER_NAMES} from '../pulse-master-sync.mjs';
const state=path.join(process.env.LOCALAPPDATA,'CaliberERP');
const config=JSON.parse(await readFile(path.join(state,'database.json'),'utf8'));
const connection=JSON.parse(await readFile(path.join(state,'pulse-master-session.json'),'utf8'));
const sourceResponse=await fetch('https://pulse.cmll.in/api/masters?names='+encodeURIComponent(PULSE_MASTER_NAMES.join('|')),{headers:{Authorization:`Bearer ${connection.token}`},signal:AbortSignal.timeout(45000)});
if(!sourceResponse.ok)throw new Error(`Pulse master verification failed with HTTP ${sourceResponse.status}`);
const source=await sourceResponse.json();
const client=new pg.Client({host:'127.0.0.1',port:config.port,user:config.user,password:config.password,database:config.database});
await client.connect();
try{
 const results=[];
 for(const name of PULSE_MASTER_NAMES){
   const locals=(await client.query('SELECT m.id,m.record_data,l.source_id FROM master_records m LEFT JOIN pulse_master_links l ON l.local_id=m.id WHERE m.master_name=$1',[name])).rows;
   const bySource=new Map(locals.filter(r=>r.source_id).map(r=>[String(r.source_id),r.record_data]));
   const sourceRows=source[name]||[];let missing=0,different=0;
   const clean=data=>{const {id,passwordHash,mustChangePassword,...record}=data;return record;};
   for(const row of sourceRows){const local=bySource.get(String(row.id));if(!local)missing++;else if(!isDeepStrictEqual(clean(local),clean(row)))different++;}
   results.push({master:name,pulseRecords:sourceRows.length,linkedLocalRecords:bySource.size,localOnlyRecords:locals.length-bySource.size,missing,different,staleLinks:[...bySource.keys()].filter(id=>!sourceRows.some(r=>String(r.id)===id)).length});
 }
 const report={checkedAt:new Date().toISOString(),results};
 await mkdir(path.resolve('.local'),{recursive:true});await writeFile('.local/pulse-sync-verification.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{await client.end();}
