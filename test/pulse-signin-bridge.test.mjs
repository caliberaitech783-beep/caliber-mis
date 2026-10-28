import test from 'node:test';
import assert from 'node:assert/strict';
import {createPulseSignInBridge} from '../pulse-signin-bridge.mjs';
import {PGlite} from '@electric-sql/pglite';
import {registerMasterSync} from '../master-sync.mjs';

test('automatic connection sends only the posting user grant to fixed HTTPS Pulse and never sends a password',async()=>{
 const actors=[],calls=[];
 const bridge=createPulseSignInBridge({pool:{query:async(sql,args)=>{actors.push(args[0]);return {rows:args[0]==='missing'?[]:[{grant_token:'server-only-grant'}]}}},fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});assert.equal(options.redirect,'error');return Response.json([])}});
 await bridge.start();try{
  assert.equal(bridge.status().connected,true);
  await bridge.request('requests',{},'posting-user');
  await bridge.request('verify',{reference:'BD1',payload:{firstTripDone:true}},'posting-user');
  assert.equal(calls[0].url,'https://pulse.cmll.in/api/integrations/mis/pulse');
  assert.equal(calls[0].body.grant,'server-only-grant');assert.equal(calls[1].body.reference,'BD1');
  assert.equal(actors[1],'posting-user');assert.ok(!JSON.stringify(calls).includes('password'));
  await assert.rejects(()=>bridge.request('verify',{},'missing'),error=>error.status===401);assert.equal(calls.length,2);
 }finally{bridge.stop()}
});

test('expired source login is reported for normal sign-in rather than requesting a connection password',async()=>{
 const bridge=createPulseSignInBridge({pool:{query:async()=>({rows:[{grant_token:'expired-grant'}]})},fetchImpl:async()=>Response.json({error:'Sign-in expired.'},{status:401})});
 await assert.rejects(()=>bridge.request('requests',{},'actor'),error=>error.status===401&&error.message==='Sign-in expired.');
});

test('real session selection requires the card owner and a relevant assigned MIS menu',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE auth_sessions(token TEXT PRIMARY KEY,login_name TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),permissions JSONB);CREATE TABLE mis_credential_sessions(session_token TEXT,grant_token TEXT);');
 await db.query('INSERT INTO auth_sessions(token,login_name,permissions) VALUES($1,$2,$3)', ['one','owner',JSON.stringify({misDesktopAccess:['Vehicle Log Book']})]);await db.query("INSERT INTO mis_credential_sessions VALUES('one','owner-grant')");
 const bridge=createPulseSignInBridge({pool:db,fetchImpl:async(_url,options)=>{assert.equal(JSON.parse(options.body).grant,'owner-grant');return Response.json([])}});await bridge.start();t.after(()=>bridge.stop());
 assert.equal(bridge.status().connected,true);await bridge.request('requests',{},'owner');await assert.rejects(()=>bridge.request('requests',{},'other'),error=>error.status===401);
 await db.query("UPDATE auth_sessions SET permissions='{}'");await assert.rejects(()=>bridge.request('requests',{},'owner'),error=>error.status===401);
});

test('an unavailable Oracle connection does not hide the automatic Pulse connection',async()=>{
 const routes=new Map();registerMasterSync({get:(url,...handlers)=>routes.set(url,handlers.at(-1)),post(){}},{pool:{query:async()=>({rows:[]})},pulse:{status:()=>({connected:true})},erp:{status:async()=>{throw Error('unavailable')}},requireSession(){},requireAdministrator(){}});
 let result;await routes.get('/api/master-sync')({}, {set(){return this},json(data){result=data}},error=>{throw error});
 assert.equal(result.masters.find(row=>row.source==='Pulse').connected,true);assert.match(result.masters.find(row=>row.source==='Oracle').error,/Oracle connection/);
});
