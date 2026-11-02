// Sends browser-side failures to POST /api/client-errors so a crashed screen can
// be diagnosed from the server log instead of from a console nobody saw.
// Reporting never throws and never blocks the screen: a failed report is dropped.
const MAX_REPORTS_PER_PAGE=25;
let tokenReader=null,sent=0;
const recent=new Map();

export function configureClientErrorReporting({getToken}={}){tokenReader=typeof getToken==='function'?getToken:null;}

function storedToken(){
 try{if(tokenReader){const token=tokenReader();if(token)return String(token);}}catch{}
 try{
  const raw=localStorage.getItem('nerveCenterSession')||sessionStorage.getItem('nerveCenterSession')||'null';
  return String(JSON.parse(raw)?.token||'');
 }catch{return '';}
}

export function buildClientErrorReport(error,{kind='render',componentStack='',uiVersion='',location=globalThis.location,document=globalThis.document}={}){
 const detail=error&&typeof error==='object'?error:{message:String(error??'')};
 const message=String(detail.message||detail.reason?.message||detail.reason||detail||'Unknown error').slice(0,2000);
 return {
  kind,
  message,
  stack:String(detail.stack||detail.reason?.stack||'').slice(0,16000),
  componentStack:String(componentStack||'').slice(0,8000),
  uiVersion:String(uiVersion||document?.documentElement?.dataset?.caliberUiVersion||'').slice(0,64),
  screen:String(document?.title||'').slice(0,200),
  url:location?String(location.pathname||'')+String(location.search||'')+String(location.hash||''):'',
 };
}

// The same message from the same screen is reported once per minute.
export function shouldReport(report,{now=Date.now(),windowMs=60_000,budget=MAX_REPORTS_PER_PAGE}={}){
 if(sent>=budget)return false;
 const key=report.kind+'|'+report.screen+'|'+report.message.slice(0,200);
 const last=recent.get(key)||0;
 if(now-last<windowMs)return false;
 recent.set(key,now);
 return true;
}

export function resetClientErrorReporting(){sent=0;recent.clear();}

export function reportClientError(error,options={}){
 try{
  const report=buildClientErrorReport(error,options);
  if(!shouldReport(report))return Promise.resolve(false);
  sent+=1;
  const token=storedToken();
  if(!token||typeof fetch!=='function')return Promise.resolve(false);
  const body=JSON.stringify(report);
  return fetch('/api/client-errors',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body,keepalive:true}).then(response=>response.ok).catch(()=>false);
 }catch{return Promise.resolve(false);}
}

// Window-level failures outside React's render tree (event handlers, timers, promises).
export function installGlobalErrorReporting(target=globalThis){
 if(!target||typeof target.addEventListener!=='function'||target.__caliberErrorReporting)return false;
 target.__caliberErrorReporting=true;
 target.addEventListener('error',event=>{void reportClientError(event?.error||event?.message||'Script error',{kind:'window'});});
 target.addEventListener('unhandledrejection',event=>{void reportClientError(event?.reason||'Unhandled promise rejection',{kind:'promise'});});
 return true;
}
