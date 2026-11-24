import {isDeepStrictEqual} from 'node:util';
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
 const upload=await fetch(host+'/api/vfs/data/batch-loading-live-check-20261124.mjs',{
  method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream','If-Match':'*'},
  body:payload,signal:AbortSignal.timeout(30000)
 });
 assert.ok(upload.ok,'Verification checker upload HTTP '+upload.status);
 const siteArgs=process.argv.includes('--sites-only')?' --sites-only':'';
 const result=await remote(`EXPECTED_COMMIT=${expected} NODE_PATH=/home/data/vlb-elb-verification-runtime-20261029:/home/data/vlb-elb-verification-runtime-20261029/node_modules:/home/site/wwwroot/node_modules:/node_modules node /home/data/batch-loading-live-check-20261124.mjs${siteArgs}`);
 console.log(result.Output||'');
 if(result.ExitCode!==0)console.error(result.Error||'Live checker returned '+result.ExitCode);
 assert.equal(result.ExitCode,0,'Live VLB/ELB verification failed; no production records were changed');
}else{
 const pg=createRequire(import.meta.url)('pg');
 const {misDatabaseConfig}=await import('../server/rules/mis-database-config.mjs');
 const {logBookSiteScope,siteAllowed}=await import('../shared/log-book-access.mjs');
 const {isMisAdministrator}=await import('../shared/mis-admin-access.mjs');
 const {canonicalSiteName}=await import('../shared/site-location.mjs');
 const {fleetDoorKey}=await import('../shared/scan-fleet-door.mjs');
 const {withVlbTripHandovers,linkVlbTripHandovers}=await import('../shared/vlb-trip-handover.mjs');
 const {readVlbBatchListCounts}=await import('../server/rules/vlb-card-counts.mjs');
 const base='https://pulse-ll.cmll.in',health=await liveJson(base+'/api/health',{attempts:2});
 assert.equal(health.commit,process.env.EXPECTED_COMMIT);assert.equal(typeof readVlbBatchListCounts,'function','Approved batch-loading fix must be installed');assert.equal(health.database,'connected');
 const pool=new pg.Pool({...misDatabaseConfig(),max:1,connectionTimeoutMillis:10000,statement_timeout:20000,options:'-c default_transaction_read_only=on'});
 const result={commit:health.commit,readOnlyDatabase:true,accounts:[],countsCompared:0,handoverCardsCompared:0,detailRead:false,outsideSiteDenied:false,timings:[]};
 const get=async(path,headers)=>{const start=Date.now(),r=await fetch(base+path,{headers,signal:AbortSignal.timeout(25000)});result.timings.push({route:path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g,':id'),ms:Date.now()-start,status:r.status});return r;};
 try{
  const sessions=(await pool.query("SELECT token,role,employee_name AS name,login_name AS login,assigned_role AS \"assignedRole\",permissions FROM (SELECT *,row_number() OVER(PARTITION BY lower(login_name) ORDER BY last_seen_at DESC) AS rank FROM auth_sessions WHERE created_at>NOW()-INTERVAL '7 days' AND last_seen_at>NOW()-INTERVAL '2 days') recent WHERE rank=1 ORDER BY last_seen_at DESC LIMIT 200")).rows;
  sessions.sort((a,b)=>Number(isMisAdministrator(b))-Number(isMisAdministrator(a)));
  let adminChecked=false,restrictedChecked=false;
  for(const session of sessions){
   const admin=isMisAdministrator(session);if(admin?adminChecked:restrictedChecked)continue;
   const headers={Authorization:'Bearer '+session.token},r=await get('/api/vlb-batches',headers);
   if([401,403].includes(r.status))continue;assert.equal(r.status,200);const data=await r.json();
   const user=(await pool.query("SELECT record_data FROM master_records WHERE master_name='Users & employees' AND lower(trim(record_data->>'login'))=$1 ORDER BY id DESC LIMIT 1",[String(session.login).toLowerCase()])).rows[0]?.record_data||{},scope=logBookSiteScope(session,user);
   assert.ok(data.batches.every(b=>siteAllowed(scope,b.site)));
   assert.ok(data.batches.every(b=>Number.isInteger(b.entry_count)&&Number.isInteger(b.elb_entry_count)));
   if(scope.sites!==null&&!result.outsideSiteDenied){
    const outside=(await pool.query("SELECT id,site FROM mis_vlb_batches WHERE archived_at IS NULL AND book_date>='2026-11-01' ORDER BY created_at DESC")).rows.find(b=>!siteAllowed(scope,b.site));
    if(outside){const denied=await get('/api/vlb-batches/'+outside.id,headers);assert.ok([403,404].includes(denied.status));await denied.body?.cancel();result.outsideSiteDenied=true;}
   }
   const sample=data.batches.find(b=>b.entry_count>0);
   if(sample&&!result.detailRead){const response=await get('/api/vlb-batches/'+sample.id,headers);assert.equal(response.status,200);const detail=await response.json();assert.equal(detail.id,sample.id);assert.equal(detail.entry_count,detail.records.length);result.detailRead=true;}
   result.accounts.push({administrator:admin,restrictedScope:scope.sites!==null,batches:data.batches.length});
   if(admin)adminChecked=true;else restrictedChecked=true;if(adminChecked&&restrictedChecked)break;
  }
  assert.ok(adminChecked&&restrictedChecked);assert.ok(result.detailRead&&result.outsideSiteDenied);
  const db=await pool.connect();
  try{
   await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const ids=(await db.query("SELECT id FROM mis_vlb_batches WHERE archived_at IS NULL AND book_date>='2026-11-01' ORDER BY created_at DESC LIMIT 30")).rows.map(b=>b.id),current=await readVlbBatchListCounts(db,ids);
   const previous=(await db.query("SELECT b.id,(SELECT count(*)::int FROM mis_vlb_batch_entries e JOIN mis_log_books l ON l.id=e.logbook_id WHERE e.batch_id=b.id AND l.deleted_at IS NULL AND l.book_type='vehicle' AND l.book_date>='2026-11-01') AS entry_count,(SELECT count(*)::int FROM mis_elb_batch_entries e JOIN mis_log_books l ON l.id=e.logbook_id WHERE e.batch_id=b.id AND l.deleted_at IS NULL) AS elb_entry_count FROM mis_vlb_batches b WHERE id=ANY($1::uuid[])",[ids])).rows;
   const ordered=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));assert.ok(isDeepStrictEqual(ordered(current),ordered(previous)),'Previous and optimized batch counts must agree');result.countsCompared=ids.length;
   const input=(await db.query("SELECT id,book_no,book_type,data FROM mis_log_books WHERE book_type='vehicle' AND deleted_at IS NULL AND book_date>='2026-11-01' AND mis_vlb_has_handover_trip(data) ORDER BY id DESC LIMIT 1")).rows[0];
   if(input){
    const key=data=>JSON.stringify([canonicalSiteName(data.location),fleetDoorKey(data.door)]),wanted=key(input.data);
    const candidates=(await db.query("SELECT id,data->>'location' AS location,data->>'door' AS door FROM mis_log_books WHERE book_type='vehicle' AND deleted_at IS NULL AND book_date>='2026-11-01' AND mis_vlb_has_handover_trip(data)")).rows.filter(r=>key(r)===wanted).map(r=>r.id);
    const history=(await db.query("SELECT id,book_no,book_type,data FROM mis_log_books WHERE id=ANY($1::bigint[]) AND book_type='vehicle' AND deleted_at IS NULL AND book_date>='2026-11-01'",[candidates])).rows;
    const all=new Map(history.map(r=>[String(r.id),r]));all.set(String(input.id),input);
    const expected=linkVlbTripHandovers([...all.values()]).find(r=>String(r.id)===String(input.id));assert.ok(isDeepStrictEqual(await withVlbTripHandovers(db,[input]),[expected]),'Previous and optimized historical handovers must agree');result.handoverCardsCompared=history.length;
   }
   await db.query('ROLLBACK');
  }finally{db.release();}
  console.log(JSON.stringify(result));
 }finally{await pool.end();}
}
}
