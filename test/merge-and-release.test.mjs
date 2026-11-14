import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const execFileAsync=promisify(execFile);
const script=path.resolve('scripts/merge-and-release.sh');
const ID='0b7c6f8e-1d2a-4c3b-9e8f-112233445566',HEAD='b'.repeat(40);

// A fake gh: answers from the PR JSON in FAKE_PR and records every call in FAKE_GH_LOG.
const FAKE_GH=`#!/usr/bin/env bash
echo "$*" >> "$FAKE_GH_LOG"
case "$*" in
  "pr view "*"--jq .headRefOid"*) echo "\${FAKE_HEAD_NOW}";;
  "pr view "*"--jq .mergeCommit.oid"*) echo "cccccccccccccccccccccccccccccccccccccccc";;
  "pr view "*) cat "$FAKE_PR";;
  "pr merge "*) exit "\${FAKE_MERGE_EXIT:-0}";;
  "workflow run "*) exit 0;;
  *) exit 3;;
esac
`;
const pr=(extra={})=>({state:'OPEN',isDraft:false,baseRefName:'main',headRefOid:HEAD,title:'Join sheet 2 of a VLB trip card to sheet 1',mergeable:'MERGEABLE',additions:176,deletions:20,changedFiles:11,
 statusCheckRollup:[{name:'build',status:'COMPLETED',conclusion:'SUCCESS'},{name:'logbook-layout',status:'COMPLETED',conclusion:'SUCCESS'}],url:'https://github.com/x/pull/300',...extra});

async function run({prJson=pr(),answers=[{status:'approved',decidedBy:'Mohit Chadda'}],headNow=HEAD,mergeExit=0,input='300'}={}){
 const dir=mkdtempSync(path.join(tmpdir(),'merge-release-'));
 const fake=path.join(dir,'bin');
 const {mkdirSync}=await import('node:fs');mkdirSync(fake);
 writeFileSync(path.join(fake,'gh'),FAKE_GH,{mode:0o755});
 const prFile=path.join(dir,'pr.json'),log=path.join(dir,'gh.log'),summary=path.join(dir,'summary');
 writeFileSync(prFile,JSON.stringify(prJson));writeFileSync(log,'');writeFileSync(summary,'');
 const calls=[];let polls=0;
 const server=createServer((req,res)=>{let body='';req.on('data',d=>body+=d).on('end',()=>{
  if(req.url.startsWith('/token'))return res.end(JSON.stringify({value:'oidc-jwt'}));
  calls.push({path:req.url,body:body?JSON.parse(body):null});
  const answer=req.url==='/api/release-approval/request'?[200,{id:ID,sentTo:2,expiresInMinutes:10}]:req.url===`/api/release-approval/${ID}/status`?[200,answers[Math.min(polls++,answers.length-1)]]:[404,{error:'Unknown.'}];
  res.writeHead(answer[0],{'content-type':'application/json'}).end(JSON.stringify(answer[1]));
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 let code=0;
 try{
  await execFileAsync('bash',[script],{encoding:'utf8',env:{...process.env,PATH:fake+path.delimiter+process.env.PATH,FAKE_PR:prFile,FAKE_GH_LOG:log,FAKE_HEAD_NOW:headNow,FAKE_MERGE_EXIT:String(mergeExit),
   MERGE_PR:input,MERGE_REQUESTED_BY:'Claude Code session for Mohit',MERGE_COMPUTER:'MOHIT-PC',MERGE_IP:'49.36.1.2',RUN_URL:'https://github.com/x/runs/9',GITHUB_STEP_SUMMARY:summary,
   RELEASE_OTP_BASE_URL:base,ACTIONS_ID_TOKEN_REQUEST_URL:`${base}/token?x=1`,ACTIONS_ID_TOKEN_REQUEST_TOKEN:'t',RELEASE_APPROVAL_POLL_SECONDS:'0.2',RELEASE_APPROVAL_WAIT_SECONDS:'2',GH_REPO:'caliberaitech783-beep/caliber-mis'}});
 }catch(error){code=error.code;}
 server.close();
 const result={code,calls,gh:readFileSync(log,'utf8').trim().split('\n').filter(Boolean),summary:readFileSync(summary,'utf8')};
 rmSync(dir,{recursive:true,force:true});
 return result;
}

test('Approve on Telegram merges the approved head commit and starts the release with the approval',async()=>{
 const r=await run();
 assert.equal(r.code,0,r.summary);
 assert.deepEqual(r.calls[0].body,{kind:'merge-release',prNumber:'300',prTitle:'Join sheet 2 of a VLB trip card to sheet 1',prHeadSha:HEAD,changes:'11 files, +176 / -20; checks passed (2)',requestedBy:'Claude Code session for Mohit',computer:'MOHIT-PC',ip:'49.36.1.2',runUrl:'https://github.com/x/runs/9'});
 assert.ok(r.gh.includes(`pr merge 300 --merge --match-head-commit ${HEAD}`),r.gh.join('\n'));
 const release=r.gh.find(line=>line.startsWith('workflow run main_caliber-mis-783.yml'));
 assert.ok(release&&release.includes(`approval=${ID}`)&&release.includes('when=Urgent: deploy now (Mr Anoop or Mr Mohit Chadda approves on Telegram)'),release);
 assert.match(r.summary,/Approved on Telegram by Mohit Chadda\. PR #300 merged into main \(ccccccc\)\./);
});

test('Reject, no answer or new commits merge nothing',async()=>{
 for(const [answers,pattern] of [[[{status:'rejected',decidedBy:'Anoop'}],/not merged: the request was rejected by Anoop/],[[{status:'pending'}],/not merged: the request was expired/]]){
  const r=await run({answers});
  assert.equal(r.code,1);assert.match(r.summary,pattern);
  assert.ok(!r.gh.some(line=>line.startsWith('pr merge')||line.startsWith('workflow run')),r.gh.join('\n'));
 }
 const moved=await run({headNow:'d'.repeat(40)});
 assert.equal(moved.code,1);assert.match(moved.summary,/received new commits after the approval request\. Nothing was merged/);
 assert.ok(!moved.gh.some(line=>line.startsWith('pr merge')));
 const refused=await run({mergeExit:1});
 assert.equal(refused.code,1);assert.match(refused.summary,/GitHub refused to merge PR #300\. Nothing was released\./);
 assert.ok(!refused.gh.some(line=>line.startsWith('workflow run')));
});

test('a PR that is not ready is never sent for approval',async()=>{
 const cases=[
  [pr({state:'MERGED'}),/is not open/],[pr({isDraft:true}),/is a draft/],[pr({baseRefName:'release'}),/does not target main/],
  [pr({mergeable:'CONFLICTING'}),/cannot be merged as it is \(CONFLICTING\)/],
  [pr({statusCheckRollup:[{name:'build',status:'IN_PROGRESS',conclusion:''}]}),/not all green \(waiting: build\)/],
  [pr({statusCheckRollup:[{name:'build',status:'COMPLETED',conclusion:'FAILURE'}]}),/not all green \(failed: build\)/],
 ];
 for(const [prJson,pattern] of cases){
  const r=await run({prJson});
  assert.equal(r.code,1);assert.match(r.summary,pattern);assert.equal(r.calls.length,0,'no Telegram request');
 }
 const bad=await run({input:'abc'});
 assert.equal(bad.code,1);assert.match(bad.summary,/Enter the pull request number/);assert.equal(bad.gh.length,0);
});
