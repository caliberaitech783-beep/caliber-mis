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
 const payload=(await readFile(new URL('./verify-lmv-sasti-private.mjs',import.meta.url),'utf8')).replaceAll("'../","'file:///home/site/wwwroot/");
 const upload=await fetch(host+'/api/vfs/data/lmv-sasti-29d24d9-check.mjs',{
  method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream','If-Match':'*'},
  body:payload,signal:AbortSignal.timeout(30000)
 });
 assert.ok(upload.ok,'Verification checker upload HTTP '+upload.status);
 const result=await remote(`EXPECTED_COMMIT=${expected} NODE_PATH=/home/data/vlb-elb-verification-runtime-20261029:/home/data/vlb-elb-verification-runtime-20261029/node_modules:/home/site/wwwroot/node_modules:/node_modules node /home/data/lmv-sasti-29d24d9-check.mjs`);
 console.log(result.Output||'');
 if(result.ExitCode!==0)console.error(result.Error||'Live checker returned '+result.ExitCode);
 assert.equal(result.ExitCode,0,'Live VLB/ELB verification failed; no production records were changed');
}
}
