import {cp,mkdir,lstat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
const runtimeFolders=new Set(['assets','public','scripts','src']);
export function isRuntimeSource(file){
 const parts=file.split('/');
 if(parts.some(part=>!part||part==='..'||part.startsWith('.')))return false;
 if(parts.length>1)return runtimeFolders.has(parts[0]);
 return /\.(?:mjs|cjs|js|json|html)$/.test(file);
}
export async function stageProductionRelease({root=process.cwd(),destination,trackedFiles}={}){
 const source=path.resolve(root),target=path.resolve(destination||'');
 if(!destination||target===source||target.startsWith(source+path.sep))throw Error('Release staging must be outside the source workspace.');
 const files=trackedFiles??(await exec('git',['ls-files','-z'],{cwd:source,maxBuffer:8*1024*1024})).stdout.split('\0').filter(Boolean);
 await mkdir(target,{recursive:false});
 for(const file of files.filter(isRuntimeSource)){
  const output=path.join(target,file);await mkdir(path.dirname(output),{recursive:true});
  await cp(path.join(source,file),output,{verbatimSymlinks:true});
 }
 for(const folder of ['dist','node_modules','ocr-model-cache']){
  if(!(await lstat(path.join(source,folder))).isDirectory())throw Error('Required release directory missing: '+folder);
  await cp(path.join(source,folder),path.join(target,folder),{recursive:true,verbatimSymlinks:true});
 }
 // The deployment identity is generated only after all build checks succeed.
 await cp(path.join(source,'DEPLOYMENT_SHA'),path.join(target,'DEPLOYMENT_SHA'));
 return target;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const destination=await stageProductionRelease({destination:process.argv[2]});
 await exec('npm',['prune','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:destination,maxBuffer:1024*1024});
 console.log('Production release staged; test-only dependencies omitted.');
}
