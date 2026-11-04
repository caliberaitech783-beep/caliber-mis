import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';

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
   body:JSON.stringify({command,dir:'/home/site/wwwroot'})
  });
  assert.ok(response.ok,'Live verification command HTTP '+response.status);
  return response.json();
 };
 const discovery=await remote(`command -v node || for candidate in /opt/nodejs/*/bin/node /usr/local/bin/node /usr/bin/node /home/data/vlb-elb-check-node-${process.versions.node}; do if test -x "$candidate"; then echo "$candidate"; break; fi; done`);
 let node=String(discovery.Output||'').trim().split('\n').find(line=>/^\/[A-Za-z0-9_./-]+$/.test(line));
 if(!node){
  // Kudu may have no Node runtime even though the application container does.
  // Reuse the official setup-node binary already validated on this Linux runner.
  node='/home/data/vlb-elb-check-node-'+process.versions.node;
  const upload=await fetch(host+'/api/vfs/data/'+node.split('/').at(-1)+'.gz',{
   method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream','If-Match':'*'},
   body:gzipSync(await readFile(process.execPath)),signal:AbortSignal.timeout(180000)
  });
  assert.ok(upload.ok,'Verification runtime upload HTTP '+upload.status);
  const unpacked=await remote(`gzip -dc ${node}.gz > ${node} && chmod 700 ${node}`);
  assert.equal(unpacked.ExitCode,0,'Verification runtime must unpack successfully');
 }
 const result=await remote(`EXPECTED_COMMIT=${expected} ${node} scripts/verify-vlb-elb-live.mjs`);
 console.log(result.Output||'');
 if(result.ExitCode!==0)console.error(result.Error||'Live checker returned '+result.ExitCode);
 assert.equal(result.ExitCode,0,'Live VLB/ELB verification failed; no production records were changed');
}else{
 const {default:pg}=await import('pg');
 const {misDatabaseConfig}=await import('../server/rules/mis-database-config.mjs');
 const {logBookSiteScope,siteAllowed}=await import('../shared/log-book-access.mjs');
 const {isMisAdministrator}=await import('../shared/mis-admin-access.mjs');
 const {REGION_DATA}=await import('../shared/region-scope.mjs');
 const {canonicalSiteName}=await import('../shared/site-location.mjs');
 const base='https://pulse-ll.cmll.in';
 const health=await(await fetch(base+'/api/health')).json();
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
 let checked=0,restricted=0,admins=0,openSelections=0;
 try{
  const sessions=(await pool.query(`SELECT token,role,employee_name AS name,login_name AS login,assigned_role AS "assignedRole",permissions
   FROM auth_sessions WHERE created_at>NOW()-INTERVAL '30 days' ORDER BY last_seen_at DESC LIMIT 80`)).rows;
  const seen=new Set();
  for(const session of sessions){
   if(seen.has(session.login))continue;
   const headers={Authorization:'Bearer '+session.token};
   const response=await fetch(base+'/api/log-books/options?scan=1',{headers,signal:AbortSignal.timeout(30000)});
   if([401,403].includes(response.status))continue;
   assert.equal(response.status,200,'Authorized options request must succeed');
   const options=await response.json();seen.add(session.login);
   const user=(await pool.query(`SELECT record_data FROM master_records WHERE master_name='Users & employees'
    AND (lower(trim(record_data->>'login'))=$1 OR lower(trim(record_data->>'employee'))=$2)
    ORDER BY CASE WHEN lower(trim(record_data->>'login'))=$1 THEN 0 ELSE 1 END,created_at DESC LIMIT 1`,[session.login.toLowerCase(),session.name.toLowerCase()])).rows[0]?.record_data||{};
   const scope=logBookSiteScope(session,user),admin=isMisAdministrator(session);
   assert.ok(options.sites.every(site=>siteAllowed(scope,site)),'Scan options must contain only authorized sites');
   assert.equal(options.canSelectSite,admin,'Only administrators receive unrestricted site selection');
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
    const data=await r.json();assert.ok((data.records||[]).every(row=>siteAllowed(scope,row.data?.location||row.site)),'VLB/ELB records must stay within scope');
   }
   const r=await fetch(base+'/api/vlb-batches?scan=1',{headers,signal:AbortSignal.timeout(30000)});
   if(r.ok){
    const {batches=[]}=await r.json();assert.ok(batches.every(batch=>siteAllowed(scope,batch.site)),'Scan batch list must stay within scope');
    for(const site of options.sites){
     const matching=batches.filter(batch=>!batch.archived_at&&!batch.deleted_at&&canonicalSiteName(batch.site)===canonicalSiteName(site));
     const active=matching.filter(batch=>!batch.closed_at);
     if(active.length===1){assert.equal(preferred(matching,matching.find(batch=>batch.closed_at)?.id),active[0]);openSelections++;}
    }
   }
   checked++;
   if(restricted>=2&&admins>=1&&openSelections>=1)break;
  }
 }finally{await pool.end();}
 const result={commit:health.commit,checkedAccounts:checked,restrictedAccounts:restricted,administratorAccounts:admins,liveOpenBatchSelections:openSelections,closedBatchPreferenceRejected:true};
 console.log(JSON.stringify(result));
 assert.ok(restricted>0,'A current restricted MIS session is required for live access verification');
 assert.ok(admins>0,'A current administrator session is required for live all-site verification');
 assert.ok(openSelections>0,'An existing open site batch is required for live selection verification');
}
