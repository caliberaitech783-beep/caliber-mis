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
 const upload=await fetch(host+'/api/vfs/data/vlb-elb-access-check.mjs',{
  method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream','If-Match':'*'},
  body:payload,signal:AbortSignal.timeout(30000)
 });
 assert.ok(upload.ok,'Verification checker upload HTTP '+upload.status);
 const result=await remote(`EXPECTED_COMMIT=${expected} NODE_PATH=/home/data/vlb-elb-verification-runtime-20261029:/home/data/vlb-elb-verification-runtime-20261029/node_modules:/home/site/wwwroot/node_modules:/node_modules node /home/data/vlb-elb-access-check.mjs`);
 console.log(result.Output||'');
 if(result.ExitCode!==0)console.error(result.Error||'Live checker returned '+result.ExitCode);
 assert.equal(result.ExitCode,0,'Live VLB/ELB verification failed; no production records were changed');
}else{
 const pg=createRequire(import.meta.url)('pg');
 const {misDatabaseConfig}=await import('../server/rules/mis-database-config.mjs');
 const {logBookSiteScope,siteAllowed}=await import('../shared/log-book-access.mjs');
 const {isMisAdministrator}=await import('../shared/mis-admin-access.mjs');
 const {REGION_DATA}=await import('../shared/region-scope.mjs');
 const {canonicalSiteName}=await import('../shared/site-location.mjs');
 const base='https://pulse-ll.cmll.in';
 const health=await liveJson(base+'/api/health');
 assert.equal(health.commit,process.env.EXPECTED_COMMIT,'Live backend must serve the expected release');
 const ui=await readFile('src/vlb-create-batch.jsx','utf8');
 assert.match(ui,/const site=data.accountLocation\|\|/,'Entry must default to the assigned site');
 const picker=/export function preferredVlbEntryBatch\(batches,remembered\)\{([\s\S]*?)\n\}/.exec(ui);
 assert.ok(picker,'Deployed picker must be present');
 const preferred=new Function('batches','remembered',picker[1]);
 const open={id:'open',closed_at:null},closed={id:'closed',closed_at:'2026-11-01'};
 assert.equal(preferred([closed,open],closed.id),open,'A remembered closed batch must not override the open batch');
 assert.equal(preferred([closed],closed.id),null,'Closed batches must not auto-open for work');
 const pool=new pg.Pool({...misDatabaseConfig(),connectionTimeoutMillis:15000,max:2});
 let checked=0,restricted=0,admins=0,openSelections=0,restrictedCandidates=0;const liveScanChecks=[];
 try{
  const sessions=(await pool.query(`SELECT token,role,employee_name AS name,login_name AS login,assigned_role AS "assignedRole",permissions
   FROM (SELECT *,row_number() OVER(PARTITION BY lower(login_name) ORDER BY last_seen_at DESC) AS session_rank FROM auth_sessions WHERE created_at>NOW()-INTERVAL '30 days') AS recent WHERE session_rank<=2 ORDER BY last_seen_at DESC LIMIT 2000`)).rows;
  // Repeated administrator test logins must not hide older site-user sessions.
  const attempts=new Map();
  const candidates=sessions.filter(session=>{const n=attempts.get(session.login)||0;attempts.set(session.login,n+1);return n<2;})
   .sort((a,b)=>Number(isMisAdministrator(a))-Number(isMisAdministrator(b)));
  restrictedCandidates=candidates.filter(session=>!isMisAdministrator(session)).length;
  const seen=new Set();
  for(const session of candidates){
   if(seen.has(session.login))continue;
   const headers={Authorization:'Bearer '+session.token};
   const response=await fetch(base+'/api/log-books/options?scan=1',{headers,signal:AbortSignal.timeout(30000)});
   if([401,403].includes(response.status))continue;
   assert.equal(response.status,200,'Authorized options request must succeed');
   const options=await liveJson(base+'/api/log-books/options?scan=1',{headers,initialResponse:response,allowDenied:true});if(!options)continue;seen.add(session.login);
   const user=(await pool.query(`SELECT record_data FROM master_records WHERE master_name='Users & employees'
    AND (lower(trim(record_data->>'login'))=$1 OR lower(trim(record_data->>'employee'))=$2)
    ORDER BY CASE WHEN lower(trim(record_data->>'login'))=$1 THEN 0 ELSE 1 END,created_at DESC LIMIT 1`,[session.login.toLowerCase(),session.name.toLowerCase()])).rows[0]?.record_data||{};
   const scope=logBookSiteScope(session,user),admin=isMisAdministrator(session);
   const batchOptions=await liveJson(base+'/api/log-books/options',{headers});
   const lmvOptions=await liveJson(base+'/api/log-books/options?scan=1&logBookKind=lmv',{headers});
   assert.deepEqual(options.sites,batchOptions.sites,'VLB and ELB scan sites must match Create VLB Batch');
   assert.deepEqual(lmvOptions.sites,batchOptions.sites,'LMV scan sites must match Create VLB Batch');
   console.log('Live site lists match:',JSON.stringify(batchOptions.sites));
   assert.ok(options.sites.every(site=>siteAllowed(scope,site)),'Scan options must contain only authorized sites');
   assert.equal(options.canSelectSite,scope.sites===null,'Site selection follows the assigned operational scope, including administrators');
   if(admin)admins++;else{
    restricted++;
    const outside=REGION_DATA.flatMap(region=>region.sites).find(site=>!siteAllowed(scope,site));
    if(outside){
     const preview=await fetch(base+'/api/vlb-batches/preview?'+new URLSearchParams({site:outside,date:'2026-11-04',shift:'S1',scan:'1'}),{headers,signal:AbortSignal.timeout(30000)});
     assert.equal(preview.status,403,'A crafted scan preview must deny an outside site');
    }
   }
   for(const kind of ['vehicle','equipment']){
    const r=await fetch(base+'/api/log-books/'+kind+'?first=1',{headers,signal:AbortSignal.timeout(30000)});
    if(r.status===403)continue;
    assert.equal(r.status,200);
    const data=await liveJson(base+'/api/log-books/'+kind+'?first=1',{headers,initialResponse:r,allowDenied:true});if(!data)continue;assert.ok((data.records||[]).every(row=>siteAllowed(scope,row.data?.location||row.site)),'VLB/ELB records must stay within scope');
   }
   const r=await fetch(base+'/api/vlb-batches?scan=1',{headers,signal:AbortSignal.timeout(30000)});
   if(r.ok){
    const batchData=await liveJson(base+'/api/vlb-batches?scan=1',{headers,initialResponse:r,allowDenied:true});if(!batchData)continue;const {batches=[]}=batchData;assert.ok(batches.every(batch=>siteAllowed(scope,batch.site)),'Scan batch list must stay within scope');
    for(const site of options.sites){
     const matching=batches.filter(batch=>!batch.archived_at&&!batch.deleted_at&&canonicalSiteName(batch.site)===canonicalSiteName(site));
     const active=matching.filter(batch=>!batch.closed_at);
     if(active.length===1){assert.equal(preferred(matching,matching.find(batch=>batch.closed_at)?.id),active[0]);openSelections++;}
    }
   }
   // Read existing entries and their retained images; never upload production test cards.
   if(liveScanChecks.length<2){
    const scans=await liveJson(base+'/api/scan-batches',{headers,allowDenied:true});
    for(const kind of ['vehicle','equipment']){
     if(liveScanChecks.some(check=>check.kind===kind))continue;
     const batch=(scans?.batches||[]).find(row=>row.kind===kind&&Number(row.cards)>0);
     if(!batch)continue;
     const detail=await liveJson(base+'/api/scan-batches/'+batch.id,{headers});
     assert.equal(detail.batch.kind,kind,'Live scan entry retains its VLB/ELB type');
     assert.ok(Array.isArray(detail.cards),'Live scan entry returns cards');
     const statuses={},ocrSamples=[];
     for(const card of detail.cards){statuses[card.status]=(statuses[card.status]||0)+1;const extraction=card.raw_fields?.gemini;if(extraction)ocrSamples.push({elapsedMs:extraction.totalElapsedMs??extraction.elapsedMs,attempts:extraction.attempts??1});}
     const sample=detail.cards.find(card=>!card.raw_fields?.fleetRejection);
     let imageAvailable=false;
     if(sample){const image=await fetch(base+'/api/scan-cards/'+sample.id+'/image',{headers,signal:AbortSignal.timeout(30000)});assert.equal(image.status,200,'Existing live scan image must open');assert.match(image.headers.get('content-type')||'',/^image\//);await image.body?.cancel();imageAvailable=true;}
     liveScanChecks.push({kind,cards:detail.cards.length,statuses,imageAvailable,ocrSamples:ocrSamples.slice(0,5)});
    }
   }
   checked++;
   if(restricted>=2&&admins>=1&&openSelections>=1)break;
  }
 }finally{await pool.end();}
 const result={commit:health.commit,checkedAccounts:checked,restrictedCandidateSessions:restrictedCandidates,restrictedAccounts:restricted,administratorAccounts:admins,liveOpenBatchSelections:openSelections,closedBatchPreferenceRejected:true,liveScanChecks};
 console.log(JSON.stringify(result));
 assert.ok(restricted>0,'A current restricted MIS session is required for live access verification');
 assert.ok(admins>0,'A current administrator session is required for live all-site verification');
 assert.ok(openSelections>0,'An existing open site batch is required for live selection verification');
}

}
