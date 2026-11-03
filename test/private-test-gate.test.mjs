import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createPrivateGate,privateGateEnabled} from '../private-test-gate.mjs';
import {hashPassword} from '../password-auth.mjs';

const PASSWORD='Test-Gate-Password-1';
const baseEnv={
  PRIVATE_GATE:'on',
  PRIVATE_GATE_PASSWORD_HASH:hashPassword(PASSWORD),
  PRIVATE_GATE_SECRET:'x'.repeat(40),
  PRIVATE_GATE_TELEGRAM_BOT_TOKEN:'123:fake',
  PRIVATE_GATE_TELEGRAM_CHAT_ID:'987654',
};

async function start(env,{failTelegram=false}={}){
  const sent=[];
  const fetchImpl=async(url,options)=>{
    sent.push({url,body:JSON.parse(options.body)});
    if(failTelegram)return new Response(JSON.stringify({ok:false,description:'chat not found'}),{status:400});
    return new Response(JSON.stringify({ok:true}),{status:200});
  };
  const app=express();
  const gate=createPrivateGate({env,fetchImpl,log:{}});
  app.use(gate.middleware);
  app.get('/api/health',(req,res)=>res.json({status:'ok'}));
  app.get('/api/data',(req,res)=>res.json({secret:true}));
  app.get('/',(req,res)=>res.send('app shell'));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(path,{method='GET',body,cookie}={})=>fetch(base+path,{method,redirect:'manual',
    headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  return {sent,call,close:()=>new Promise(resolve=>server.close(resolve))};
}

const codeFrom=sent=>sent.at(-1).body.text.match(/code: (\d{6})/)[1];

test('gate is off unless PRIVATE_GATE is on', async()=>{
  assert.equal(privateGateEnabled({}),false);
  const app=await start({});
  try{
    assert.equal(await (await app.call('/api/data')).status,200);
  }finally{await app.close();}
});

test('health stays open; pages redirect to the gate; API answers 401', async()=>{
  const app=await start(baseEnv);
  try{
    assert.equal((await app.call('/api/health')).status,200);
    const page=await app.call('/');
    assert.equal(page.status,302);
    assert.match(page.headers.get('location'),/^\/__private-gate\?next=/);
    assert.equal((await app.call('/api/data')).status,401);
    const gatePage=await app.call('/__private-gate');
    assert.equal(gatePage.status,200);
    assert.match(await gatePage.text(),/Send Telegram code/);
  }finally{await app.close();}
});

test('wrong password sends nothing to Telegram', async()=>{
  const app=await start(baseEnv);
  try{
    const response=await app.call('/__private-gate/password',{method:'POST',body:{password:'nope'}});
    assert.equal(response.status,401);
    assert.equal(app.sent.length,0);
  }finally{await app.close();}
});

test('password then Telegram code opens the site; the code goes only to the owner chat', async()=>{
  const app=await start(baseEnv);
  try{
    const step1=await app.call('/__private-gate/password',{method:'POST',body:{password:PASSWORD}});
    assert.equal(step1.status,200);
    const {challengeId}=await step1.json();
    assert.equal(app.sent.length,1);
    assert.equal(app.sent[0].body.chat_id,'987654');
    assert.match(app.sent[0].url,/bot123:fake\/sendMessage$/);
    const wrong=await app.call('/__private-gate/otp',{method:'POST',body:{challengeId,code:'000000'===codeFrom(app.sent)?'111111':'000000'}});
    assert.equal(wrong.status,401);
    const right=await app.call('/__private-gate/otp',{method:'POST',body:{challengeId,code:codeFrom(app.sent)}});
    assert.equal(right.status,200);
    const cookie=right.headers.get('set-cookie').split(';')[0];
    assert.match(right.headers.get('set-cookie'),/HttpOnly/i);
    assert.equal((await app.call('/api/data',{cookie})).status,200);
    assert.equal((await app.call('/',{cookie})).status,200);
    const reused=await app.call('/__private-gate/otp',{method:'POST',body:{challengeId,code:codeFrom(app.sent)}});
    assert.equal(reused.status,401,'a code works once');
  }finally{await app.close();}
});

test('a forged or foreign cookie is refused', async()=>{
  const app=await start(baseEnv);
  try{
    const forged=`pulse_private_gate=v1.${Date.now()+60000}.abc.${'A'.repeat(43)}`;
    assert.equal((await app.call('/api/data',{cookie:forged})).status,401);
  }finally{await app.close();}
});

test('five wrong codes cancel the challenge', async()=>{
  const app=await start(baseEnv);
  try{
    const {challengeId}=await (await app.call('/__private-gate/password',{method:'POST',body:{password:PASSWORD}})).json();
    const real=codeFrom(app.sent);
    const bad=real==='123456'?'654321':'123456';
    let last;
    for(let i=0;i<5;i++)last=await app.call('/__private-gate/otp',{method:'POST',body:{challengeId,code:bad}});
    assert.equal((await last.json()).restart,true);
    const late=await app.call('/__private-gate/otp',{method:'POST',body:{challengeId,code:real}});
    assert.equal(late.status,401);
  }finally{await app.close();}
});

test('a second code within a minute is refused', async()=>{
  const app=await start(baseEnv);
  try{
    assert.equal((await app.call('/__private-gate/password',{method:'POST',body:{password:PASSWORD}})).status,200);
    assert.equal((await app.call('/__private-gate/password',{method:'POST',body:{password:PASSWORD}})).status,429);
    assert.equal(app.sent.length,1);
  }finally{await app.close();}
});

test('Telegram failure is reported and does not open the site', async()=>{
  const app=await start(baseEnv,{failTelegram:true});
  try{
    assert.equal((await app.call('/__private-gate/password',{method:'POST',body:{password:PASSWORD}})).status,502);
  }finally{await app.close();}
});

test('switched on but incomplete: every page is locked, health stays open', async()=>{
  const app=await start({PRIVATE_GATE:'on'});
  try{
    const page=await app.call('/');
    assert.equal(page.status,503);
    assert.match(await page.text(),/PRIVATE_GATE_PASSWORD_HASH/);
    assert.equal((await app.call('/api/data')).status,503);
    assert.equal((await app.call('/api/health')).status,200);
  }finally{await app.close();}
});
