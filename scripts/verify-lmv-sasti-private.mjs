import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {misDatabaseConfig} from '../server/rules/mis-database-config.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {isMisAdministrator} from '../shared/mis-admin-access.mjs';

const base='https://pulse-ll.cmll.in', site='Sasti OC';
const read=async(path,token)=>{
 const response=await fetch(base+path,{headers:token?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(25000)});
 if(!response.ok)return {status:response.status};
 return {status:response.status,data:await response.json()};
};
const {data:health}=await read('/api/health');
assert.equal(health?.commit,process.env.EXPECTED_COMMIT);
assert.equal(health?.database,'connected');
const ui=await readFile('/home/site/wwwroot/src/vlb-create-batch.jsx','utf8');
const workspace=await readFile('/home/site/wwwroot/src/vlb-entry-workspace.jsx','utf8');
const main=await readFile('/home/site/wwwroot/src/main.jsx','utf8');
const extract=(source,pattern,returnName,args=[],values=[])=>{
 const match=pattern.exec(source);assert.ok(match,'Missing deployed '+returnName);
 return new Function(...args,match[1]+';return '+returnName)(...values);
};
const eligible=extract(ui,/(function openVlbEntryBatches[\s\S]*?\n\})/,'openVlbEntryBatches',['canonicalSiteName'],[canonicalSiteName]);
const preferred=extract(ui,/(function preferredVlbEntryBatch[\s\S]*?\n\})/,'preferredVlbEntryBatch');
const blocked=extract(workspace,/(const elbEntryBlocker=[\s\S]*?\n\};)/,'elbEntryBlocker');
assert.match(ui,/entryKind==='lmv'\?'No existing Vehicle Log Book batch/);
const pg=createRequire(import.meta.url)('pg');
const pool=new pg.Pool({...misDatabaseConfig(),connectionTimeoutMillis:15000,max:1});
try{
 const {rows}=await pool.query(`SELECT token,role,employee_name AS name,login_name AS login,assigned_role AS "assignedRole",permissions
 FROM (SELECT *,row_number() OVER(PARTITION BY lower(login_name) ORDER BY last_seen_at DESC) AS session_rank
 FROM auth_sessions WHERE created_at>NOW()-INTERVAL '30 days') recent WHERE session_rank<=2 ORDER BY last_seen_at DESC LIMIT 2000`);
 let verified=false;
 for(const account of rows.filter(isMisAdministrator).slice(0,20)){
  const token=account.token;
  const paths=(path,mode)=>path+(mode==='scan'?'?scan=1':'');
  const modes=['manual','scan'];
  const options=await Promise.all(modes.map(mode=>read(paths('/api/log-books/options',mode),token)));
  if(!options.every(result=>result.data?.sites?.some(value=>canonicalSiteName(value)===canonicalSiteName(site))))continue;
  const lists=await Promise.all(modes.map(mode=>read(paths('/api/vlb-batches',mode),token)));
  if(!lists.every(result=>Array.isArray(result.data?.batches)))continue;
  const choices=lists.map(result=>eligible(result.data.batches,site,'lmv'));
  if(!choices[0].length){
   const stages=lists[0].data.batches.filter(b=>canonicalSiteName(b.site)===canonicalSiteName(site)).reduce((counts,b)=>({...counts,[b.stage]:(counts[b.stage]||0)+1}),{});
   throw Error('No eligible existing Sasti OC batch. Live stages: '+JSON.stringify(stages));
  }
  const target=choices[0].find(b=>b.stage==='vlb_open'&&Number(b.entry_count)>0)||choices[0].find(b=>b.stage==='vlb_open')||choices[0][0];
  for(const [i,mode] of modes.entries()){
   assert.match(main,new RegExp('kind="lmv" mode="'+mode+'"'));
   assert.equal(preferred(choices[i],target.id)?.id,target.id);
   const result=await read(paths('/api/vlb-batches/'+target.id,mode),token);
   assert.equal(result.status,200);assert.equal(result.data.id,target.id);
   assert.equal(blocked('lmv',result.data),'');
   console.log(JSON.stringify({mode,site,existingBatch:result.data.name,date:result.data.report_date,shift:result.data.shift,stage:result.data.stage,detailStatus:result.status}));
  }
  verified=true;break;
 }
 assert.ok(verified,'No existing authorized administrator session could open Sasti OC in both modes');
}finally{await pool.end();}

