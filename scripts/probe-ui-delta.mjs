import {execFileSync} from 'node:child_process';
const resource='https://management.azure.com/subscriptions/58ca09cf-ab5d-47a8-a438-e1fb2a40d030/resourceGroups/coalmine-fleet-maintenance-rg/providers/Microsoft.Web/sites/caliber-mis-783';
const token=JSON.parse(execFileSync('az',['account','get-access-token','--resource','https://management.azure.com/','--output','json'],{encoding:'utf8'})).accessToken;
const headers={Authorization:'Bearer '+token};
const response=await fetch(resource+'?api-version=2023-12-01',{headers});
if(!response.ok)throw Error('Site read: '+response.status);
const app=await response.json();
const scm=app.properties.enabledHostNames.find(host=>host.includes('.scm.'));
console.log({scm});
for(const route of ['/api/zip/site/wwwroot/dist/app-assets/','/api/vfs/site/wwwroot/dist/index.html','/api/vfs/site/wwwroot/dist/app-version.txt','/api/vfs/site/wwwroot/DEPLOYMENT_SHA','/api/vfs/site/wwwroot/src/reports-workspace.css']){
 try {
  const started=Date.now();
  const result=await fetch('https://'+scm+route,{headers:{...headers,'If-Match':'*'},redirect:'error',signal:AbortSignal.timeout(60000)});
  const bytes=Buffer.from(await result.arrayBuffer());
  console.log({route,status:result.status,bytes:bytes.length,zip:bytes.subarray(0,4).toString('hex'),seconds:(Date.now()-started)/1000,type:result.headers.get('content-type')});
 }catch(error){console.log({route,error:error.message});}
}
for(const route of ['/api/health','/api/app-version']){
 const info=await(await fetch('https://pulse-ll.cmll.in'+route+'?probe='+Date.now())).json();
 console.log({route,status:info.status,database:info.database,commit:info.commit,version:info.version,scheduledJobsEnabled:info.scheduledJobsEnabled});
}
