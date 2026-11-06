import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';

const exec=promisify(execFile);
const workflow=readFileSync(new URL('../.github/workflows/main_caliber-mis-783.yml',import.meta.url),'utf8').replaceAll('\r\n','\n');
const job=name=>workflow.split(`  ${name}:\n`)[1]?.split(/\n  [a-z_]+:\n/)[0];

test('three native test shards run the complete discovered suite exactly once',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'mis-shard-coverage-'));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
  await mkdir(path.join(root,'test'));
  for(let i=0;i<12;i++) await writeFile(path.join(root,'test',`${String(i).padStart(2,'0')}.test.mjs`),`import test from 'node:test';test('fixture-${i}',()=>{});`);
  const run=async shard=>{
    const args=['--test','--test-concurrency=4','--test-reporter=tap'];
    if(shard)args.push(`--test-shard=${shard}/3`);
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const {stdout}=await exec(process.execPath,args,{cwd:root,env,timeout:30000});
    return [...stdout.replaceAll('\r\n','\n').matchAll(/^ok \d+ - (fixture-\d+)$/gm)].map(match=>match[1]);
  };
  const expected=await run();
  const shards=await Promise.all([1,2,3].map(run));
  assert.equal(expected.length,12);
  for(const shard of shards)assert.ok(shard.length>0,'every shard executes tests');
  assert.deepEqual(shards.flat().sort(),expected.sort(),'all tests run with no omissions or duplicates');
  // A test failure in any worker must remain a failed process, not a success
  // hidden by a log pipeline or a continue-on-error step.
  await writeFile(path.join(root,'test','12.test.mjs'),"import test from 'node:test';test('fixture-failure',()=>{throw Error('expected fixture failure')});");
  const outcomes=await Promise.allSettled([1,2,3].map(run));
  assert.equal(outcomes.filter(result=>result.status==='rejected').length,1);
});

test('release gate blocks every failed, cancelled or missing test result',()=>{
  const release=job('release');
  assert.match(release,/needs: \[plan, full_tests\]/);
  const expression=release.match(/if: \$\{\{ (.+) \}\}/)[1];
  const evaluate=new Function('needs','cancelled',`return (${expression});`);
  const statuses=['success','failure','cancelled','skipped',''];
  for(const lane of ['fast','full',''])for(const planResult of statuses)for(const testResult of statuses)for(const cancelled of [false,true]){
    const expected=!cancelled&&planResult==='success'&&(lane==='fast'?testResult==='skipped':testResult==='success');
    assert.equal(evaluate({plan:{result:planResult,outputs:{lane}},full_tests:{result:testResult}},()=>cancelled),expected,JSON.stringify({lane,planResult,testResult,cancelled}));
  }
});

test('full tests keep prerequisites, isolated PostgreSQL and all three workers',()=>{
  const full=job('full_tests');
  assert.match(full,/needs: plan\n\s+if: needs.plan.outputs.lane != 'fast'/);
  assert.match(full,/fail-fast: false/);
  assert.match(full,/max-parallel: 3/);
  assert.match(full,/shard: \[1, 2, 3\]/);
  assert.match(full,/services:\n\s+startup-postgres:\n\s+image: postgres:16/);
  assert.ok(full.includes("ports: ['5432']"),'PostgreSQL receives an isolated dynamically assigned host port');
  assert.ok(full.includes('DELETION_TEST_DATABASE_URL: postgres://release_check:release_check@127.0.0.1:${{ job.services.startup-postgres.ports[5432] }}/caliber_mis'),'tests use their own PostgreSQL service port');
  assert.match(full,/npm test -- --test-concurrency=4 --test-shard=\$\{\{ matrix.shard \}\}\/3/);
  assert.doesNotMatch(full,/continue-on-error|test-name-pattern|test-skip-pattern/);
  const steps=['Install exact locked dependencies','Verify pinned handwriting model','Build complete UI','Run full test suite'];
  const order=steps.map(step=>full.indexOf(step));
  assert.ok(order.every(index=>index>=0));assert.deepEqual(order,[...order].sort((a,b)=>a-b));
  assert.doesNotMatch(full,/id-token: write|secrets\.|environment:|azure\/login|webapps-deploy/);
});

test('production identity, UI fast path, runtime checks and complete packaging stay in release job',()=>{
  const release=job('release');
  assert.match(release,/environment:\n\s+name: production\n\s+url: https:\/\/pulse-ll.cmll.in/);
  assert.match(release,/id-token: write/);
  for(const text of ['Verify pinned handwriting model','Run focused tests for approved UI/report changes','Verify complete deployment runtime','Preserve UI rollback evidence','node scripts/deploy-ui-delta.mjs','package: .','node scripts/verify-ui-release.mjs --live'])assert.ok(release.includes(text),text);
  assert.doesNotMatch(release,/run: npm test/,'full tests must finish before entering deployment');
  assert.match(release,/PLAN_LANE: \$\{\{ needs.plan.outputs.lane \}\}/);
  for(const name of ['plan','full_tests','release'])assert.match(job(name),/ref: \$\{\{ github.sha \}\}/,'all jobs check out the same immutable commit');
});
