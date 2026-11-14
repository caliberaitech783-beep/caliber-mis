import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readFileSync} from 'node:fs';
import {registerReleaseReport,releaseReportMessage,releaseTrigger} from '../server/routes/release-report.mjs';
import {parseChanges} from '../scripts/send-release-report.mjs';

const A='a'.repeat(40),B='b'.repeat(40);
const AT=new Date('2026-11-15T06:35:00Z'); // 12:05 IST

test('changes are read from squash merges, merge commits and plain commits on main',()=>{
  const log=[
    'Merge pull request #300 from someone/fix/vlb\u001fContinue the VLB card sheet\n\nmore\u001e',
    'Release windows: one-hour limit (#296)\u001f\u001e',
    'Fix a typo\u001f\u001e',
  ].join('\n');
  assert.deepEqual(parseChanges(log),[
    {pr:'300',title:'Continue the VLB card sheet'},
    {pr:'296',title:'Release windows: one-hour limit'},
    {pr:'',title:'Fix a typo'},
  ]);
});

test('the report names how, when, the versions and every change',()=>{
  assert.equal(releaseTrigger('schedule',''),'Scheduled window (GitHub timer)');
  assert.equal(releaseTrigger('workflow_dispatch','Scheduled window now (backup trigger: ...)'),'Scheduled window (Pulse-II trigger)');
  assert.equal(releaseTrigger('workflow_dispatch','Urgent: deploy now (needs OTP from the owner)'),'Urgent release (owner OTP)');
  const done=releaseReportMessage({status:'success',trigger:'Urgent release (owner OTP)',commit:B,previous:A,changes:[{pr:'300',title:'Continue the VLB card sheet'},{pr:'',title:'Fix a typo'}],runUrl:'https://github.com/x/y/actions/runs/1',at:AT});
  assert.equal(done,[
    '✅ Pulse-II production release DONE',
    'How: Urgent release (owner OTP)',
    'Live at: 15 Nov 2026, 12:05 IST',
    'Version: bbbbbbb (before: aaaaaaa)',
    '',
    'Changes in this release (2):',
    '• #300 Continue the VLB card sheet',
    '• Fix a typo',
    '',
    'Details: https://github.com/x/y/actions/runs/1',
  ].join('\n'));
  const failed=releaseReportMessage({status:'failed',trigger:'Scheduled window (GitHub timer)',commit:B,previous:A,live:A,changes:[],at:AT});
  assert.match(failed,/^❌ Pulse-II production release FAILED\n/);
  assert.match(failed,/Tried: bbbbbbb\. Production now serves: aaaaaaa \(unchanged\)/);
});

const serve=async({identity,logins=['owner'],linked=new Set(['owner'])})=>{
  const sent=[];
  const app=express();app.use(express.json());
  registerReleaseReport(app,{verifyIdentity:async token=>{if(token!=='good')throw Object.assign(Error('Invalid release identity.'),{status:401});return identity},
    ownerLogins:async()=>logins,telegram:{send:async(login,message,key)=>{sent.push({login,message,key});return linked.has(login)}},now:()=>AT});
  const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s))});
  const post=async(body,token='good')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/release-report`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}};
  return {sent,post,close:()=>server.close()};
};

test('only the release workflow can send the report, and only to the owner on Telegram',async()=>{
  const s=await serve({identity:{event_name:'workflow_dispatch',run_id:'77',repository:'caliberaitech783-beep/caliber-mis'}});
  try{
    assert.equal((await s.post({status:'success'},'bad')).status,401);
    assert.equal(s.sent.length,0);
    const many=Array.from({length:35},(_,i)=>({pr:String(i+1),title:`Change ${i+1}\u0007`}));
    const r=await s.post({status:'success',when:'Urgent: deploy now',commit:B,previous:A,changes:many});
    assert.deepEqual(r,{status:200,body:{told:1}});
    assert.equal(s.sent[0].login,'owner');
    assert.equal(s.sent[0].key,'release-report:77:owner','one message per run');
    assert.match(s.sent[0].message,/Changes in this release \(35\):/);
    assert.match(s.sent[0].message,/• #30 Change 30\n• …and 5 more/);
    assert.doesNotMatch(s.sent[0].message,/\u0007/,'control characters are removed');
    assert.match(s.sent[0].message,/Details: https:\/\/github\.com\/caliberaitech783-beep\/caliber-mis\/actions\/runs\/77/);
  }finally{s.close()}
  const unlinked=await serve({identity:{event_name:'schedule',run_id:'78',repository:'r/r'},linked:new Set()});
  try{assert.equal((await unlinked.post({status:'success'})).status,503);}finally{unlinked.close()}
});

test('every release job ends by sending the report, done or failed',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/main_caliber-mis-783.yml',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  const release=workflow.slice(workflow.indexOf('\n  release:\n'));
  assert.match(release,/- name: Note the version Pulse-II serves before this release\n\s+continue-on-error: true/);
  assert.match(release,/- name: Send the owner the release report\n\s+if: always\(\)\n\s+continue-on-error: true\n\s+env:\n\s+RELEASE_STATUS: \$\{\{ job\.status \}\}\n\s+RELEASE_WHEN: \$\{\{ inputs\.when \}\}\n\s+run: node scripts\/send-release-report\.mjs/);
  assert.ok(release.indexOf('Note the version Pulse-II serves before this release')<release.indexOf('Deploy to the staging slot'));
  assert.ok(release.indexOf('Send the owner the release report')>release.indexOf('Stop staging if validation failed before the swap'),'the report is the last step');
});
