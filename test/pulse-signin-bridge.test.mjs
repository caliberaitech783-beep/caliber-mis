import test from 'node:test';
import assert from 'node:assert/strict';
import {createPulseSignInBridge} from '../server/services/pulse-signin-bridge.mjs';
import {PGlite} from '@electric-sql/pglite';
import {registerMasterSync} from '../server/routes/master-sync.mjs';

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
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE auth_sessions(token TEXT PRIMARY KEY,login_name TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),permissions JSONB);CREATE TABLE mis_credential_sessions(session_token TEXT,grant_token TEXT,remembered BOOLEAN NOT NULL DEFAULT false);');
 await db.query('INSERT INTO auth_sessions(token,login_name,permissions) VALUES($1,$2,$3)', ['one','owner',JSON.stringify({misDesktopAccess:['Vehicle Log Book']})]);await db.query("INSERT INTO mis_credential_sessions VALUES('one','owner-grant')");
 const bridge=createPulseSignInBridge({pool:db,fetchImpl:async(_url,options)=>{assert.equal(JSON.parse(options.body).grant,'owner-grant');return Response.json([])}});await bridge.start();t.after(()=>bridge.stop());
 assert.equal(bridge.status().connected,true);await bridge.request('requests',{},'owner');await assert.rejects(()=>bridge.request('requests',{},'other'),error=>error.status===401);
 await db.query("UPDATE auth_sessions SET permissions='{}'");await assert.rejects(()=>bridge.request('requests',{},'owner'),error=>error.status===401);
});

test('an unavailable Oracle connection does not hide the automatic Pulse connection',async()=>{
 const routes=new Map();registerMasterSync({get:(url,...handlers)=>routes.set(url,handlers.at(-1)),post(){}},{pool:{query:async()=>({rows:[]})},pulse:{status:()=>({connected:true})},erp:{status:async()=>{throw Error('unavailable')}},requireSession(){},requireAdministrator(){}});
 let result;await routes.get('/api/master-sync')({}, {set(){return this},json(data){result=data}},error=>{throw error});
 assert.equal(result.masters.find(row=>row.name==='Region master')?.source,'Pulse');
 assert.equal(result.masters.find(row=>row.source==='Pulse').connected,true);assert.match(result.masters.find(row=>row.source==='Oracle').error,/Oracle connection/);
});

test('ordinary ELB-only MIS session can request fleet verification using only its own grant',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE auth_sessions(token TEXT PRIMARY KEY,login_name TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),permissions JSONB);CREATE TABLE mis_credential_sessions(session_token TEXT,grant_token TEXT,remembered BOOLEAN NOT NULL DEFAULT false);');
 await db.query('INSERT INTO auth_sessions(token,login_name,permissions) VALUES($1,$2,$3)',['elb','ordinary-elb',JSON.stringify({misDesktopAccess:['Equipment Log Book']})]);
 await db.query("INSERT INTO mis_credential_sessions VALUES('elb','elb-grant')");
 const bridge=createPulseSignInBridge({pool:db,fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);assert.deepEqual(body,{grant:'elb-grant',action:'fleet',site:'Jayant OB'});return Response.json({'Equipment master':[{door:'TPC35'}]});}});
 await bridge.request('fleet',{site:'Jayant OB'},'ordinary-elb');
 await assert.rejects(bridge.request('fleet',{site:'Jayant OB'},'other-user'),e=>e.status===401);
});

test('raw asks return Pulse bytes unparsed, and a refusal still carries Pulse error sentence',async()=>{
 let status=200;
 const bridge=createPulseSignInBridge({pool:{query:async()=>({rows:[{grant_token:'g'}]})},fetchImpl:async()=>status===200?new Response('[{"ref":"BD1"}]'):Response.json({error:'Pulse sign-in expired.'},{status})});
 const bytes=await bridge.request('breakdown-mirror',{},null,{menu:'Pulse Master Sync',raw:true});
 assert.ok(Buffer.isBuffer(bytes));assert.equal(bytes.toString('utf8'),'[{"ref":"BD1"}]');
 status=401;
 await assert.rejects(()=>bridge.request('breakdown-mirror',{},null,{raw:true}),error=>error.status===401&&error.message==='Pulse sign-in expired.');
});

test('stale newest grant falls back to the same users eligible sign-in only on read authentication rejection',async()=>{
 const calls=[];
 const bridge=createPulseSignInBridge({pool:{query:async(sql,args)=>{assert.equal(args[0],'owner');return {rows:[{grant_token:'stale'},{grant_token:'valid'}]}}},fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);calls.push(body);return body.grant==='stale'?Response.json({error:'Pulse sign-in expired.'},{status:401}):Response.json([{door:'V683'}]);}});
 assert.deepEqual(await bridge.request('fleet',{site:'Gauri Pauni OC (2nd)'},'owner'),[{door:'V683'}]);
 assert.deepEqual(calls.map(x=>x.grant),['stale','valid']);
 calls.length=0;
 await assert.rejects(bridge.request('verify',{},'owner'),e=>e.status===401);
 assert.equal(calls.length,1);
});
test('permission rejection does not try another grant',async()=>{
 let calls=0;const bridge=createPulseSignInBridge({pool:{query:async()=>({rows:[{grant_token:'one'},{grant_token:'two'}]})},fetchImpl:async()=>{calls++;return Response.json({error:'Denied'},{status:403});}});
 await assert.rejects(bridge.request('fleet',{},'owner'),e=>e.status===403);assert.equal(calls,1);
});
