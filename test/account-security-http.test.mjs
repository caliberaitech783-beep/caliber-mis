import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {createServer} from 'node:http';import {randomUUID} from 'node:crypto';import {PGlite} from '@electric-sql/pglite';
import {browserSessionMiddleware,SESSION_COOKIE,CSRF_COOKIE} from '../server/middleware/browser-session-security.mjs';
import {registerAccountSecurity} from '../server/routes/account-security.mjs';import {totp} from '../server/services/totp.mjs';
test('real HTTP cookie, CSRF, MFA, recovery and session migration boundaries',async t=>{
 const db=new PGlite();t.after(()=>db.close());const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
 await db.exec(`CREATE TABLE auth_sessions(token UUID PRIMARY KEY,role TEXT,employee_name TEXT,login_name TEXT,user_type TEXT,assigned_role TEXT,permissions JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE mis_credential_sessions(session_token UUID PRIMARY KEY REFERENCES auth_sessions(token) ON DELETE CASCADE,grant_token TEXT);`);
 const secrets=new Map(),store={read:async key=>secrets.get(key),write:async(key,value)=>secrets.set(key,value),remove:async key=>secrets.delete(key)};
 let time=1234567890000,lastIssued;const app=express();app.use(express.json());app.use(browserSessionMiddleware());
 const requireSession=async(req,res,next)=>{try{const token=String(req.headers.authorization||'').replace(/^Bearer /,'');const row=(await pool.query('SELECT * FROM auth_sessions WHERE token=$1',[token])).rows[0];if(!row)return res.status(401).json({error:'Expired'});req.session={role:row.role,login:row.login_name,name:row.employee_name,permissions:row.permissions};next();}catch(error){next(error);}};
 const security=registerAccountSecurity(app,{pool,requireSession,store:()=>store,requireMfa:true,now:()=>time});await security.initialize();
 app.post('/api/mis-credentials/login',async(req,res)=>{lastIssued=randomUUID();await pool.query("INSERT INTO auth_sessions(token,role,employee_name,login_name,user_type,assigned_role,permissions) VALUES($1,'super','User','user','Super User','MIS Manager',$2::jsonb)",[lastIssued,JSON.stringify({separateMisCredentials:true})]);await pool.query('INSERT INTO mis_credential_sessions VALUES($1,$2)',[lastIssued,'central-grant']);res.json({token:lastIssued,login:'user',permissions:{separateMisCredentials:true}});});
 app.get('/api/private',requireSession,(_req,res)=>res.json({ok:true}));app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message}));
 const server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));const base='http://127.0.0.1:'+server.address().port;
 let jar=new Map();const call=async(path,{body,headers={},method=body?'POST':'GET'}={})=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>k+'='+v).join(';'),'X-CSRF-Token':jar.get(CSRF_COOKIE)||'',...headers},body:body?JSON.stringify(body):undefined});for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0],at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}return {response,body:await response.json()};};
 const login=async()=>{jar=new Map();const result=await call('/api/mis-credentials/login',{body:{}});assert.equal(result.response.status,200);assert.equal(result.body.token,'browser-session');assert.notEqual(jar.get(SESSION_COOKIE),'browser-session');assert.ok(result.response.headers.getSetCookie().some(x=>x.startsWith(SESSION_COOKIE+'=')&&x.includes('HttpOnly')&&x.includes('Secure')&&x.includes('SameSite=Strict')));return lastIssued;};
 const first=await login();assert.equal((await call('/api/private')).body.code,'MFA_REQUIRED');
 assert.equal((await call('/api/private',{headers:{Authorization:'Bearer '+first}})).body.code,'MFA_REQUIRED');
 assert.equal((await call('/api/security/mfa/enroll',{body:{},headers:{'X-CSRF-Token':''}})).body.code,'CSRF_REJECTED');
 assert.equal((await call('/api/security/mfa/enroll',{body:{},headers:{Origin:'https://evil.example'}})).response.status,403);
 const setup=await call('/api/security/mfa/enroll',{body:{}});assert.equal(setup.response.status,200);assert.ok(setup.body.uri.startsWith('otpauth://totp/'));
 assert.equal((await call('/api/security/mfa/confirm',{body:{code:'wrong'}})).response.status,400);
 const confirmed=await call('/api/security/mfa/confirm',{body:{code:totp(setup.body.secret,Math.floor(time/30000))}});assert.equal(confirmed.response.status,200);assert.equal(confirmed.body.recoveryCodes.length,10);assert.notEqual(jar.get(SESSION_COOKIE),first);
 assert.equal((await pool.query('SELECT token FROM auth_sessions WHERE token=$1',[first])).rows.length,0);assert.equal((await call('/api/private')).response.status,200);
 assert.equal((await pool.query('SELECT grant_token FROM mis_credential_sessions WHERE session_token=$1',[jar.get(SESSION_COOKIE)])).rows[0].grant_token,'central-grant');
 await login();assert.equal((await call('/api/private')).body.code,'MFA_REQUIRED');assert.equal((await call('/api/security/mfa/verify',{body:{code:totp(setup.body.secret,Math.floor(time/30000))}})).response.status,400);
 time+=30000;assert.equal((await call('/api/security/mfa/verify',{body:{code:totp(setup.body.secret,Math.floor(time/30000))}})).response.status,200);
 await login();assert.equal((await call('/api/security/mfa/verify',{body:{code:confirmed.body.recoveryCodes[0]}})).response.status,200);
 await login();assert.equal((await call('/api/security/mfa/verify',{body:{code:confirmed.body.recoveryCodes[0]}})).response.status,400);
 assert.equal((await call('/api/security/mfa/enroll',{body:{}})).response.status,409);
 for(let i=0;i<10;i++)await call('/api/security/mfa/verify',{body:{code:'invalid'}});
 assert.equal((await call('/api/security/mfa/verify',{body:{code:'invalid'}})).response.status,429);
 const old=await login();jar=new Map();const migrated=await call('/api/security/session/migrate',{body:{},headers:{Authorization:'Bearer '+old,'X-MIS-Session-Migrate':'1'}});assert.equal(migrated.response.status,200);assert.equal(migrated.body.token,'browser-session');assert.equal((await pool.query('SELECT token FROM auth_sessions WHERE token=$1',[old])).rows.length,0);assert.equal((await call('/api/private')).body.code,'MFA_REQUIRED');
});

test('standard sign-in skips authenticator checks for new and enrolled users',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec("CREATE TABLE auth_sessions(token UUID PRIMARY KEY,login_name TEXT);");
 const token=randomUUID();await db.query("INSERT INTO auth_sessions VALUES($1,'user')",[token]);
 const app=express();
 const requireSession=(req,res,next)=>{req.session={login:'user'};req.establishBrowserSession=()=> 'browser-session';next();};
 const security=registerAccountSecurity(app,{pool:db,requireSession,store:()=>({}),requireMfa:false});await security.initialize();
 app.get('/api/private',requireSession,(_req,res)=>res.json({ok:true}));
 const server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer '+token};
 for(const enrolled of [false,true]){
  if(enrolled)await db.query("INSERT INTO mis_mfa_accounts(login_name) VALUES('user')");
  const status=await fetch(base+'/api/security/account',{headers});assert.equal(status.status,200);const body=await status.json();assert.equal(body.required,false);assert.equal(body.enrolled,enrolled);
  const response=await fetch(base+'/api/private',{headers});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
 }
});
