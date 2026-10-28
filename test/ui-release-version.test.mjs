import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {build} from 'vite';
import {buildSite} from '../build-site.mjs';
import {embeddedUiVersion,verifyBuiltUiRelease,verifyPublishedUiRelease} from '../scripts/verify-ui-release.mjs';

const current='a'.repeat(40),stale='b'.repeat(40);
test('actual Vite output embeds the release version while the source stays unchanged',async()=>{
  const cwd=await mkdtemp(path.join(os.tmpdir(),'caliber-version-build-'));
  await mkdir(path.join(cwd,'src'));
  const source=await readFile(new URL('../src/app-version.js',import.meta.url),'utf8');
  await writeFile(path.join(cwd,'src/app-version.js'),source);
  await writeFile(path.join(cwd,'index.html'),'<html><body><script type="module" src="/src/main.js"></script></body></html>');
  await writeFile(path.join(cwd,'src/main.js'),"import {APP_VERSION} from './app-version.js';document.documentElement.dataset.caliberUiVersion=APP_VERSION;");
  await buildSite({cwd,env:{GITHUB_SHA:current},verifyOutput:true,buildClient:options=>build({...options,configFile:false,logLevel:'silent'})});
  assert.equal((await verifyBuiltUiRelease({root:path.join(cwd,'dist'),expected:current})).embeddedVersion,current);
  assert.equal(await readFile(path.join(cwd,'src/app-version.js'),'utf8'),source);
  await writeFile(path.join(cwd,'dist/app-version.txt'),stale);
  await assert.rejects(()=>verifyBuiltUiRelease({root:path.join(cwd,'dist')}),/Compiled JavaScript version mismatch/);
});

test('compiled version marker supports direct and minified bindings and rejects ambiguous values',()=>{
  assert.equal(embeddedUiVersion('document.documentElement.dataset.caliberUiVersion="'+current+'"'),current);
  assert.equal(embeddedUiVersion('const qS=`'+current+'`;document.documentElement.dataset.caliberUiVersion=qS'),current);
  assert.equal(embeddedUiVersion('const qS="'+current+'";function x(){let qS="'+stale+'";}document.documentElement.dataset.caliberUiVersion=qS'),'');
});

test('live verification rejects stale served JavaScript even when the server reports the new release',async()=>{
  let embedded=current;
  const fetchImpl=async url=>{
    assert.equal(url.origin,'https://pulse-ll.cmll.in');
    const values={
      '/api/app-version':JSON.stringify({version:current,commit:current}),
      '/app-version.txt':current,
      '/':'<script type="module" src="/app-assets/index.js"></script>',
      '/app-assets/index.js':'document.documentElement.dataset.caliberUiVersion="'+embedded+'";',
    };
    return new Response(values[url.pathname],{status:200});
  };
  assert.equal((await verifyPublishedUiRelease({expected:current,fetchImpl})).version,current);
  embedded=stale;await assert.rejects(()=>verifyPublishedUiRelease({expected:current,fetchImpl}),/Served JavaScript version mismatch/);
  embedded='';await assert.rejects(()=>verifyPublishedUiRelease({expected:current,fetchImpl}),/got missing/);
});
