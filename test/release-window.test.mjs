import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
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

test('scheduled windows wait for the start date; a manual run always releases',()=>{
  const dir=repo();
  try{
    const live=commit(dir,'server.mjs','a');
    const head=commit(dir,'server.mjs','b');
    assert.equal(decide(dir,{live,head,today:'2026-11-14'}),'false');
    assert.equal(decide(dir,{live,head,today:'2026-11-15'}),'true');
    assert.equal(decide(dir,{event:'workflow_dispatch',live:head,head,today:'2026-11-14'}),'true');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('an unknown live commit releases, so production never stays behind main',()=>{
  const dir=repo();
  try{
    const head=commit(dir,'server.mjs','a');
    assert.equal(decide(dir,{live:'not-a-commit',head}),'true');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
