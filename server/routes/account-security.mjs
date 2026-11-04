import {createHash,randomUUID} from 'node:crypto';
import {newTotpSecret,verifyTotp,recoveryCodes,recoveryHash} from '../services/totp.mjs';
import {BROWSER_SESSION_MARKER} from '../middleware/browser-session-security.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const tokenOf=req=>String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
const identity=req=>String(req.session?.login||'').trim().toLowerCase();
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const selfPaths=new Set(['/api/security/account','/api/security/session/migrate','/api/security/mfa/enroll','/api/security/mfa/confirm','/api/security/mfa/verify','/api/logout','/api/mis-credentials/logout']);
const authPaths=new Set(['/api/login','/api/change-initial-password','/api/mis-credentials/login','/api/mis-credentials/session','/api/mis-sso/session']);
export function registerAccountSecurity(app,{pool,requireSession,store,requireMfa=false,enabled=true,now=Date.now}){
 let ready=false;
 const wrap=handler=>async(req,res,next)=>{try{res.set('Cache-Control','no-store');if(!ready)return res.status(503).set('Retry-After','1').json({error:'Account security is initializing. Please retry.'});await handler(req,res);}catch(error){if(error.status===429)res.set('Retry-After','300');next(error);}};
 const account=async login=>(await pool.query('SELECT login_name,last_counter,recovery_hashes FROM mis_mfa_accounts WHERE login_name=$1',[login])).rows[0];
 const verified=async token=>Boolean((await pool.query('SELECT session_token FROM mis_mfa_sessions WHERE session_token=$1',[token])).rows[0]);
 const rotate=async(req,client,{verified=false,method='totp'}={})=>{
  const before=tokenOf(req),after=randomUUID();
  if(!(await client.query('SELECT token FROM auth_sessions WHERE token=$1 FOR UPDATE',[before])).rows.length)throw Object.assign(new Error('Sign in again to continue.'),{status:401});
  const result=await client.query(`INSERT INTO auth_sessions(token,role,employee_name,login_name,user_type,assigned_role,permissions,created_at)
   SELECT $2,role,employee_name,login_name,user_type,assigned_role,permissions,created_at FROM auth_sessions WHERE token=$1 RETURNING token`,[before,after]);
  if(!result.rows.length)throw Object.assign(new Error('Sign in again to continue.'),{status:401});
  for(const table of ['mis_credential_sessions','mis_sso_sessions']){
   // Table names are a fixed server-side allowlist, never request input.
   if((await client.query('SELECT to_regclass($1) AS name',[table])).rows[0]?.name)await client.query(`INSERT INTO ${table}(session_token,grant_token) SELECT $2,grant_token FROM ${table} WHERE session_token=$1`,[before,after]);
  }
  if(verified)await client.query('INSERT INTO mis_mfa_sessions(session_token,method) VALUES($1,$2)',[after,method]);
  await client.query('DELETE FROM auth_sessions WHERE token=$1',[before]);return after;
 };
 const limit=async login=>{
  const {rows}=await pool.query(`INSERT INTO mis_mfa_attempts(login_name,window_start,attempts) VALUES($1,NOW(),1)
   ON CONFLICT(login_name) DO UPDATE SET attempts=CASE WHEN mis_mfa_attempts.window_start<=NOW()-INTERVAL '5 minutes' THEN 1 ELSE mis_mfa_attempts.attempts+1 END,
   window_start=CASE WHEN mis_mfa_attempts.window_start<=NOW()-INTERVAL '5 minutes' THEN NOW() ELSE mis_mfa_attempts.window_start END RETURNING attempts`,[login]);
  if(rows[0].attempts>10)throw Object.assign(new Error('Too many verification attempts. Wait five minutes and try again.'),{status:429});
 };
 const safeCode=req=>typeof req.body?.code==='string'?req.body.code.trim():'';
 const canReplace=async token=>Boolean((await pool.query("SELECT session_token FROM mis_mfa_sessions WHERE session_token=$1 AND method='recovery' AND verified_at>NOW()-INTERVAL '5 minutes'",[token])).rows[0]);
 const profile=session=>{const {created_at,sessionId,...value}=session;return {...value,token:BROWSER_SESSION_MARKER,browserSession:true};};
 // This guard also covers old bearer sessions, so changing the browser transport
 // cannot bypass MFA. The narrowly scoped PC-scanner credentials are separate.
 app.use(async(req,res,next)=>{try{
  if(!enabled||!req.path.startsWith('/api/')||selfPaths.has(req.path)||authPaths.has(req.path))return next();
  const token=tokenOf(req);if(!uuid(token))return next();
  if(!ready)return res.status(503).json({error:'Account security is initializing. Please retry.'});
  const {rows}=await pool.query(`SELECT a.login_name AS enrolled,v.session_token AS verified FROM auth_sessions s
   LEFT JOIN mis_mfa_accounts a ON a.login_name=lower(trim(s.login_name))
   LEFT JOIN mis_mfa_sessions v ON v.session_token=s.token WHERE s.token=$1`,[token]);
  if(rows[0]&&(requireMfa||rows[0].enrolled)&&!rows[0].verified)return res.status(403).json({error:'Complete account verification to continue.',code:'MFA_REQUIRED'});
  next();
 }catch(error){next(error);}});
 app.get('/api/security/account',requireSession,wrap(async(req,res)=>{
  const row=await account(identity(req)),passed=await verified(tokenOf(req));
  if(enabled)req.establishBrowserSession(tokenOf(req));
  res.json({enrolled:Boolean(row),required:enabled&&(requireMfa||Boolean(row)),verified:passed,profile:profile(req.session)});
 }));
 app.post('/api/security/session/migrate',requireSession,wrap(async(req,res)=>{
  // A first-party custom header prevents login CSRF through HTML forms, even
  // for a legacy bearer token whose cookie has not been established yet.
  if(req.get('x-mis-session-migrate')!=='1')return res.status(403).json({error:'Open MIS to migrate this session.'});
  const client=await pool.connect();let token;
  try{await client.query('BEGIN');const proof=(await client.query('SELECT method FROM mis_mfa_sessions WHERE session_token=$1',[tokenOf(req)])).rows[0];token=await rotate(req,client,{verified:Boolean(proof),method:proof?.method||'totp'});await client.query('COMMIT');}
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  req.establishBrowserSession(token);res.json(profile(req.session));
 }));
 app.post('/api/security/mfa/enroll',requireSession,wrap(async(req,res)=>{
  const login=identity(req);if(!login)return res.status(403).json({error:'This account cannot enroll an authenticator.'});
  const existingAccount=await account(login),replace=Boolean(existingAccount)&&req.body?.replace===true&&await canReplace(tokenOf(req));
  if(existingAccount&&!replace)return res.status(409).json({error:'An authenticator is already enrolled. Enter its code or a recovery code.'});
  if(!replace&&!(await pool.query("SELECT token FROM auth_sessions WHERE token=$1 AND created_at>NOW()-INTERVAL '10 minutes'",[tokenOf(req)])).rows.length)return res.status(428).json({error:'Sign out and sign in through Pulse again before setting up your authenticator.',code:'REAUTH_REQUIRED'});
  await limit(login);
  const key='mfa-pending:'+digest(tokenOf(req)),existing=await store().read(key);
  const pending=existing?.login===login&&Boolean(existing.replace)===replace&&existing.expires>now()?existing:{login,secret:newTotpSecret(),replace,expires:now()+600000};
  await store().write(key,pending);
  const label=encodeURIComponent('Caliber MIS:'+login),query=new URLSearchParams({secret:pending.secret,issuer:'Caliber MIS',algorithm:'SHA1',digits:'6',period:'30'});
  res.json({secret:pending.secret,uri:'otpauth://totp/'+label+'?'+query,expiresAt:pending.expires});
 }));
 app.post('/api/security/mfa/confirm',requireSession,wrap(async(req,res)=>{
  const login=identity(req);await limit(login);
  const key='mfa-pending:'+digest(tokenOf(req)),pending=await store().read(key);
  if(!pending||pending.login!==login||pending.expires<=now())return res.status(400).json({error:'Authenticator setup expired. Start setup again.'});
  const counter=verifyTotp(pending.secret,safeCode(req),{now:now()});
  if(counter===null)return res.status(400).json({error:'Enter the current six-digit authenticator code.'});
  if(pending.replace&&!await canReplace(tokenOf(req)))return res.status(403).json({error:'Sign in using an unused recovery code to replace your authenticator.'});
  const codes=recoveryCodes(),client=await pool.connect();let renewed;
  try{
   await client.query('BEGIN');
   const result=pending.replace
    ?await client.query('UPDATE mis_mfa_accounts SET last_counter=$2,recovery_hashes=$3::jsonb WHERE login_name=$1 RETURNING login_name',[login,counter,JSON.stringify(codes.map(recoveryHash))])
    :await client.query('INSERT INTO mis_mfa_accounts(login_name,last_counter,recovery_hashes) VALUES($1,$2,$3::jsonb) ON CONFLICT(login_name) DO NOTHING RETURNING login_name',[login,counter,JSON.stringify(codes.map(recoveryHash))]);
   if(!result.rows.length){await client.query('ROLLBACK');return res.status(409).json({error:'This account already has an authenticator. Use its code.'});}
   await store().write('mfa:'+digest(login),{secret:pending.secret},client);
   if(pending.replace)await client.query('DELETE FROM auth_sessions WHERE lower(trim(login_name))=$1 AND token<>$2',[login,tokenOf(req)]);
   renewed=await rotate(req,client,{verified:true});
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  req.establishBrowserSession(renewed);
  await Promise.allSettled([store().remove(key),pool.query('DELETE FROM mis_mfa_attempts WHERE login_name=$1',[login])]);
  req.audit={eventType:'Security',module:'Authentication',action:pending.replace?'Replace authenticator':'Enroll authenticator',targetReference:login};
  res.json({verified:true,recoveryCodes:codes});
 }));
 app.post('/api/security/mfa/verify',requireSession,wrap(async(req,res)=>{
  const login=identity(req);await limit(login);const row=await account(login);
  if(!row)return res.status(400).json({error:'Set up an authenticator first.'});
  const code=safeCode(req),secret=await store().read('mfa:'+digest(login));let consumed,recovered=false;
  if(/^\d{6}$/.test(code)&&secret?.secret){
   const counter=verifyTotp(secret.secret,code,{now:now(),lastCounter:Number(row.last_counter)});
   if(counter!==null)consumed=(await pool.query('UPDATE mis_mfa_accounts SET last_counter=$2 WHERE login_name=$1 AND last_counter<$2 RETURNING login_name',[login,counter])).rows.length;
  }else if(/^[a-f0-9 -]{20,30}$/i.test(code)){
   consumed=(await pool.query(`UPDATE mis_mfa_accounts SET recovery_hashes=(SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements_text(recovery_hashes) value WHERE value<>$2)
    WHERE login_name=$1 AND recovery_hashes ? $2 RETURNING login_name`,[login,recoveryHash(code)])).rows.length;
   recovered=Boolean(consumed);
  }
  if(!consumed)return res.status(400).json({error:'The code is incorrect or already used. Try a current code or an unused recovery code.'});
  const client=await pool.connect();let renewed;
  try{await client.query('BEGIN');renewed=await rotate(req,client,{verified:true,method:recovered?'recovery':'totp'});await client.query('COMMIT');}
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  req.establishBrowserSession(renewed);await pool.query('DELETE FROM mis_mfa_attempts WHERE login_name=$1',[login]);
  req.audit={eventType:'Security',module:'Authentication',action:recovered?'Use recovery code':'Verify authenticator',targetReference:login};res.json({verified:true,replaceAuthenticator:recovered});
 }));
 return {async initialize(){
  await pool.query(`CREATE TABLE IF NOT EXISTS mis_mfa_accounts(login_name TEXT PRIMARY KEY,last_counter BIGINT NOT NULL DEFAULT -1,recovery_hashes JSONB NOT NULL DEFAULT '[]')`);
  await pool.query(`CREATE TABLE IF NOT EXISTS mis_mfa_sessions(session_token UUID PRIMARY KEY REFERENCES auth_sessions(token) ON DELETE CASCADE,verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),method TEXT NOT NULL DEFAULT 'totp')`);
  await pool.query(`ALTER TABLE mis_mfa_sessions ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'totp'`);
  await pool.query(`CREATE TABLE IF NOT EXISTS mis_mfa_attempts(login_name TEXT PRIMARY KEY,window_start TIMESTAMPTZ NOT NULL,attempts INT NOT NULL)`);ready=true;
 }};
}
