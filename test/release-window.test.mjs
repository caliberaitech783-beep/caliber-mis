import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// scripts/release-window.sh decides whether a scheduled production window
// (12:00, 15:00, 18:00, 00:00 IST) releases main.
const script=fileURLToPath(new URL('../scripts/release-window.sh',import.meta.url));
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();

const repo=()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'release-window-'));
  git(dir,'init','-q');
  git(dir,'config','user.email','test@example.com');
  git(dir,'config','user.name','test');
  git(dir,'config','commit.gpgsign','false');
  return dir;
};
const commit=(dir,file,text)=>{
  mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});
  writeFileSync(path.join(dir,file),text);
  git(dir,'add','-A');
  git(dir,'commit','-q','-m',file);
  return git(dir,'rev-parse','HEAD');
};
const decide=(dir,{event='schedule',when='',live,head,today='2026-11-20',now=Date.parse('2026-11-20T06:40:00Z')})=>{ // 12:10 IST
  const scratch=mkdtempSync(path.join(tmpdir(),'release-window-io-'));const output=path.join(scratch,'output');
  const health=path.join(scratch,'health.json');
  writeFileSync(output,'');
  writeFileSync(health,JSON.stringify({status:'ok',commit:live}));
  execFileSync('bash',[script],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:event,RELEASE_COMMIT:head,SCHEDULE_STARTS:'2026-11-15',GITHUB_OUTPUT:output,RELEASE_WINDOW_TODAY:today,RELEASE_WINDOW_NOW_MS:String(now),RELEASE_WHEN:when,RELEASE_WINDOW_HEALTH_FILE:health}});
  const result=/deploy=(true|false)/.exec(readFileSync(output,'utf8'))[1];
  rmSync(scratch,{recursive:true,force:true});
  return result;
};

test('a window releases all changes merged since the live commit',()=>{
  const dir=repo();
  try{
    const live=commit(dir,'server.mjs','a');
    commit(dir,'src/app.jsx','b');
    const head=commit(dir,'server/routes/x.mjs','c');
    assert.equal(decide(dir,{live,head}),'true');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a window with nothing new or only documentation skips the release',()=>{
  const dir=repo();
  try{
    const live=commit(dir,'server.mjs','a');
    assert.equal(decide(dir,{live,head:live}),'false');
    commit(dir,'docs/notes.md','b');
    const head=commit(dir,'README.md','c');
    assert.equal(decide(dir,{live,head}),'false');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('scheduled windows wait for the start date',()=>{
  const dir=repo();
  try{
    const live=commit(dir,'server.mjs','a');
    const head=commit(dir,'server.mjs','b');
    assert.equal(decide(dir,{live,head,today:'2026-11-14'}),'false');
    assert.equal(decide(dir,{live,head,today:'2026-11-15'}),'true');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

// Run workflow: a fake GitHub identity endpoint and a fake Pulse-II release OTP API.
const dispatch=async({when,otp='',now=Date.parse('2026-11-15T07:00:00Z'),api,actor='someone-else',owner='caliberaitech783-beep',env={}})=>{
  const calls=[];
  const server=createServer((req,res)=>{
    let body='';req.on('data',d=>body+=d).on('end',()=>{
      if(req.url.startsWith('/token'))return res.end(JSON.stringify({value:req.headers.authorization==='bearer request-token'&&req.url.includes('audience=pulse-ii-release')?'oidc-jwt':''}));
      calls.push({path:req.url,auth:req.headers.authorization,body:body?JSON.parse(body):null});
      const [status,payload]=api(req.url,body?JSON.parse(body):{});
      // A string payload is an HTML error page, as Express sends for an unknown route.
      if(typeof payload==='string')return res.writeHead(status,{'content-type':'text/html'}).end(payload);
      res.writeHead(status,{'content-type':'application/json'}).end(JSON.stringify(payload));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const scratch=mkdtempSync(path.join(tmpdir(),'release-window-io-')),output=path.join(scratch,'output'),summaryFile=path.join(scratch,'summary');
  writeFileSync(output,'');writeFileSync(summaryFile,'');
  let code=0;
  try{
    await execFileAsync('bash',[script],{encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'workflow_dispatch',RELEASE_COMMIT:'x',GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:summaryFile,
      RELEASE_WHEN:when,RELEASE_OTP:otp,RELEASE_WINDOW_NOW_MS:String(now),RELEASE_OTP_BASE_URL:base,
      ACTIONS_ID_TOKEN_REQUEST_URL:`${base}/token?x=1`,ACTIONS_ID_TOKEN_REQUEST_TOKEN:'request-token',GITHUB_ACTOR:actor,GITHUB_REPOSITORY_OWNER:owner,RELEASE_APPROVAL_POLL_SECONDS:'0',RELEASE_APPROVAL_WAIT_SECONDS:'3',...env}});
  }catch(error){code=error.code;}
  server.close();
  const result={code,calls,deploy:/deploy=(true|false)/.exec(readFileSync(output,'utf8'))?.[1]||'',summary:readFileSync(summaryFile,'utf8')};
  rmSync(scratch,{recursive:true,force:true});
  return result;
};
const URGENT='Urgent: deploy now (needs OTP from the owner)',LATER='Next scheduled window (12:00, 15:00, 18:00, 00:00 IST)';

test('Run workflow without urgency deploys nothing and names the next window',async()=>{
  const at=async iso=>(await dispatch({when:LATER,now:Date.parse(iso),api:()=>[500,{}]}));
  const r=await at('2026-11-15T07:00:00Z');   // 12:30 IST
  assert.equal(r.deploy,'false');assert.equal(r.code,0);assert.equal(r.calls.length,0);
  assert.match(r.summary,/Not urgent: no deployment now\..*next scheduled window, 15:00 IST today\./);
  assert.match((await at('2026-11-15T13:00:00Z')).summary,/00:00 IST tonight/);   // 18:30 IST
  assert.match((await at('2026-11-15T19:00:00Z')).summary,/12:00 IST today/);     // 00:30 IST
});

test('Urgent without an OTP asks Pulse-II to send one and deploys nothing yet',async()=>{
  const r=await dispatch({when:URGENT,api:()=>[200,{recipient:'owner on Telegram',expiresInMinutes:10}]});
  assert.equal(r.deploy,'false');assert.equal(r.code,0);
  // No approval id came back, so the run falls back to the OTP.
  assert.deepEqual(r.calls.map(c=>[c.path,c.auth]),[['/api/release-otp/request-approval','Bearer oidc-jwt'],['/api/release-otp/request','Bearer oidc-jwt']]);
  assert.match(r.summary,/OTP was sent to the owner on Telegram\..*within 10 minutes\. Nothing was deployed yet\./);
  const failed=await dispatch({when:URGENT,api:()=>[429,{error:'Wait a minute.'}]});
  assert.equal(failed.code,1);assert.equal(failed.deploy,'');assert.match(failed.summary,/could not be sent\. Wait a minute\./);
  // Before Pulse-II has the endpoint it answers an HTML 404: the reason still shows.
  const missing=await dispatch({when:URGENT,api:()=>[404,'<!DOCTYPE html><pre>Cannot POST /api/release-otp/request</pre>']});
  assert.equal(missing.code,1);assert.match(missing.summary,/could not be sent\. Pulse-II answered HTTP 404: the release OTP service is not live there yet/);
  const broken=await dispatch({when:URGENT,api:()=>[502,'<html>Bad gateway</html>']});
  assert.match(broken.summary,/could not be sent\. Pulse-II answered HTTP 502\./);
  const refused=await dispatch({when:URGENT,otp:'123456',api:()=>[404,'<html></html>']});
  assert.match(refused.summary,/Urgent release refused: Pulse-II answered HTTP 404/);
});

test('before Pulse-II has the OTP service, only the repository owner can start an urgent release',async()=>{
  const notLive=()=>[404,'<!DOCTYPE html><pre>Cannot POST /api/release-otp/request</pre>'];
  const owner=await dispatch({when:URGENT,api:notLive,actor:'caliberaitech783-beep'});
  assert.equal(owner.code,0);assert.equal(owner.deploy,'true');
  assert.match(owner.summary,/does not have the release OTP service yet \(HTTP 404\).*repository owner \(caliberaitech783-beep\): releasing main now\./);
  // Anyone else, or any other failure, still stops the run.
  const other=await dispatch({when:URGENT,api:notLive,actor:'someone-else'});
  assert.equal(other.code,1);assert.equal(other.deploy,'');
  for(const api of [()=>[429,{error:'Wait a minute.'}],()=>[404,{error:'Unknown request.'}],()=>[502,'<html>Bad gateway</html>']]){
   const r=await dispatch({when:URGENT,api,actor:'caliberaitech783-beep'});
   assert.equal(r.code,1);assert.equal(r.deploy,'');
  }
  // Once the service answers, the owner needs the OTP like everyone else.
  const live=await dispatch({when:URGENT,api:()=>[200,{recipient:'owner on Telegram',expiresInMinutes:10}],actor:'caliberaitech783-beep'});
  assert.equal(live.deploy,'false');assert.match(live.summary,/OTP was sent/);
  assert.equal((await dispatch({when:URGENT,otp:'123456',api:notLive,actor:'caliberaitech783-beep'})).code,1);
});
test('Urgent sends Approve / Reject on Telegram and waits: Approve deploys, Reject or no tap stops the run',async()=>{
  const id='0123456789abcdef';
  const flow=answers=>{let n=0;return (p,body)=>p==='/api/release-otp/request-approval'?[200,{id,recipient:'owners (Mr Anoop and Mr Mohit Chadda) on Telegram',expiresInMinutes:10}]
    :p==='/api/release-otp/decision'?(assert.equal(body.id,id),[200,answers[Math.min(n++,answers.length-1)]]):[500,{}];};
  const ok=await dispatch({when:URGENT,api:flow([{status:'awaiting'},{status:'approved',by:'mohitchadda'}])});
  assert.equal(ok.code,0);assert.equal(ok.deploy,'true');
  assert.ok(ok.summary.includes('Approve / Reject was sent to the owners (Mr Anoop and Mr Mohit Chadda) on Telegram'));
  assert.match(ok.summary,/approved on Telegram by mohitchadda. Releasing main now./);
  assert.equal(ok.calls[0].body.commit,'x');
  assert.ok(!ok.calls.some(c=>c.path==='/api/release-otp/request'),'no OTP is sent when the buttons went out');
  const no=await dispatch({when:URGENT,api:flow([{status:'rejected',by:'anoop'}])});
  assert.equal(no.code,1);assert.equal(no.deploy,'');assert.match(no.summary,/rejected on Telegram by anoop. Nothing was deployed./);
  const idle=await dispatch({when:URGENT,api:flow([{status:'awaiting'}])});
  assert.equal(idle.code,1);assert.equal(idle.deploy,'');assert.match(idle.summary,/nobody tapped Approve/);
  const gone=await dispatch({when:URGENT,api:flow([{status:'expired'}])});
  assert.equal(gone.code,1);assert.match(gone.summary,/no longer active/);
});

test('Urgent with the right OTP deploys; a wrong or malformed OTP fails the run',async()=>{
  const api=(_path,body)=>body.otp==='123456'?[200,{approved:true}]:[400,{error:'Wrong OTP. 4 attempts left.'}];
  const ok=await dispatch({when:URGENT,otp:' 123456 ',api});
  assert.equal(ok.deploy,'true');assert.equal(ok.code,0);
  assert.deepEqual(ok.calls[0].body,{otp:'123456'});
  const wrong=await dispatch({when:URGENT,otp:'654321',api});
  assert.equal(wrong.code,1);assert.equal(wrong.deploy,'');assert.match(wrong.summary,/refused: Wrong OTP\. 4 attempts left\./);
  const malformed=await dispatch({when:URGENT,otp:'12ab',api});
  assert.equal(malformed.code,1);assert.equal(malformed.calls.length,0);
});

test('an unknown live commit releases, so production never stays behind main',()=>{
  const dir=repo();
  try{
    const head=commit(dir,'server.mjs','a');
    assert.equal(decide(dir,{live:'not-a-commit',head}),'true');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a window release goes out only in the hour after a window, from GitHub timer or backup trigger',()=>{
  const dir=repo();
  try{
    const live=commit(dir,'server.mjs','a');
    const head=commit(dir,'server.mjs','b');
    const BACKUP='Scheduled window now (backup trigger: releases only in the hour after a window)';
    const at=iso=>Date.parse(iso);
    // On time: 12:00, 15:59 and 00:05 IST.
    assert.equal(decide(dir,{live,head,now:at('2026-11-20T06:30:00Z')}),'true');
    assert.equal(decide(dir,{live,head,now:at('2026-11-20T10:29:00Z')}),'true');
    assert.equal(decide(dir,{live,head,now:at('2026-11-20T18:35:00Z')}),'true');
    // GitHub's timer six hours late (06:00 IST) or after the hour (13:01 IST): nothing deploys.
    assert.equal(decide(dir,{live,head,now:at('2026-11-21T00:30:00Z')}),'false');
    assert.equal(decide(dir,{live,head,now:at('2026-11-20T07:31:00Z')}),'false');
    // The backup trigger follows the same rules.
    assert.equal(decide(dir,{event:'workflow_dispatch',when:BACKUP,live,head,now:at('2026-11-20T12:32:00Z')}),'true');   // 18:02 IST
    assert.equal(decide(dir,{event:'workflow_dispatch',when:BACKUP,live,head,now:at('2026-11-20T14:00:00Z')}),'false');  // 19:30 IST
    assert.equal(decide(dir,{event:'workflow_dispatch',when:BACKUP,live:head,head,now:at('2026-11-20T12:32:00Z')}),'false','already released: a duplicate trigger finds nothing new');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

// Merge + release (15 Nov 2026): who asked travels to Telegram, and a run started by the merge workflow
// spends the approval that merged the pull request.
test('Urgent sends the requester name, computer and IP with the Approve request',async()=>{
  const id='0123456789abcdef';let asked;
  const api=(p,body)=>{if(p==='/api/release-otp/request-approval'){asked=body;return [200,{id,recipient:'owners',expiresInMinutes:10}];}return p==='/api/release-otp/decision'?[200,{status:'approved',by:'mohitchadda'}]:[500,{}];};
  const r=await dispatch({when:URGENT,api,env:{RELEASE_COMMIT:'c'.repeat(40),RELEASE_REQUESTED_BY:'Claude Code session for Mohit',RELEASE_COMPUTER:'MOHIT-PC',RELEASE_REQUESTER_IP:'49.36.1.2',RELEASE_RUN_URL:'https://github.com/x/runs/1'}});
  assert.equal(r.deploy,'true');
  assert.equal(asked.commit,'c'.repeat(40));
  assert.deepEqual([asked.requestedBy,asked.computer,asked.ip,asked.runUrl],['Claude Code session for Mohit','MOHIT-PC','49.36.1.2','https://github.com/x/runs/1']);
});
test('a release started after Approve on a pull request spends that approval once',async()=>{
  const id='0123456789abcdef';
  const ok=await dispatch({when:URGENT,api:(p,body)=>p==='/api/release-otp/decision'&&body.id===id?[200,{status:'approved',by:'anoop',prNumber:300}]:[500,{}],env:{RELEASE_APPROVAL:id}});
  assert.equal(ok.deploy,'true');assert.deepEqual(ok.calls.map(c=>c.path),['/api/release-otp/decision']);
  assert.ok(ok.summary.includes('approved on Telegram by anoop (PR #300 merged). Releasing main now.'),ok.summary);
  const spent=await dispatch({when:URGENT,api:()=>[200,{status:'used'}],env:{RELEASE_APPROVAL:id}});
  assert.equal(spent.code,1);assert.equal(spent.deploy,'');assert.ok(spent.summary.includes('the Telegram approval is used'),spent.summary);
  assert.ok(!spent.calls.some(c=>c.path.includes('request')),'never asks again or falls back to the OTP');
  const bad=await dispatch({when:URGENT,api:()=>[200,{}],env:{RELEASE_APPROVAL:'zz'}});
  assert.equal(bad.code,1);assert.equal(bad.calls.length,0);
});
