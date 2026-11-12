import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {uiDeltaPlan} from '../scripts/ui-delta-plan.mjs';
import {applyUiDelta,missingUiAssets} from '../scripts/deploy-ui-delta.mjs';
import {focusedSourceTests} from '../scripts/release-test-plan.mjs';

const baseline='a'.repeat(40), current='b'.repeat(40);
const context={baseline,current,healthy:true};
const change=(path,status='M')=>({path,status});
const eligible=uiDeltaPlan([change('src/reports-workspace.css')],context);

test('immutable assets are preserved and only absent assets are uploaded',async()=>{
 const result=await missingUiAssets(['vendor.js','new.js'],{
  readLocal:async file=>Buffer.from(file),
  readRemote:async file=>file==='vendor.js'?Buffer.from(file):null
 });
 assert.deepEqual(result,['new.js']);
});

test('an existing asset with different bytes blocks the delta before writes',async()=>{
 await assert.rejects(missingUiAssets(['vendor.js'],{
  readLocal:async()=>Buffer.from('expected'),readRemote:async()=>Buffer.from('different')
 }),/existing immutable UI asset differs/);
 await assert.rejects(missingUiAssets(['vendor.js'],{
  readLocal:async()=>Buffer.from('expected'),readRemote:async()=>{throw Error('read unavailable');}
 }),/read unavailable/);
});

test('only existing allowlisted UI files can use additive deployment',()=>{
 assert.equal(eligible.eligible,true);
 for(const file of ['server.mjs','shared/fleet-reconciliation-summary.mjs','package.json','package-lock.json','public/index.html','src/main.jsx','src/bulk-card-scanning.jsx','.github/workflows/main_caliber-mis-783.yml','src/../server.mjs','src/.private.css']){
  assert.equal(uiDeltaPlan([change('src/reports-workspace.css'),change(file)],context).eligible,false,file);
 }
 for(const status of ['A','D','R100'])assert.equal(uiDeltaPlan([change('src/reports-workspace.css',status)],context).eligible,false,status);
 for(const overrides of [{healthy:false},{baseline:current},{baseline:'invalid'},{current:'invalid'}])assert.equal(uiDeltaPlan([change('src/reports-workspace.css')],{...context,...overrides}).eligible,false);
 assert.equal(uiDeltaPlan([],context).eligible,false);
});

test('source-based focused tests include regressions mentioning each changed component',()=>{
 assert.deepEqual(focusedSourceTests(['src/reports-workspace.css'],[
  {file:'test/relevant.test.mjs',source:"read('src/reports-workspace.css')"},
  {file:'test/unrelated.test.mjs',source:"read('server.mjs')"}
 ]),['test/relevant.test.mjs']);
});

test('existing controller patches avoid runtime transfer while retaining full validation',()=>{
 const files=['scripts/deploy-ui-delta.mjs','scripts/ui-delta-plan.mjs','test/ui-delta-deployment.test.mjs'];
 const plan=uiDeltaPlan(files.map(file=>change(file)),context);
 assert.equal(plan.eligible,true);
 for(const file of ['server.mjs','src/main.jsx','package-lock.json','scripts/configure-gemini-azure.py'])assert.equal(uiDeltaPlan([...files.map(file=>change(file)),change(file)],context).eligible,false,file);
 assert.equal(uiDeltaPlan([change('scripts/deploy-ui-delta.mjs','A')],context).eligible,false);
});

const fixture=failAt=>{
 const calls=[];
 const ops=Object.fromEntries(['backup','assertBaseline','publishAssets','publishSources','publishIdentity','restart','verify','restore'].map(name=>[name,async arg=>{
  calls.push([name,arg]);
  if(name===failAt){failAt='';throw Error('injected failure');}
  if(name==='backup')return {saved:true};
 }]));
 return {ops,calls};
};

test('new assets precede the entry point and successful release identity is verified',async()=>{
 const {ops,calls}=fixture();
 assert.deepEqual(await applyUiDelta(ops,eligible),{applied:true});
 assert.deepEqual(calls.map(([name])=>name),['backup','assertBaseline','publishAssets','publishSources','publishIdentity','restart','verify']);
 assert.equal(calls.at(-1)[1],current);
});

test('unavailable backup falls back before any live write',async()=>{
 const {ops,calls}=fixture('backup');
 assert.deepEqual(await applyUiDelta(ops,eligible),{applied:false});
 assert.deepEqual(calls.map(([name])=>name),['backup']);
});

test('a concurrent or unhealthy release blocks all writes',async()=>{
 const {ops,calls}=fixture('assertBaseline');
 await assert.rejects(applyUiDelta(ops,eligible));
 assert.deepEqual(calls.map(([name])=>name),['backup','assertBaseline']);
});

for(const failAt of ['publishAssets','publishSources','publishIdentity','restart','verify'])test('failure during '+failAt+' restores and verifies the exact previous release',async()=>{
 const {ops,calls}=fixture(failAt);
 await assert.rejects(applyUiDelta(ops,eligible),/previous UI was restored and verified/);
 assert.deepEqual(calls.slice(-3).map(([name])=>name),['restore','restart','verify']);
 assert.equal(calls.at(-1)[1],baseline);
});

test('failed automatic restore remains a failed release',async()=>{
 const {ops}=fixture('publishAssets');ops.restore=async()=>{throw Error('restore unavailable');};
 await assert.rejects(applyUiDelta(ops,eligible),/automatic restore could not be verified/);
});

test('delta API uses additive uploads, preserves complete fallback, and never cleans files',()=>{
 const source=readFileSync(new URL('../scripts/deploy-ui-delta.mjs',import.meta.url),'utf8');
 const workflow=readFileSync(new URL('../.github/workflows/main_caliber-mis-783.yml',import.meta.url),'utf8');
 assert.match(source,/api\/zip\/site\/wwwroot\/dist\/app-assets\//);
 assert.doesNotMatch(source,/api\/zip\/site\/wwwroot\/dist\/'/);
 assert.match(source,/path\.resolve\('dist\/app-assets'\)/);
 assert.match(source,/input:newAssets\.join/);
 assert.doesNotMatch(source,/previous-dist.zip|backup.archive/);
 assert.match(source,/'dist\/index.html', 'dist\/app-version.txt', 'DEPLOYMENT_SHA'/);
 assert.doesNotMatch(source,/method:\s*['"]DELETE|api\/zipdeploy|npm.*prune|rmSync|unlink/);
 assert.match(workflow,/if: steps\.ui-delta\.outputs\.applied != 'true'/);
 assert.match(workflow,/package: \$\{\{ runner\.temp \}\}\/pulse-runtime/);
 assert.match(workflow,/node scripts\/deploy-ui-delta\.mjs/);
 assert.match(workflow,/retention-days: 14/);
});
