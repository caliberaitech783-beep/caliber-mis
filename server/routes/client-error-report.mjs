// Browser-side failures reported to the server. Until 2 November 2026 a screen
// that crashed in an operator's browser ("This screen could not be displayed")
// left no trace anywhere but that browser's console, so the cause could not be
// found afterwards. Every render error, window error and unhandled promise
// rejection now posts here, is written to the server log (visible in the Azure
// log stream) and kept in mis_client_errors for the diagnostics page.
export const CLIENT_ERROR_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_client_errors(
  id BIGSERIAL PRIMARY KEY,
  login TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'render',
  ui_version TEXT NOT NULL DEFAULT '',
  server_commit TEXT NOT NULL DEFAULT '',
  screen TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  stack TEXT NOT NULL DEFAULT '',
  component_stack TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS mis_client_errors_created_at ON mis_client_errors(created_at DESC);`;

export const CLIENT_ERROR_KINDS=['render','window','promise','chunk'];
export const CLIENT_ERROR_RETENTION_DAYS=90;
const LIMITS={message:2000,stack:16000,componentStack:8000,url:2000,screen:200,uiVersion:64,userAgent:400};
const text=(value,limit)=>String(value??'').replace(/\0/g,'').slice(0,limit);

// Tokens, OTPs and passwords never belong in a stored URL.
export function scrubReportUrl(value){
 try{
  const url=new URL(String(value||''),'https://pulse-ll.cmll.in');
  for(const key of [...url.searchParams.keys()])if(/token|otp|password|secret|key/i.test(key))url.searchParams.set(key,'[removed]');
  return text(url.pathname+url.search+url.hash,LIMITS.url);
 }catch{return '';}
}

export function normalizeClientErrorReport(body){
 if(!body||typeof body!=='object'||Array.isArray(body))return null;
 const message=text(body.message,LIMITS.message).trim();
 if(!message)return null;
 return {
  kind:CLIENT_ERROR_KINDS.includes(body.kind)?body.kind:'render',
  uiVersion:text(body.uiVersion,LIMITS.uiVersion),
  screen:text(body.screen,LIMITS.screen),
  url:scrubReportUrl(body.url),
  message,
  stack:text(body.stack,LIMITS.stack),
  componentStack:text(body.componentStack,LIMITS.componentStack),
 };
}

// At most `limit` reports per login per minute; a render loop must not flood the table.
export function createReportLimiter({limit=20,windowMs=60_000,now=Date.now}={}){
 const seen=new Map();
 return login=>{
  const at=now(),key=String(login||'');
  const entries=(seen.get(key)||[]).filter(stamp=>at-stamp<windowMs);
  if(entries.length>=limit){seen.set(key,entries);return false;}
  entries.push(at);seen.set(key,entries);
  if(seen.size>5000)for(const [other,stamps] of seen)if(!stamps.some(stamp=>at-stamp<windowMs))seen.delete(other);
  return true;
 };
}

export function formatClientErrorLog(report,{login='',serverCommit=''}={}){
 return `Browser error (${report.kind}) for ${login||'unknown user'} on ${report.screen||report.url||'unknown screen'} · ui ${report.uiVersion||'?'} · server ${serverCommit||'?'}: ${report.message}`;
}

export function registerClientErrorReports(app,{pool,requireSession,requireAdministrator,serverCommit=()=>'',log=console,limiter=createReportLimiter()}){
 let ready=null;
 const ensure=()=>ready||=pool.query(CLIENT_ERROR_SCHEMA).catch(error=>{ready=null;throw error;});
 app.post('/api/client-errors',requireSession,async(req,res)=>{
  const report=normalizeClientErrorReport(req.body);
  if(!report)return res.status(400).json({error:'A browser error report needs a message.'});
  const login=String(req.session?.login||req.session?.name||'');
  if(!limiter(login))return res.status(429).json({error:'Too many browser error reports. The latest ones are kept.'});
  const commit=String(serverCommit()||'');
  log.error?.(formatClientErrorLog(report,{login,serverCommit:commit}),report.stack?'\n'+report.stack:'' ,report.componentStack?'\n'+report.componentStack:'');
  try{
   await ensure();
   const inserted=await pool.query('INSERT INTO mis_client_errors(login,kind,ui_version,server_commit,screen,url,message,stack,component_stack,user_agent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
    [login,report.kind,report.uiVersion,commit,report.screen,report.url,report.message,report.stack,report.componentStack,text(req.get('user-agent'),LIMITS.userAgent)]);
   if(inserted.rows[0].id%200===0)await pool.query("DELETE FROM mis_client_errors WHERE created_at<NOW()-($1||' days')::interval",[String(CLIENT_ERROR_RETENTION_DAYS)]);
   res.json({recorded:true,id:inserted.rows[0].id});
  }catch(error){
   // The log line above already holds the report; storage trouble must not hide it.
   log.error?.('Browser error report could not be stored:',error?.message||String(error));
   res.json({recorded:false});
  }
 });
 app.get('/api/client-errors',requireSession,requireAdministrator,async(req,res)=>{
  const limit=Math.min(Math.max(Number(req.query.limit)||50,1),500);
  try{
   await ensure();
   const {rows}=await pool.query('SELECT id,login,kind,ui_version,server_commit,screen,url,message,stack,component_stack,user_agent,created_at FROM mis_client_errors ORDER BY id DESC LIMIT $1',[limit]);
   res.set('Cache-Control','no-store').json({errors:rows});
  }catch(error){res.status(500).json({error:error?.message||'Browser error reports are unavailable.'});}
 });
}
