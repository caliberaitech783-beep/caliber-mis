import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const execFileAsync=promisify(execFile);
const script=path.resolve('scripts/merge-and-release.sh');
const ID='0123456789abcdef',HEAD='b'.repeat(40);

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
 statusCheckRollup:[{name:'build',status:'COMPLETED',conclusion:'SUCCESS'},{name:'logbook-layout',status:'COMPLETED',conclusion:'SUCCESS'}],url:'https://github.com/x/pull/300',
 body:'## Why\n- A second trip card sheet joins the saved first sheet\n- The site is told which card it joined\n- Third point\n## Tests\n- x',...extra});

// Pulse-II's Approve / Reject API (server/routes/release-otp.mjs): `answers` are the decisions in turn.
async function run({prJson=pr(),answers=[{status:'approved',by:'mohitchadda'}],headNow=HEAD,mergeExit=0,input='300',brief=''}={}){
 const dir=mkdtempSync(path.join(tmpdir(),'merge-release-')),fake=path.join(dir,'bin');mkdirSync(fake);
 writeFileSync(path.join(fake,'gh'),FAKE_GH,{mode:0o755});
 const prFile=path.join(dir,'pr.json'),log=path.join(dir,'gh.log'),summary=path.join(dir,'summary');
 writeFileSync(prFile,JSON.stringify(prJson));writeFileSync(log,'');writeFileSync(summary,'');
 const calls=[];let decisions=0;
 const server=createServer((req,res)=>{let body='';req.on('data',d=>body+=d).on('end',()=>{
  if(req.url.startsWith('/token'))return res.end(JSON.stringify({value:'oidc-jwt'}));
  const parsed=body?JSON.parse(body):null;calls.push({path:req.url,body:parsed});
  const answer=req.url==='/api/release-otp/request-approval'?[200,{id:ID,recipient:'owners (Mr Anoop and Mr Mohit Chadda) on Telegram',expiresInMinutes:10}]
   :req.url==='/api/release-otp/decision'&&parsed?.id===ID?[200,answers[Math.min(decisions++,answers.length-1)]]:[404,{error:'Unknown.'}];
  res.writeHead(answer[0],{'content-type':'application/json'}).end(JSON.stringify(answer[1]));
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 let code=0;
 try{
  await execFileAsync('bash',[script],{encoding:'utf8',env:{...process.env,PATH:fake+path.delimiter+process.env.PATH,FAKE_PR:prFile,FAKE_GH_LOG:log,FAKE_HEAD_NOW:headNow,FAKE_MERGE_EXIT:String(mergeExit),
   MERGE_PR:input,MERGE_BRIEF:brief,MERGE_REQUESTED_BY:'Claude Code session for Mohit',MERGE_COMPUTER:'MOHIT-PC',MERGE_IP:'49.36.1.2',RUN_URL:'https://github.com/x/runs/9',GITHUB_STEP_SUMMARY:summary,
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
 assert.deepEqual(r.calls[0],{path:'/api/release-otp/request-approval',body:{commit:HEAD,prNumber:'300',prTitle:'Join sheet 2 of a VLB trip card to sheet 1',changes:'11 files, +176 / -20; checks passed (2)',
  brief:'A second trip card sheet joins the saved first sheet\nThe site is told which card it joined',
  requestedBy:'Claude Code session for Mohit',computer:'MOHIT-PC',ip:'49.36.1.2',runUrl:'https://github.com/x/runs/9'}});
 assert.ok(r.gh.includes(`pr merge 300 --merge --match-head-commit ${HEAD}`),r.gh.join('\n'));
 const release=r.gh.find(line=>line.startsWith('workflow run main_caliber-mis-783.yml'));
 assert.ok(release&&release.includes(`approval=${ID}`)&&release.includes('when=Urgent: deploy now (needs OTP from the owner)')&&release.includes('ip=49.36.1.2'),release);
 assert.ok(r.summary.includes('Approved on Telegram by mohitchadda. PR #300 merged into main (ccccccc).'),r.summary);
});

test('a typed brief replaces the one taken from the PR description',async()=>{
 const r=await run({brief:'Approval lapses after 20 minutes | Message says what it fixes'});
 assert.equal(r.code,0,r.summary);
 assert.equal(r.calls[0].body.brief,'Approval lapses after 20 minutes | Message says what it fixes');
});

test('Reject, no tap, a closed request, new commits or a refused merge merge nothing',async()=>{
 for(const [answers,text] of [[[{status:'rejected',by:'anoop'}],'not merged: rejected on Telegram by anoop'],[[{status:'awaiting'}],'not merged: nobody tapped Approve'],[[{status:'expired'}],'no longer active']]){
  const r=await run({answers});
  assert.equal(r.code,1);assert.ok(r.summary.includes(text),r.summary);
  assert.ok(!r.gh.some(line=>line.startsWith('pr merge')||line.startsWith('workflow run')),r.gh.join('\n'));
 }
 const moved=await run({headNow:'d'.repeat(40)});
 assert.equal(moved.code,1);assert.ok(moved.summary.includes('received new commits after the approval request. Nothing was merged'),moved.summary);
 assert.ok(!moved.gh.some(line=>line.startsWith('pr merge')));
 const refused=await run({mergeExit:1});
 assert.equal(refused.code,1);assert.ok(refused.summary.includes('GitHub refused to merge PR #300. Nothing was released.'),refused.summary);
 assert.ok(!refused.gh.some(line=>line.startsWith('workflow run')));
});

test('a PR that is not ready is never sent for approval',async()=>{
 const cases=[
  [pr({state:'MERGED'}),'is not open'],[pr({isDraft:true}),'is a draft'],[pr({baseRefName:'release'}),'does not target main'],
  [pr({mergeable:'CONFLICTING'}),'cannot be merged as it is (CONFLICTING)'],
  [pr({statusCheckRollup:[{name:'build',status:'IN_PROGRESS',conclusion:''}]}),'not all green (waiting: build)'],
  [pr({statusCheckRollup:[{name:'build',status:'COMPLETED',conclusion:'FAILURE'}]}),'not all green (failed: build)'],
 ];
 for(const [prJson,text] of cases){
  const r=await run({prJson});
  assert.equal(r.code,1);assert.ok(r.summary.includes(text),r.summary);assert.equal(r.calls.length,0,'no Telegram request');
 }
 const bad=await run({input:'abc'});
 assert.equal(bad.code,1);assert.ok(bad.summary.includes('Enter the pull request number'));assert.equal(bad.gh.length,0);
});
