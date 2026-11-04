import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {installMisLoginHandoff} from '../server/routes/mis-login-handoff.mjs';

test('parallel MIS tabs keep their browser proof and completed session handoffs separate',async()=>{
 const db=new PGlite(),routes=new Map(),sessions=new Map(),jar=new Map();
 try{
  await db.exec('CREATE TABLE mis_credential_sessions(session_token UUID,grant_token TEXT)');
  const service=installMisLoginHandoff({get:(p,h)=>routes.set(p,h)},{pool:db,sessionStore:{create:async s=>sessions.set(s.token,s),get:async t=>sessions.get(t)},credentialClient:{validateSession:async(_t,s)=>s},fetcher:async(_url,options)=>({ok:true,json:async()=>({grant:'g'.repeat(43),profile:{login:JSON.parse(options.body).state,permissions:{separateMisCredentials:true}}})})});
  await service.initialize();
  const call=async(path,query={})=>{
   const result={status:200};
   const res={set(){},status(n){result.status=n;return this},json(body){result.body=body;return this},cookie(n,v){jar.set(n,v)},clearCookie(n){jar.delete(n)},redirect(n,url){result.status=n;result.url=url}};
   await routes.get(path)({query,headers:{cookie:[...jar].map(([n,v])=>n+'='+v).join('; ')}},res);return result;
  };
  const first=new URL((await call('/api/mis-credentials/start')).url).searchParams.get('misState');
  const second=new URL((await call('/api/mis-credentials/start')).url).searchParams.get('misState');
  const a=await call('/api/mis-credentials/callback',{state:first,code:'a'.repeat(43)});
  assert.equal(a.status,303,'Opening a second MIS tab must not invalidate the first tab browser proof');
  const b=await call('/api/mis-credentials/callback',{state:second,code:'b'.repeat(43)});
  assert.equal(b.status,303);
  const handoff=r=>new URL(r.url,'https://pulse-ll.cmll.in').searchParams.get('misCredentialReady');
  assert.equal((await call('/api/mis-credentials/session',{handoff:'invalid'})).status,400);
  const one=await call('/api/mis-credentials/session',{handoff:handoff(a)});
  const two=await call('/api/mis-credentials/session',{handoff:handoff(b)});
  assert.equal(one.status,200);assert.equal(two.status,200);
  assert.equal(one.body.login,first);assert.equal(two.body.login,second);
  assert.notEqual(one.body.token,two.body.token);
  assert.equal((await call('/api/mis-credentials/session',{handoff:handoff(a)})).status,401);
 }finally{await db.close()}
});
