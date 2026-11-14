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
const decide=(dir,{event='schedule',live,head,today='2026-11-20'})=>{
  const scratch=mkdtempSync(path.join(tmpdir(),'release-window-io-'));const output=path.join(scratch,'output');
  const health=path.join(scratch,'health.json');
  writeFileSync(output,'');
  writeFileSync(health,JSON.stringify({status:'ok',commit:live}));
  execFileSync('bash',[script],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:event,RELEASE_COMMIT:head,SCHEDULE_STARTS:'2026-11-15',GITHUB_OUTPUT:output,RELEASE_WINDOW_TODAY:today,RELEASE_WINDOW_HEALTH_FILE:health}});
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
const dispatch=async({when,otp='',now=Date.parse('2026-11-15T07:00:00Z'),api})=>{
  const calls=[];
  const server=createServer((req,res)=>{
    let body='';req.on('data',d=>body+=d).on('end',()=>{
      if(req.url.startsWith('/token'))return res.end(JSON.stringify({value:req.headers.authorization==='bearer request-token'&&req.url.includes('audience=pulse-ii-release')?'oidc-jwt':''}));
      calls.push({path:req.url,auth:req.headers.authorization,body:body?JSON.parse(body):null});
      const [status,payload]=api(req.url,body?JSON.parse(body):{});
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
      ACTIONS_ID_TOKEN_REQUEST_URL:`${base}/token?x=1`,ACTIONS_ID_TOKEN_REQUEST_TOKEN:'request-token'}});
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
  assert.deepEqual(r.calls.map(c=>[c.path,c.auth]),[['/api/release-otp/request','Bearer oidc-jwt']]);
  assert.match(r.summary,/OTP was sent to the owner on Telegram\..*within 10 minutes\. Nothing was deployed yet\./);
  const failed=await dispatch({when:URGENT,api:()=>[429,{error:'Wait a minute.'}]});
  assert.equal(failed.code,1);assert.equal(failed.deploy,'');assert.match(failed.summary,/could not be sent\. Wait a minute\./);
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
