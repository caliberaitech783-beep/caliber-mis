import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createGithubOidcVerifier} from '../server/services/github-oidc.mjs';
import {registerReleaseOtp,RELEASE_OTP_KEY} from '../server/routes/release-otp.mjs';
import {sendReleaseOtp} from '../server/services/deletion-whatsapp.mjs';
import {createReleaseOtpDelivery} from '../server/services/release-otp-delivery.mjs';

const repository='caliberaitech783-beep/caliber-mis',workflowFile='main_caliber-mis-783.yml';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'k1',alg:'RS256',use:'sig'};
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const NOW=Date.parse('2026-11-15T10:00:00Z');
const jwt=(claims={},header={alg:'RS256',kid:'k1'})=>{
  const body={iss:'https://token.actions.githubusercontent.com',aud:'pulse-ii-release',repository,ref:'refs/heads/main',
    workflow_ref:`${repository}/.github/workflows/${workflowFile}@refs/heads/main`,actor:'dev1',run_id:'77',exp:NOW/1000+300,iat:NOW/1000,...claims};
  const unsigned=`${b64(header)}.${b64(body)}`;
  return `${unsigned}.${sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url')}`;
};
const verifier=()=>createGithubOidcVerifier({audience:'pulse-ii-release',repository,workflowFile,now:()=>NOW,
  fetchImpl:async()=>({ok:true,json:async()=>({keys:[jwk]})})});

test('only a main-branch run of the production workflow in this repository is accepted',async()=>{
  const verify=verifier();
  assert.equal((await verify(jwt())).actor,'dev1');
  const refused=[
    jwt({repository:'someone/fork'}),
    jwt({ref:'refs/heads/feature'}),
    jwt({workflow_ref:`${repository}/.github/workflows/ci.yml@refs/heads/main`}),
    jwt({aud:'other'}),
    jwt({iss:'https://example.com'}),
    jwt({exp:NOW/1000-1}),
    jwt({},{alg:'none',kid:'k1'}),
    jwt().slice(0,-4)+'AAAA',
    '',
  ];
  for(const token of refused)await assert.rejects(verify(token),error=>error.status===401,token.slice(0,30));
});

// In-memory app_settings with the queries the route uses.
const fakePool=()=>{
  const settings=new Map();
  const query=async(sql,params=[])=>{
    if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
    if(sql.startsWith('SELECT setting_value'))return {rows:settings.has(params[0])?[{setting_value:structuredClone(settings.get(params[0]))}]:[]};
    if(sql.startsWith('INSERT INTO app_settings')){settings.set(params[0],JSON.parse(params[1]));return {rows:[]};}
    throw Error('unexpected query '+sql);
  };
  return {settings,query,connect:async()=>({query,release(){}})};
};

const serve=async({clock})=>{
  const pool=fakePool(),sent=[],audits=[];
  const app=express();app.use(express.json());
  registerReleaseOtp(app,{pool,verifyIdentity:verifier(),now:()=>clock.now,sendOtp:async({otp,actor,runId})=>{assert.deepEqual([actor,runId],['dev1','77']);sent.push(otp);return {channel:'telegram'}},audit:(_req,entry)=>audits.push(entry.action)});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,body={},token=jwt())=>{const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}};
  return {pool,sent,audits,post,close:()=>server.close()};
};

test('an urgent release OTP is sent to the owner and approves exactly one release',async()=>{
  const clock={now:NOW},s=await serve({clock});
  try{
    assert.equal((await s.post('/api/release-otp/request',{},'not-a-token')).status,401);
    assert.equal(s.sent.length,0,'no OTP without a valid workflow identity');
    const requested=await s.post('/api/release-otp/request');
    assert.equal(requested.status,200);
    assert.deepEqual(requested.body,{recipient:'owners (Mr Anoop and Mr Mohit Chadda) on Telegram',expiresInMinutes:10});
    assert.equal(s.sent.length,1);
    assert.equal((await s.post('/api/release-otp/request')).status,429,'one request a minute');
    const stored=s.pool.settings.get(RELEASE_OTP_KEY);
    assert.ok(!JSON.stringify(stored).includes(s.sent[0]),'only the hash is stored');
    const wrong=s.sent[0]==='111111'?'222222':'111111';
    const refused=await s.post('/api/release-otp/verify',{otp:wrong});
    assert.equal(refused.status,400);
    assert.match(refused.body.error,/Wrong OTP\. 4 attempts left/);
    assert.deepEqual((await s.post('/api/release-otp/verify',{otp:s.sent[0]})).body,{approved:true});
    assert.match((await s.post('/api/release-otp/verify',{otp:s.sent[0]})).body.error,/already used/,'single use');
    assert.deepEqual(s.audits,['Urgent release OTP sent','Urgent release OTP rejected','Urgent release approved by OTP','Urgent release OTP rejected']);
  }finally{s.close()}
});

test('an urgent release OTP expires after ten minutes and dies after five wrong attempts',async()=>{
  const clock={now:NOW},s=await serve({clock});
  try{
    await s.post('/api/release-otp/request');
    clock.now+=10*60000+1;
    assert.match((await s.post('/api/release-otp/verify',{otp:s.sent[0]})).body.error,/expired/);
    clock.now+=60000;
    await s.post('/api/release-otp/request');
    const wrong=s.sent[1]==='111111'?'222222':'111111';
    for(let i=0;i<4;i++)await s.post('/api/release-otp/verify',{otp:wrong});
    assert.match((await s.post('/api/release-otp/verify',{otp:wrong})).body.error,/Too many wrong attempts/);
    assert.match((await s.post('/api/release-otp/verify',{otp:s.sent[1]})).body.error,/cancelled/);
  }finally{s.close()}
});

test('the release OTP goes to the owner on Telegram, and to WhatsApp only when Telegram is not linked',async()=>{
  const users=[
    {login:'Anoop',mobile:'+91 99255 65281'},
    {login:'anoop.admin',phone:'9925565281'},
    {login:'someone',mobile:'9000000000'},
  ];
  const pool={query:async sql=>{assert.match(sql,/Users & employees/);return {rows:users.map(record_data=>({record_data}))}}};
  const linked=new Set(['anoop.admin']),telegrams=[],whatsapps=[];
  const telegram={send:async(login,message,key)=>{telegrams.push({login,message,key});return linked.has(login)}};
  const deliver=createReleaseOtpDelivery({pool,telegram,whatsapp:async({otp})=>{whatsapps.push(otp)},alsoLogins:[]});
  const both=createReleaseOtpDelivery({pool,telegram,whatsapp:async({otp})=>{whatsapps.push(otp)},alsoLogins:['MohitChadda']});
  assert.deepEqual(await deliver({otp:'123456',actor:'dev1',runId:'77'}),{channel:'telegram'});
  assert.deepEqual(telegrams.map(t=>t.login),['anoop','anoop.admin'],'only logins registered to the owner number');
  assert.match(telegrams[1].message,/OTP: 123456\nRequested by: dev1 \(GitHub run 77\)\nValid for 10 minutes/);
  assert.equal(telegrams[1].key,'release-otp:77:anoop.admin');
  assert.equal(whatsapps.length,0);
  linked.clear();
  assert.deepEqual(await deliver({otp:'654321',actor:'dev1',runId:'78'}),{channel:'whatsapp'});
  assert.deepEqual(whatsapps,['654321']);
  await assert.rejects(createReleaseOtpDelivery({pool,telegram,alsoLogins:[]})({otp:'1',actor:'',runId:''}),/no linked Telegram/);
  // Mr Mohit Chadda gets every release OTP too, together with the owner; by default as well.
  telegrams.length=0;whatsapps.length=0;linked.add('anoop').add('mohitchadda');
  assert.deepEqual(await both({otp:'111222',actor:'dev1',runId:'79'}),{channel:'telegram'});
  assert.deepEqual(telegrams.map(t=>t.login),['anoop','anoop.admin','mohitchadda']);
  assert.ok(telegrams.every(t=>/OTP: 111222/.test(t.message)));
  telegrams.length=0;
  await createReleaseOtpDelivery({pool,telegram})({otp:'333444',actor:'dev1',runId:'80'});
  assert.ok(telegrams.some(t=>t.login==='mohitchadda'),'Mr Mohit Chadda is included by default');
  assert.equal(whatsapps.length,0);
});

test('the WhatsApp fallback goes only to the owner number through the owner-only connection',async()=>{
  const config={enabled:true,purpose:'logBookDeletionOtp',recipient:'919925565281',phoneNumberId:'p',accessToken:'t'};
  const pool={query:async()=>({rows:[{setting_value:config}]})};
  const calls=[];
  await sendReleaseOtp({pool,otp:'123456'},{sendTemplate:async(message,{env})=>calls.push({message,env})});
  assert.equal(calls[0].message.to,'919925565281');
  assert.deepEqual(calls[0].message.parameters,['123456']);
  assert.equal(calls[0].env.META_WHATSAPP_ACCESS_TOKEN,'t');
  await assert.rejects(sendReleaseOtp({pool,otp:'12345'},{sendTemplate:async()=>{}}),/Invalid release OTP/);
  await assert.rejects(sendReleaseOtp({pool:{query:async()=>({rows:[]})},otp:'123456'},{sendTemplate:async()=>{}}),/not configured/);
});

test('Approve / Reject on Telegram: buttons go to the approvers, the first tap decides, and only the asking run can use an approval',async()=>{
  const clock={now:NOW},pool=fakePool(),asked=[];
  const app=express();app.use(express.json());
  const release=registerReleaseOtp(app,{pool,verifyIdentity:verifier(),now:()=>clock.now,sendOtp:async()=>{throw Error('no OTP expected')},
    sendApproval:async input=>{asked.push(input);return {sent:2}},isApprover:async login=>['anoop','mohitchadda'].includes(login)});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,body={},token=jwt())=>{const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}};
  try{
    const ask=await post('/api/release-otp/request-approval',{commit:'abcdef1234',subject:'Fix'});
    assert.equal(ask.status,200);assert.match(ask.body.id,/^[0-9a-f]{16}$/);
    assert.deepEqual([asked[0].actor,asked[0].runId,asked[0].commit,asked[0].id],['dev1','77','abcdef1234',ask.body.id]);
    const id=ask.body.id;
    assert.equal((await post('/api/release-otp/decision',{id})).body.status,'awaiting');
    // Someone who is not an approver, a stale button and a forged button change nothing.
    assert.match((await release.handleTelegramCallback({data:`rel:${id}:a`,logins:['someone']})).answer,/Only the owners/);
    assert.match((await release.handleTelegramCallback({data:'rel:ffffffffffffffff:a',logins:['anoop']})).answer,/no longer active/);
    assert.equal(await release.handleTelegramCallback({data:'other',logins:['anoop']}),null);
    assert.equal((await post('/api/release-otp/decision',{id})).body.status,'awaiting');
    const tap=await release.handleTelegramCallback({data:`rel:${id}:a`,logins:['mohitchadda']});
    assert.match(tap.answer,/Approved by mohitchadda at \d\d:\d\d IST/);assert.equal(tap.done,true);
    assert.match((await release.handleTelegramCallback({data:`rel:${id}:r`,logins:['anoop']})).answer,/Already approved by mohitchadda/);
    // Another run cannot use this approval; the asking run gets it once.
    assert.equal((await post('/api/release-otp/decision',{id},jwt({run_id:'99'}))).body.status,'missing');
    assert.deepEqual((await post('/api/release-otp/decision',{id})).body,{status:'approved',by:'mohitchadda'});
    assert.equal((await post('/api/release-otp/decision',{id})).body.status,'used');
    // Reject, and expiry after ten minutes.
    clock.now+=61000;
    const second=(await post('/api/release-otp/request-approval',{})).body.id;
    await release.handleTelegramCallback({data:`rel:${second}:r`,logins:['anoop']});
    assert.deepEqual((await post('/api/release-otp/decision',{id:second})).body,{status:'rejected',by:'anoop'});
    clock.now+=61000;
    const third=(await post('/api/release-otp/request-approval',{})).body.id;
    clock.now+=11*60000;
    assert.equal((await post('/api/release-otp/decision',{id:third})).body.status,'expired');
    assert.match((await release.handleTelegramCallback({data:`rel:${third}:a`,logins:['anoop']})).answer,/closed|expired/);
  }finally{server.close();}
});

test('approval buttons go only to approvers who linked Telegram, and nobody linked means no buttons',async()=>{
  const {createReleaseApprovalDelivery}=await import('../server/services/release-otp-delivery.mjs');
  const users=[{login:'Anoop',mobile:'9925565281'},{login:'other',mobile:'9000000000'}];
  let links=[{chat_id:'11'},{chat_id:'22'}];
  const pool={query:async(sql,params)=>{
    if(/Users & employees/.test(sql))return {rows:users.map(record_data=>({record_data}))};
    if(/mis_telegram_links/.test(sql)){assert.deepEqual(params[0],['anoop','mohitchadda']);return {rows:links};}
    throw Error(sql);
  }};
  const sent=[];
  const deliver=createReleaseApprovalDelivery({pool,sendButtons:async(chat,text,buttons)=>{sent.push({chat,text,buttons});return true}});
  assert.deepEqual(await deliver({id:'0123456789abcdef',actor:'dev1',runId:'77',commit:'abcdef1234567',subject:'Fix'}),{sent:2});
  assert.deepEqual(sent.map(s=>s.chat),['11','22']);
  assert.deepEqual(sent[0].buttons[0].map(b=>b.callback_data),['rel:0123456789abcdef:a','rel:0123456789abcdef:r']);
  assert.match(sent[0].text,/Requested by: dev1 \(GitHub run 77\)\nVersion: abcdef1 - Fix/);
  links=[];
  assert.deepEqual(await deliver({id:'0123456789abcdef',actor:'dev1',runId:'78'}),{sent:0});
});
