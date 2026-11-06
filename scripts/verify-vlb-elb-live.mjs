import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export async function liveJson(url,{fetchImpl=fetch,initialResponse,allowDenied=false,attempts=6,wait=ms=>new Promise(r=>setTimeout(r,ms)),...init}={}){
 for(let attempt=1;attempt<=attempts;attempt++){
  const response=attempt===1&&initialResponse?initialResponse:await fetchImpl(url,{...init,signal:init.signal||AbortSignal.timeout(30000)});
  if(allowDenied&&[401,403].includes(response.status))return null;
  const text=await response.text();
  const retryable=!text.trim()||[502,503,504].includes(response.status);
  if(retryable&&attempt<attempts){await wait(2000);continue;}
  assert.ok(response.ok,'Live JSON request '+new URL(url).pathname+' returned HTTP '+response.status);
  assert.ok(text.trim(),'Live JSON request '+new URL(url).pathname+' returned an empty body');
  try{return JSON.parse(text);}catch{throw Error('Live JSON request '+new URL(url).pathname+' returned invalid JSON (HTTP '+response.status+')');}
 }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){

// Tokens stay in process memory. Verification issues reads only and never
// creates/closes batches, changes profiles, or writes production test cards.
if(process.argv.includes('--azure')){
 const expected=process.env.EXPECTED_COMMIT;
 assert.match(expected||'',/^[a-f0-9]{40}$/);
 const token=JSON.parse(execFileSync('az',['account','get-access-token','--resource','https://management.azure.com/','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})).accessToken;
 const host='https://caliber-mis-783-gebxgedygkaba9db.scm.centralindia-01.azurewebsites.net';
 const remote=async command=>{
  const response=await fetch(host+'/api/command',{
   method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(180000),
   body:JSON.stringify({command:'/bin/bash -c "printf %s '+Buffer.from(command).toString('base64')+' | base64 -d | bash"',dir:'/home/site/wwwroot'})
  });
  assert.ok(response.ok,'Live verification command HTTP '+response.status);
  return response.json();
 };
 // Kudu shares /home with the app, but not its container's /node_modules.
 // Reuse the existing verification dependency cache and run a small private
 // checker whose imports still point at the actual deployed application.
 const payload=(await readFile(new URL(import.meta.url),'utf8')).replaceAll("'../","'file:///home/site/wwwroot/");
 const upload=await fetch(host+'/api/vfs/data/majri-blank-card-check.mjs',{
  method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream','If-Match':'*'},
  body:payload,signal:AbortSignal.timeout(30000)
 });
 assert.ok(upload.ok,'Verification checker upload HTTP '+upload.status);
 const result=await remote(`EXPECTED_COMMIT=${expected} NODE_PATH=/home/data/vlb-elb-verification-runtime-20261029:/home/data/vlb-elb-verification-runtime-20261029/node_modules:/home/site/wwwroot/node_modules:/node_modules node /home/data/majri-blank-card-check.mjs`);
 console.log(result.Output||'');
 if(result.ExitCode!==0)console.error(result.Error||'Live checker returned '+result.ExitCode);
 assert.equal(result.ExitCode,0,'Live VLB/ELB verification failed; no production records were changed');
}else{
 const pg=createRequire(import.meta.url)('pg');
 const {misDatabaseConfig}=await import('../server/rules/mis-database-config.mjs');
 const {reviewGroupSummary,cardDisplayGroup}=await import('../shared/scan-card-groups.mjs');
 const base='https://pulse-ll.cmll.in';
 const health=await liveJson(base+'/api/health');
 assert.equal(health.commit,process.env.EXPECTED_COMMIT);
 const pool=new pg.Pool({...misDatabaseConfig(),connectionTimeoutMillis:15000,max:1});
 try{
  const {rows}=await pool.query("SELECT b.id,b.name,count(*) FILTER (WHERE c.status='posted')::int AS saved,count(*) FILTER (WHERE c.status='rejected')::int AS rejected FROM mis_scan_batches b JOIN mis_scan_cards c ON c.batch_id=b.id AND c.duplicate_of IS NULL WHERE b.kind='vehicle' AND b.expected_context->>'bookDate'='2026-11-01' AND lower(trim(b.expected_context->>'location'))='majri ob' AND b.expected_context->>'cardShift' IN ('I','S1','1') GROUP BY b.id ORDER BY saved");
  const candidates=rows.filter(row=>row.saved===25);
  assert.ok(candidates.length,'No Majri OB Shift I scan entry with 25 saved cards');
  const sessions=(await pool.query("SELECT token FROM auth_sessions WHERE created_at>NOW()-INTERVAL '30 days' ORDER BY (lower(employee_name)='anoop paul') DESC NULLS LAST,last_seen_at DESC LIMIT 30")).rows;
  let verified=0;
  for(const candidate of candidates){
   for(const {token} of sessions){
    const headers={Authorization:'Bearer '+token};
    const data=await liveJson(base+'/api/scan-batches/'+candidate.id,{headers,allowDenied:true});
    if(!data)continue;
    const summary=reviewGroupSummary(data.cards,'vehicle');
    const blank=data.cards.filter(card=>cardDisplayGroup(card,'vehicle')==='red');
    const deleted=data.batch.deletedCards||[];
    const checks=[];
    for(const card of [...deleted,...blank]){
     const response=await fetch(base+'/api/scan-cards/'+card.id+'/image',{headers,signal:AbortSignal.timeout(15000)});
     await response.body?.cancel();
     checks.push({ordinal:card.ordinal,deleted:deleted.includes(card),imageStatus:response.status});
    }
    console.log(JSON.stringify({batch:candidate.name,total:summary.total,saved:summary.saved,blank:summary.red,deleted:deleted.length,checks}));
    assert.equal(data.cards.some(card=>deleted.some(row=>row.id===card.id)),false);
    verified++;
    break;
   }
  }
  assert.ok(verified>0,"No authorized session could read the matching scan entry");
 }finally{await pool.end()}
}
}
