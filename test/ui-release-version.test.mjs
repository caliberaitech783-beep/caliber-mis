import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {runInNewContext} from 'node:vm';
import {build} from 'vite';
import {buildSite} from '../build-site.mjs';
import {embeddedUiVersion,verifyBuiltUiRelease,verifyPublishedUiRelease} from '../scripts/verify-ui-release.mjs';

const current='a'.repeat(40),stale='b'.repeat(40);
test('the boot script retries an empty stylesheet once without reloading the page',async()=>{
  const script=await readFile(new URL('../public/mis-boot.js',import.meta.url),'utf8');
  const listeners=new Map();
  const link={
    href:'https://pulse-ll.cmll.in/app-assets/index.css?release='+current,
    sheet:{cssRules:[]},
    matches:selector=>selector==='link[data-pulse-stylesheet]',
    cloneNode:()=>({}),
    replaceWith:replacement=>retries.push(replacement.href),
  };
  const retries=[];
  runInNewContext(script,{
    URL,
    document:{querySelector:()=>link},
    window:{addEventListener:(name,listener)=>listeners.set(name,listener)},
  });
  listeners.get('load')();
  listeners.get('error')({target:link});
  assert.equal(retries.length,1);
  const retried=new URL(retries[0]);
  assert.equal(retried.pathname,'/app-assets/index.css');
  assert.equal(retried.searchParams.get('release'),current);
  assert.ok(retried.searchParams.has('retry'));
});

test('actual Vite output embeds the release version while the source stays unchanged',async()=>{
  const cwd=await mkdtemp(path.join(os.tmpdir(),'caliber-version-build-'));
  await mkdir(path.join(cwd,'src'));
  const source=await readFile(new URL('../src/app-version.js',import.meta.url),'utf8');
  await writeFile(path.join(cwd,'src/app-version.js'),source);
  await writeFile(path.join(cwd,'index.html'),'<html><body><script type="module" src="/src/main.js"></script></body></html>');
  await writeFile(path.join(cwd,'src/main.js'),"import './main.css';import {APP_VERSION} from './app-version.js';document.documentElement.dataset.caliberUiVersion=APP_VERSION;");
  await writeFile(path.join(cwd,'src/main.css'),'body{color:purple}');
  await buildSite({cwd,env:{GITHUB_SHA:current},verifyOutput:true,buildClient:options=>build({...options,configFile:false,logLevel:'silent'})});
  assert.equal((await verifyBuiltUiRelease({root:path.join(cwd,'dist'),expected:current})).embeddedVersion,current);
  assert.match(await readFile(path.join(cwd,'dist/index.html'),'utf8'),new RegExp('\\.css\\?release='+current+'" data-pulse-stylesheet'));
  assert.equal(await readFile(path.join(cwd,'src/app-version.js'),'utf8'),source);
  await writeFile(path.join(cwd,'dist/app-version.txt'),stale);
  await assert.rejects(()=>verifyBuiltUiRelease({root:path.join(cwd,'dist')}),/Compiled JavaScript version mismatch/);
});

test('compiled version marker supports direct and minified bindings and rejects ambiguous values',()=>{
  assert.equal(embeddedUiVersion('document.documentElement.dataset.caliberUiVersion="'+current+'"'),current);
  assert.equal(embeddedUiVersion('const qS=`'+current+'`;document.documentElement.dataset.caliberUiVersion=qS'),current);
  assert.equal(embeddedUiVersion('var $k=`'+current+'`;document.documentElement.dataset.caliberUiVersion=$k'),current);
  assert.equal(embeddedUiVersion('var other$k=`'+current+'`;document.documentElement.dataset.caliberUiVersion=$k'),'');
  assert.equal(embeddedUiVersion('const qS="'+current+'";function x(){let qS="'+stale+'";}document.documentElement.dataset.caliberUiVersion=qS'),'');
});

test('live verification rejects stale served JavaScript even when the server reports the new release',async()=>{
  let embedded=current;
  let stylesheet='body{color:purple}';
  const fetchImpl=async url=>{
    assert.equal(url.origin,'https://pulse-ll.cmll.in');
    const values={
      '/api/app-version':JSON.stringify({version:current,commit:current}),
      '/app-version.txt':current,
      '/':'<script type="module" src="/app-assets/index.js"></script><link rel="stylesheet" href="/app-assets/index.css?release='+current+'">',
      '/app-assets/index.js':'document.documentElement.dataset.caliberUiVersion="'+embedded+'";',
    };
    if(url.pathname.endsWith('.css')){
      assert.equal(url.searchParams.toString(),'release='+current);
      return new Response(stylesheet,{headers:{'Content-Type':'text/css'}});
    }
    return new Response(values[url.pathname],{status:200});
  };
  assert.equal((await verifyPublishedUiRelease({expected:current,fetchImpl})).version,current);
  stylesheet='';await assert.rejects(()=>verifyPublishedUiRelease({expected:current,fetchImpl}),/Release stylesheet is missing or invalid/);
  embedded=stale;await assert.rejects(()=>verifyPublishedUiRelease({expected:current,fetchImpl}),/Served JavaScript version mismatch/);
  embedded='';await assert.rejects(()=>verifyPublishedUiRelease({expected:current,fetchImpl}),/got missing/);
});
