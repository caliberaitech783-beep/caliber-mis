import {createHash,randomBytes,randomUUID} from 'node:crypto';
const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const proof=value=>createHash('sha256').update(String(value)).digest('base64url');
const valid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const cookie=(req,name)=>String(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(name+'='))?.slice(name.length+1)||'';
const stateCookie='__Host-mis_credential_state',readyCookie='__Host-mis_credential_ready';
const options={httpOnly:true,secure:true,sameSite:'lax',path:'/'};
export function installMisLoginHandoff(app,{pool,sessionStore,credentialClient,fetcher=fetch}){
 const safe=handler=>async(req,res)=>{
  req.audit=false;res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  try{await handler(req,res);}catch{res.status(503).json({error:'MIS sign-in is temporarily unavailable. Start again from Pulse.'});}
 };
 app.get('/api/mis-credentials/start',safe(async(_req,res)=>{
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  await pool.query('DELETE FROM mis_login_pending WHERE expires_at<=NOW()');
  await pool.query("INSERT INTO mis_login_pending(state_hash,verifier,expires_at) VALUES($1,$2,NOW()+INTERVAL '5 minutes')",[digest(state),verifier]);
  res.cookie(stateCookie,state,{...options,maxAge:300000});
  const target=new URL('https://pulse.cmll.in/');target.searchParams.set('login','mis');target.searchParams.set('misState',state);target.searchParams.set('misChallenge',proof(verifier));
  res.redirect(303,target.toString());
 }));
 app.get('/api/mis-credentials/callback',safe(async(req,res)=>{
  const {code,state}=req.query;
  if(!valid(code)||!valid(state)||cookie(req,stateCookie)!==state)return res.status(400).json({error:'This MIS sign-in does not match your browser. Start again from Pulse.'});
  res.clearCookie(stateCookie,options);
  const {rows}=await pool.query('DELETE FROM mis_login_pending WHERE state_hash=$1 AND expires_at>NOW() RETURNING verifier',[digest(state)]);
  if(!rows[0])return res.status(400).json({error:'MIS sign-in has expired. Start again from Pulse.'});
  const response=await fetcher('https://pulse.cmll.in/api/integrations/mis/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,state,verifier:rows[0].verifier}),redirect:'error',signal:AbortSignal.timeout(15000)});
  const result=await response.json();
  if(!response.ok||!valid(result.grant)||!result.profile?.permissions?.separateMisCredentials)return res.status(401).json({error:'Pulse could not complete MIS sign-in. Please start again.'});
  const token=randomUUID();await sessionStore.create({token,...result.profile});
  await pool.query('INSERT INTO mis_credential_sessions(session_token,grant_token) VALUES($1,$2)',[token,result.grant]);
  res.cookie(readyCookie,token,{...options,maxAge:60000});res.redirect(303,'/?misCredentialReady=1');
 }));
 app.get('/api/mis-credentials/session',safe(async(req,res)=>{
  const token=cookie(req,readyCookie);res.clearCookie(readyCookie,options);
  if(!/^[0-9a-f-]{36}$/i.test(token))return res.status(401).json({error:'Start MIS sign-in from Pulse.'});
  const session=await credentialClient.validateSession(token,await sessionStore.get(token));
  if(!session)return res.status(401).json({error:'MIS sign-in expired. Start again from Pulse.'});
  res.json({token,...session});
 }));
 return {initialize:()=>pool.query('CREATE TABLE IF NOT EXISTS mis_login_pending(state_hash TEXT PRIMARY KEY,verifier TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL)')};
}
