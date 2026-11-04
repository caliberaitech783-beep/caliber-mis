import {randomUUID} from 'node:crypto';
const issuer='https://pulse.cmll.in';
export function installMisCredentialClient(app,{pool,sessionStore,fetcher=fetch}){
 const request=async(action,body)=>{
  const response=await fetcher(`${issuer}/api/integrations/mis/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
  return {status:response.status,data:await response.json()};
 };
 app.post('/api/mis-credentials/login',async(req,res,next)=>{
  res.set('Cache-Control','no-store');req.audit=false;
  try{
   const {username,password}=req.body||{};
   if(typeof username!=='string'||username.length>120||typeof password!=='string'||password.length>256)return res.status(401).json({error:'MIS username or password is incorrect.'});
   const {status,data}=await request('authenticate',{username,password});
   if(status!==200)return res.status(status===429?429:401).json({error:data.error||'MIS username or password is incorrect.'});
   if(!data.profile?.permissions?.separateMisCredentials||!/^[A-Za-z0-9_-]{43}$/.test(data.grant||''))throw Error('Invalid MIS identity response');
   const token=randomUUID();await sessionStore.create({token,...data.profile});
   await pool.query('INSERT INTO mis_credential_sessions(session_token,grant_token) VALUES($1,$2)',[token,data.grant]);
   res.json({token,...data.profile});
  }catch(error){res.status(503).json({error:'MIS login is temporarily unavailable. Please retry.'});}
 });
 app.post('/api/mis-credentials/logout',async(req,res)=>{
  res.set('Cache-Control','no-store');req.audit=false;
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!/^[0-9a-f-]{36}$/i.test(token))return res.status(204).end();
  try{
   const {rows}=await pool.query('SELECT grant_token FROM mis_credential_sessions WHERE session_token=$1',[token]);
   if(rows[0])await request('logout',{grant:rows[0].grant_token});
   await pool.query('DELETE FROM auth_sessions WHERE token=$1',[token]);res.status(204).end();
  }catch{res.status(503).json({error:'Sign out could not be completed. Please retry.'});}
 });
 return {
  async validateSession(token,session){
   if(!session?.permissions?.separateMisCredentials)return null;
   const {rows}=await pool.query('SELECT grant_token FROM mis_credential_sessions WHERE session_token=$1',[token]);
   if(!rows[0])return null;
   try{const {status,data}=await request('validate',{grant:rows[0].grant_token});return status===200&&data.profile?.permissions?.separateMisCredentials?{...session,...data.profile}:null;}catch{return null;}
  },
  async initialize(){await pool.query('CREATE TABLE IF NOT EXISTS mis_credential_sessions(session_token UUID PRIMARY KEY REFERENCES auth_sessions(token) ON DELETE CASCADE,grant_token TEXT NOT NULL)');}
 };
}
