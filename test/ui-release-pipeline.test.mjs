import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {classifyRelease} from '../scripts/classify-ui-release.mjs';
import {modelCacheManifest,verifyModelCache} from '../scripts/release-model-cache.mjs';

function repository(t) {
  const cwd=mkdtempSync(path.join(tmpdir(),'mis-release-test-'));
  t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init');git('config','user.email','release-test@example.invalid');git('config','user.name','Release test');
  const commit=(files)=>{
    for(const [name,value] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(cwd,name)),{recursive:true});writeFileSync(path.join(cwd,name),value);
    }
    git('add','.');git('commit','-m','fixture');return git('rev-parse','HEAD');
  };
  const base=commit({'src/main.jsx':'before','server.mjs':'server','package-lock.json':'{}'});
  const classify=(baseline=base,options={})=>classifyRelease({cwd,baseUrl:'https://test.example.invalid',fetchImpl:async()=>({ok:true,json:async()=>({commit:baseline})}),...options});
  return {cwd,git,commit,base,classify};
}

test('frontend changes with documentation use the deployed ancestor as baseline',async t=>{
  const r=repository(t);
  r.commit({'src/main.jsx':'after','public/logo.svg':'<svg/>','docs/change.md':'details'});
  assert.equal((await r.classify()).mode,'ui');
});

for(const file of ['server.mjs','package-lock.json','vite.config.mjs','.github/workflows/ci.yml','src/scan-field-review.mjs','public/worker.js','test/example.test.mjs','src/.hidden.js']) {
  test(`protected file ${file} forces full validation`,async t=>{
    const r=repository(t);r.commit({'src/main.jsx':'after',[file]:'changed'});
    assert.equal((await r.classify()).mode,'full');
  });
}

test('backend changes in an earlier undeployed commit cannot sneak into the UI path',async t=>{
  const r=repository(t);r.commit({'server.mjs':'backend change'});r.commit({'src/main.jsx':'after'});
  assert.equal((await r.classify()).mode,'full');
});

test('missing baseline, rollback, redeployment and manual override retain full checks',async t=>{
  const r=repository(t);const head=r.commit({'src/main.jsx':'after'});
  assert.equal((await r.classify(head)).mode,'full');
  assert.equal((await r.classify('a'.repeat(40))).mode,'full');
  assert.equal((await r.classify(undefined,{forceFull:true})).mode,'full');
  assert.equal((await r.classify(undefined,{fetchImpl:async()=>{throw Error('offline')}})).mode,'full');
  assert.equal((await r.classify(undefined,{fetchImpl:async()=>({ok:false})})).mode,'full');
  assert.equal((await r.classify(undefined,{baseUrl:''})).mode,'full');
  r.git('checkout','--detach',r.base);
  assert.equal((await r.classify(head)).mode,'full');
});

test('renaming a backend file into src cannot bypass full checks',async t=>{
  const r=repository(t);r.git('mv','server.mjs','src/server.js');r.git('commit','-m','rename');
  assert.equal((await r.classify()).mode,'full');
});

test('symlink frontend files do not qualify for the UI path',async t=>{
  const r=repository(t);
  const blob=r.git('hash-object','-w','--stdin');
  r.git('update-index','--add','--cacheinfo',`120000,${blob},src/link.js`);r.git('commit','-m','symlink');
  assert.equal((await r.classify()).mode,'full');
});

test('model cache must match validated inputs and every cached file',async t=>{
  const root=mkdtempSync(path.join(tmpdir(),'mis-model-cache-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(path.join(root,'scripts'));mkdirSync(path.join(root,'ocr-model-cache'));
  for(const name of ['package-lock.json','handwritten-card-ocr.mjs','scripts/prepare-handwriting-model.mjs']) writeFileSync(path.join(root,name),'fixture');
  const model=path.join(root,'ocr-model-cache/model.bin');writeFileSync(model,'model');
  assert.equal(await verifyModelCache(root),false);
  const seal=async()=>writeFileSync(path.join(root,'ocr-model-cache/.release-verified.json'),JSON.stringify(await modelCacheManifest(root)));
  await seal();assert.equal(await verifyModelCache(root),true);
  writeFileSync(model,'corrupted');assert.equal(await verifyModelCache(root),false);
  await seal();writeFileSync(path.join(root,'package-lock.json'),'changed');assert.equal(await verifyModelCache(root),false);
  await seal();rmSync(model);assert.equal(await verifyModelCache(root),false);
});

test('both release workflows preserve approval, complete packaging and full fallback',()=>{
  const load=name=>readFileSync(new URL(`../.github/workflows/${name}`,import.meta.url),'utf8');
  const production=load('main_caliber-mis-783.yml'),stage=load('main_caliber-mis-test.yml');
  assert.match(production,/environment:\s+name: production/);
  assert.match(production,/required_reviewers/);
  assert.match(production,/tags:\s+- 'release-\*'/);
  assert.doesNotMatch(production,/branches: \[main\]/);
  for(const source of [production,stage]) {
    assert.match(source,/fetch-depth: 0/);
    assert.match(source,/run: node scripts\/classify-ui-release.mjs/);
    assert.match(source,/CANDIDATE_MODE.*ui.*&& node scripts\/release-model-cache.mjs/);
    assert.match(source,/Run full test suite\s+if: steps.lane.outputs.mode != 'ui'/);
    assert.match(source,/run: node scripts\/test-release-ui.mjs/);
    assert.match(source,/uses: \.\/\.github\/actions\/check-logbook-layout/);
    assert.match(source,/package: \./);
    assert.match(source,/verify-ui-release.mjs --live/);
  }
  const ci=load('ci.yml');
  assert.doesNotMatch(ci,/^  push:/m);
  assert.equal((ci.match(/run: npm run build/g)||[]).length,1);
  assert.match(ci,/needs: build/);
  assert.match(ci,/uses: actions\/download-artifact@v4/);
  const layout=readFileSync(new URL('../.github/actions/check-logbook-layout/action.yml',import.meta.url),'utf8');
  assert.match(layout,/npm install --prefix "\$RUNNER_TEMP\/mis-layout-tools"/);
  assert.doesNotMatch(layout,/run: npm install --no-save/,'layout tooling must not change packaged runtime dependencies');
});
