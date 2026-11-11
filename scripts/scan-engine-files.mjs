// Lists every repository file the scan engine runs: server/scan-engine.mjs and
// everything it imports, followed through static and literal dynamic imports.
// The engine deploy workflow redeploys the engine only when one of these files
// (or the dependency lock) changed since the commit the engine is running, so
// report and screen changes to Pulse-II never restart the scan engines.
//
//   node scripts/scan-engine-files.mjs            -> prints the file list
//   node scripts/scan-engine-files.mjs <changed>  -> prints "changed=true|false"
//                                                    for a file of changed paths
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ENTRY='server/scan-engine.mjs';
const ALWAYS=['package.json','package-lock.json','server/scan-engine.mjs','scripts/scan-engine-files.mjs','.github/workflows/scan-engine-deploy.yml'];
const IMPORT=/(?:^|[\s;{}()])(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]|(?:^|[\s;{}()=,])import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

export function engineFiles(start=ENTRY){
 const seen=new Set(),queue=[start];
 while(queue.length){
  const file=queue.shift();if(seen.has(file))continue;
  const full=path.join(root,file);if(!fs.existsSync(full))continue;
  seen.add(file);
  const source=fs.readFileSync(full,'utf8');
  for(const match of source.matchAll(IMPORT)){
   const spec=match[1]||match[2]||match[3];
   if(!spec||!spec.startsWith('.'))continue;
   const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));
   if(/\.(mjs|js|json)$/.test(resolved))queue.push(resolved);
  }
 }
 return [...new Set([...seen,...ALWAYS])].sort();
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const files=engineFiles();
 const changedFile=process.argv[2];
 if(!changedFile){console.log(files.join('\n'));}
 else{
  const changed=fs.readFileSync(changedFile,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const hits=changed.filter(file=>files.includes(file));
  for(const file of hits)console.error('engine file changed: '+file);
  console.log('changed='+(hits.length>0));
 }
}
