import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function embeddedUiVersion(script){
  const direct=/\.caliberUiVersion\s*=\s*["'`]([0-9a-f]{7,64})["'`]/i.exec(script)?.[1];
  if(direct)return direct.toLowerCase();
  const identifier=/\.caliberUiVersion\s*=\s*([A-Za-z_$][\w$]*)/.exec(script)?.[1];
  if(!identifier)return '';
  const escaped=identifier.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const values=[...script.matchAll(new RegExp('\\b'+escaped+'\\s*=\\s*["\'`]([0-9a-f]{7,64})["\'`]','gi'))].map(match=>match[1].toLowerCase());
  return new Set(values).size===1?values[0]:'';
}
const scriptPaths=html=>[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match=>match[1]);
const same=(label,actual,expected)=>{if(actual!==expected)throw Error(label+' version mismatch: expected '+expected+', got '+(actual||'missing'));};

export async function verifyBuiltUiRelease({root='dist',expected}={}){
  const version=(await readFile(path.join(root,'app-version.txt'),'utf8')).trim();
  if(expected)same('Version file',version,expected);
  const html=await readFile(path.join(root,'index.html'),'utf8');let embedded='';
  for(const scriptPath of scriptPaths(html)){
    const relative=new URL(scriptPath,'https://build.invalid').pathname.replace(/^\//,'');
    const absolute=path.resolve(root,relative),base=path.resolve(root)+path.sep;
    if(!absolute.startsWith(base))throw Error('Invalid UI asset path.');
    embedded=embeddedUiVersion(await readFile(absolute,'utf8'))||embedded;
  }
  same('Compiled JavaScript',embedded,version);
  return {version,embeddedVersion:embedded};
}

export async function verifyPublishedUiRelease({base='https://pulse-ll.cmll.in',expected,fetchImpl=fetch}={}){
  if(!/^[0-9a-f]{7,64}$/i.test(expected||''))throw Error('Expected release version is required.');
  const url=new URL(base);const read=async pathname=>{
    const target=new URL(pathname,url);if(target.origin!==url.origin)throw Error('Unexpected UI asset origin.');
    target.searchParams.set('release-check',expected);target.searchParams.set('t',String(Date.now()));
    const response=await fetchImpl(target,{cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Release check HTTP '+response.status+' for '+target.pathname);return response;
  };
  const versionInfo=await(await read('/api/app-version')).json();
  same('Server',versionInfo.version,expected);same('Deployment commit',versionInfo.commit,expected);
  same('Public version file',(await(await read('/app-version.txt')).text()).trim(),expected);
  const html=await(await read('/')).text();let embedded='';
  for(const scriptPath of scriptPaths(html))embedded=embeddedUiVersion(await(await read(scriptPath)).text())||embedded;
  same('Served JavaScript',embedded,expected);
  return {version:expected,embeddedVersion:embedded};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=process.argv.includes('--live')?await verifyPublishedUiRelease({expected:process.env.EXPECTED_COMMIT}):await verifyBuiltUiRelease({expected:process.env.EXPECTED_COMMIT});
  console.log('UI release versions agree: '+result.version);
}
