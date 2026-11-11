// Scan engine: reads scanned VLB/ELB cards with Gemini outside Pulse-II.
//
// Started on its own Azure Web App with `node server/scan-engine.mjs`. The
// supervisor (this file without MIS_SCAN_ENGINE_LANE) starts one child process
// per site in MIS_SCAN_ENGINE_SITES, plus one "other" child for every site not
// listed, and restarts any child that exits. Each child has its own event loop,
// its own database connections and its site's own Gemini key, so one site's
// upload never waits behind another's and never slows Pulse-II's pages.
//
// Each child claims cards with a lease (see scan-extraction-queue.mjs). On
// SIGTERM (Azure stopping or redeploying the app) a child stops taking new
// cards, lets the cards it is reading finish for up to DRAIN_MS, hands any
// unfinished card back to the queue and exits, so a deploy loses no card and
// re-reads none. Pulse-II reads any site whose engine is not running.
import http from 'node:http';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {parseSiteList,siteKeySlug} from './rules/scan-lanes.mjs';
import {geminiKeySource} from './services/gemini-card-reader.mjs';

const DRAIN_MS=Number(process.env.MIS_SCAN_ENGINE_DRAIN_MS)||60000;
const self=fileURLToPath(import.meta.url);
const root=path.resolve(path.dirname(self),'..');
const version=(()=>{try{const sha=String(process.env.DEPLOYMENT_SHA||fs.readFileSync(path.join(root,'DEPLOYMENT_SHA'),'utf8')).trim();return /^[0-9a-f]{40}$/.test(sha)?sha:'';}catch{return '';}})();

export function engineChildren(env=process.env){
 const sites=parseSiteList(env.MIS_SCAN_ENGINE_SITES);
 // '*' = every site not listed above (and batches without a site yet).
 return [...sites.map(site=>({lane:site,excluded:[]})),{lane:'*',excluded:sites}];
}

async function runChild(){
 const lane=process.env.MIS_SCAN_ENGINE_LANE;
 const excluded=JSON.parse(process.env.MIS_SCAN_ENGINE_EXCLUDED||'[]');
 const [{misDatabaseConfig},{scanBlobConfig,createScanBlobStorage},{registerBulkCardScanning}]=await Promise.all([
  import('./rules/mis-database-config.mjs'),import('./services/scan-blob-storage.mjs'),import('./routes/bulk-card-scanning.mjs')]);
 const {connectionString,ssl}=misDatabaseConfig();
 const pool=new pg.Pool({connectionString,ssl,max:Number(process.env.MIS_SCAN_ENGINE_DB_CONNECTIONS)||4,idleTimeoutMillis:30000,connectionTimeoutMillis:10000});
 pool.on('error',error=>console.error(`[engine ${label(lane)}] database connection error (will reconnect):`,error?.code||error?.message));
 const imageStorage=createScanBlobStorage(scanBlobConfig());
 // The engine serves no pages: route registration goes to a no-op app.
 const noRoutes=new Proxy({},{get:()=>()=>{}});
 const deny=(req,res)=>res.status(404).end();
 const scanning=registerBulkCardScanning(noRoutes,{pool,imageStorage,requireSession:deny,requireAdministrator:deny,role:'engine',engineLane:lane==='*'?null:lane,engineExcluded:excluded,engineVersion:version,fingerprintBackfill:false});
 let stopping=false;
 const stop=async reason=>{if(stopping)return;stopping=true;console.log(`[engine ${label(lane)}] stopping (${reason}); finishing cards being read`);
  try{await scanning.stop({drainMs:DRAIN_MS,releaseLeases:true});}catch(error){console.error(`[engine ${label(lane)}] stop failed:`,error?.message);}
  await pool.end().catch(()=>{});process.exit(0);};
 process.on('SIGTERM',()=>void stop('SIGTERM'));process.on('SIGINT',()=>void stop('SIGINT'));
 process.on('message',message=>{if(message==='stop')void stop('supervisor');});
 process.on('unhandledRejection',reason=>console.error(`[engine ${label(lane)}] unhandled rejection:`,reason?.message||String(reason)));
 await scanning.start();
 console.log(`[engine ${label(lane)}] reading; Gemini key: ${geminiKeySource(process.env,lane==='*'?'':lane)}`);
 const report=()=>{try{process.send?.({type:'status',status:scanning.status()});}catch{}};
 setInterval(report,5000).unref();report();
}

const label=lane=>lane==='*'?'other sites':lane;

function runSupervisor(){
 const children=new Map();let stopping=false;
 const start=spec=>{
  const env={...process.env,MIS_SCAN_ENGINE_PROCESS:'true',MIS_SCAN_ENGINE_LANE:spec.lane,MIS_SCAN_ENGINE_EXCLUDED:JSON.stringify(spec.excluded)};
  const child=fork(self,[],{env,stdio:'inherit'});
  const entry={spec,child,startedAt:new Date().toISOString(),restarts:children.get(spec.lane)?.restarts??0,status:null};
  children.set(spec.lane,entry);
  child.on('message',message=>{if(message?.type==='status')entry.status=message.status;});
  child.on('exit',code=>{
   if(stopping)return;
   entry.restarts++;const delay=Math.min(60000,2000*2**Math.min(entry.restarts,5));
   console.error(`[supervisor] engine ${label(spec.lane)} exited (${code}); restarting in ${delay/1000}s`);
   setTimeout(()=>{if(!stopping)start(spec);},delay).unref();
  });
 };
 for(const spec of engineChildren())start(spec);
 // Azure Web Apps need a listening port; /health also reports each engine.
 const server=http.createServer((req,res)=>{
  if(req.url!=='/health'&&req.url!=='/'){res.writeHead(404).end();return;}
  const engines=[...children.values()].map(({spec,child,startedAt,restarts,status})=>({site:label(spec.lane),key:geminiKeySource(process.env,spec.lane==='*'?'':spec.lane),keySetting:spec.lane==='*'?'GEMINI_API_KEY':'GEMINI_API_KEY_'+siteKeySlug(spec.lane),running:child.exitCode===null&&!child.killed,startedAt,restarts,reading:status?.reading??0,readTotal:status?.readTotal??0}));
  const ok=!stopping&&engines.every(engine=>engine.running);
  res.writeHead(ok?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({status:ok?'ok':'degraded',commit:version,engines}));
 });
 server.listen(Number(process.env.PORT)||8080,()=>console.log(`[supervisor] ${children.size} scan engines started; health on port ${Number(process.env.PORT)||8080}`));
 const stopAll=signal=>{if(stopping)return;stopping=true;console.log(`[supervisor] ${signal}: asking every engine to finish its cards`);
  for(const {child} of children.values())if(child.exitCode===null){try{child.send('stop');}catch{child.kill('SIGTERM');}}
  const deadline=setTimeout(()=>{for(const {child} of children.values())if(child.exitCode===null)child.kill('SIGKILL');process.exit(0);},DRAIN_MS+15000);deadline.unref();
  const check=setInterval(()=>{if([...children.values()].every(({child})=>child.exitCode!==null||child.signalCode)){clearInterval(check);server.close();process.exit(0);}},250);
 };
 process.on('SIGTERM',()=>stopAll('SIGTERM'));process.on('SIGINT',()=>stopAll('SIGINT'));
}

if(process.argv[1]&&path.resolve(process.argv[1])===self){
 if(process.env.MIS_SCAN_ENGINE_LANE)runChild().catch(error=>{console.error('[engine] failed to start:',error?.message||String(error));process.exit(1);});
 else runSupervisor();
}
