import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// Import the real server in an isolated process. No production credentials or
// database are used: this checks module loading, built UI and HTTP startup.
export function verifyServerStart({root=process.cwd(),entry='server.mjs',timeoutMs=20000}={}){
 const database=process.env.RELEASE_CHECK_DATABASE_URL||'postgres://release_check:release_check@127.0.0.1:9/caliber_mis';
 const target=new URL(database);
 if(!['127.0.0.1','localhost'].includes(target.hostname)||target.pathname!=='/caliber_mis')throw Error('Startup checks require an isolated local caliber_mis database.');
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[entry],{cwd:root,env:{...process.env,
   DATABASE_URL:database,
   MIS_DATABASE_CONNECTION_MODE:'isolated',MIS_LOCAL_SCANNER_DATABASE:'false',
   DISABLE_SCHEDULED_JOBS:'true',LOCAL_SCAN_ENABLED:'false',PORT:'0',LISTEN_HOST:'127.0.0.1'
  },stdio:['ignore','pipe','pipe']});
  let output='',settled=false;
  const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);child.kill('SIGKILL');error?reject(error):resolve();};
  const timer=setTimeout(()=>finish(Error('Release server did not start within '+timeoutMs+' ms. '+output.slice(-3000))),timeoutMs);
  const collect=chunk=>{output=(output+chunk).slice(-12000);if(/CALIBER ERP listening on port 0/.test(output))finish();};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.on('error',error=>finish(error));
  child.on('exit',(code,signal)=>{if(!settled)finish(Error('Release server exited before HTTP startup ('+(code??signal)+'). '+output.slice(-3000)));});
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await verifyServerStart();console.log('Complete release server loaded and started successfully.');
}
