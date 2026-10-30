import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,readlink,access,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {stageProductionRelease,isRuntimeSource} from '../scripts/stage-production-release.mjs';
test('release preserves runtime bytes, pinned model and relative links while excluding private and development files',async t=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'mis-release-'));t.after(()=>rm(temp,{recursive:true,force:true}));
 const root=path.join(temp,'source'),destination=path.join(temp,'release');
 const fixtures={
  'server.mjs':'export const server=true;',
  'package.json':'{"scripts":{"start":"node server.mjs"}}',
  'package-lock.json':'{"lockfileVersion":3}',
  'scan-extraction-queue.mjs':'export const queue=true;',
  'public/cd/directory-data.json':'{"people":[]}',
  'assets/fonts/handwriting.ttf':'font-bytes',
  'scripts/verify-ui-release.mjs':'export const check=true;',
  'src/runtime-helper.mjs':'export const helper=true;',
  'test/private-fixture.json':'must-not-deploy',
  'docs/notes.md':'must-not-deploy',
  '.github/workflows/deploy.yml':'must-not-deploy',
  '.env.production':'SECRET=must-not-deploy',
  '.local/secret.json':'must-not-deploy',
  'backups/backup.json':'must-not-deploy',
  'README.md':'not-runtime',
  'dist/index.html':'<main>compiled UI</main>',
  'dist/app-assets/index.js':'compiled-byte-identical',
  'dist/.openai/hosting.json':'{"project_id":"same"}',
  'node_modules/example/index.js':'production-dependency',
  'ocr-model-cache/Xenova/trocr-small-handwritten/onnx/decoder_model_quantized.onnx':'pinned-model-bytes',
  'DEPLOYMENT_SHA':'a'.repeat(40)
 };
 for(const [file,value]of Object.entries(fixtures)){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),value);}
 await mkdir(path.join(root,'node_modules/.bin'));await symlink('../example/index.js',path.join(root,'node_modules/.bin/example'));
 const trackedFiles=Object.keys(fixtures).filter(file=>!['dist','node_modules','ocr-model-cache'].some(folder=>file.startsWith(folder+'/'))&&file!=='DEPLOYMENT_SHA');
 await stageProductionRelease({root,destination,trackedFiles});
 for(const file of Object.keys(fixtures).filter(file=>isRuntimeSource(file)||['dist/','node_modules/','ocr-model-cache/'].some(prefix=>file.startsWith(prefix))||file==='DEPLOYMENT_SHA'))assert.equal(await readFile(path.join(destination,file),'utf8'),fixtures[file],file);
 for(const file of ['test/private-fixture.json','docs/notes.md','.env.production','.local/secret.json','backups/backup.json','README.md','.github/workflows/deploy.yml'])await assert.rejects(access(path.join(destination,file)));
 assert.equal(await readlink(path.join(destination,'node_modules/.bin/example')),'../example/index.js');
 await assert.rejects(stageProductionRelease({root,destination:root,trackedFiles}),/outside/);
 await assert.rejects(stageProductionRelease({root,destination:path.join(root,'release'),trackedFiles}),/outside/);
 assert.equal(isRuntimeSource('../escape.mjs'),false);
});
test('a missing model prevents production packaging instead of publishing an incomplete OCR release',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mis-release-incomplete-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const destination=root+'-stage';t.after(()=>rm(destination,{recursive:true,force:true}));
 await mkdir(path.join(root,'dist'));await mkdir(path.join(root,'node_modules'));
 await assert.rejects(stageProductionRelease({root,destination,trackedFiles:[]}),/ENOENT/);
});
