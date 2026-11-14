import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dueWindow,createReleaseWindowTrigger,BACKUP_CHOICE,RELEASE_TRIGGER_SETTING_KEY} from '../server/services/release-window-trigger.mjs';

const ist=(date,hhmm)=>Date.parse(`${date}T${hhmm}:00+05:30`);

test('a start is due from 1 to 20 minutes after each IST window',()=>{
  assert.equal(dueWindow(ist('2026-11-15','12:00')),null);
  assert.equal(dueWindow(ist('2026-11-15','12:01')),'2026-11-15 12:00 IST');
  assert.equal(dueWindow(ist('2026-11-15','15:20')),'2026-11-15 15:00 IST');
  assert.equal(dueWindow(ist('2026-11-15','18:21')),null);
  assert.equal(dueWindow(ist('2026-11-16','00:05')),'2026-11-16 00:00 IST');
  assert.equal(dueWindow(ist('2026-11-15','06:00')),null);
  assert.equal(dueWindow(ist('2026-11-15','06:01')),'2026-11-15 06:00 IST');
  assert.equal(dueWindow(ist('2026-11-15','09:20')),'2026-11-15 09:00 IST');
  assert.equal(dueWindow(ist('2026-11-15','21:05')),'2026-11-15 21:00 IST');
  assert.equal(dueWindow(ist('2026-11-15','03:05')),null,'no window at 03:00');
  assert.equal(dueWindow(ist('2026-11-15','23:59')),null);
});

// app_settings with the claim semantics of the real query.
const fakePool=()=>{
  const settings=new Map();
  return {settings,async query(sql,params){
    if(sql.startsWith('INSERT INTO app_settings')){
      const current=settings.get(params[0]);
      if(current&&current.window===params[2]&&current.status!=='failed')return {rowCount:0,rows:[]};
      settings.set(params[0],JSON.parse(params[1]));return {rowCount:1,rows:[{}]};
    }
    if(sql.startsWith('UPDATE app_settings')){settings.set(params[0],JSON.parse(params[1]));return {rowCount:1};}
    throw Error('unexpected '+sql);
  }};
};

test('one start per window, shared by every server instance; a failed start is retried',async()=>{
  const pool=fakePool(),calls=[],clock={now:ist('2026-11-15','12:02')};
  let reply=204;
  const fetchImpl=async(url,options)=>{calls.push({url,options});return {status:reply}};
  const log={log(){},error(){}};
  const a=createReleaseWindowTrigger({pool,token:'tok',fetchImpl,now:()=>clock.now,log});
  const b=createReleaseWindowTrigger({pool,token:'tok',fetchImpl,now:()=>clock.now,log});
  assert.equal((await a.tick()).status,'started');
  assert.equal(await b.tick(),null,'the other instance finds the window claimed');
  assert.equal(await a.tick(),null);
  assert.equal(calls.length,1);
  const {url,options}=calls[0];
  assert.equal(url,'https://api.github.com/repos/caliberaitech783-beep/caliber-mis/actions/workflows/main_caliber-mis-783.yml/dispatches');
  assert.equal(options.headers.authorization,'Bearer tok');
  assert.deepEqual(JSON.parse(options.body),{ref:'main',inputs:{when:BACKUP_CHOICE}});
  assert.equal(pool.settings.get(RELEASE_TRIGGER_SETTING_KEY).status,'started');

  clock.now=ist('2026-11-15','15:01');reply=401;
  assert.deepEqual((({status,httpStatus})=>({status,httpStatus}))(await a.tick()),{status:'failed',httpStatus:401});
  reply=204;clock.now=ist('2026-11-15','15:02');
  assert.equal((await b.tick()).status,'started','a failed start is retried within the window');
  assert.equal(calls.length,3);

  clock.now=ist('2026-11-15','16:00');
  assert.equal(await a.tick(),null,'outside the window nothing is sent');
  assert.equal(calls.length,3);
});

test('without a token nothing is sent, and the choice matches the workflow exactly',async()=>{
  const calls=[];
  const t=createReleaseWindowTrigger({pool:fakePool(),token:'',fetchImpl:async()=>{calls.push(1);return {status:204}},now:()=>ist('2026-11-15','12:02')});
  assert.equal(t.state.configured,false);
  assert.equal(await t.tick(),null);
  assert.equal(calls.length,0);
  const workflow=readFileSync(new URL('../.github/workflows/main_caliber-mis-783.yml',import.meta.url),'utf8');
  assert.ok(workflow.includes(`- '${BACKUP_CHOICE}'`),'the workflow offers the backup choice');
});
