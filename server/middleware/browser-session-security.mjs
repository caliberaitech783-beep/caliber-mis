import {createHmac,timingSafeEqual,randomBytes} from 'node:crypto';
export const BROWSER_SESSION_MARKER='browser-session';
export const SESSION_COOKIE='__Host-mis_session',CSRF_COOKIE='__Host-mis_csrf',REMEMBER_COOKIE='__Host-mis_remember';
export const REMEMBER_DEVICE_MS=30*24*60*60*1000;
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const cookie=(req,name)=>String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
const contextId=value=>/^browser-session\.([A-Za-z0-9_-]{16})$/.exec(value||'')?.[1]||'';
const isMarker=value=>value===BROWSER_SESSION_MARKER||Boolean(contextId(value));
const options={httpOnly:true,secure:true,sameSite:'strict',path:'/'};
export const csrfFor=token=>createHmac('sha256',token).update('mis-csrf-v1').digest('base64url');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const authPaths=new Set(['/api/login','/api/change-initial-password','/api/mis-credentials/login','/api/mis-credentials/session','/api/mis-sso/session']);
export function browserSessionMiddleware({publicUrl='https://pulse-ll.cmll.in',enabled=true}={}){
 const origin=new URL(publicUrl).origin;
 return (req,res,next)=>{
  if(!enabled||!req.path.startsWith('/api/'))return next();
  const unsafe=!['GET','HEAD','OPTIONS'].includes(req.method),presented=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  let id=contextId(presented),token=id?cookie(req,SESSION_COOKIE+'_'+id):presented===BROWSER_SESSION_MARKER?cookie(req,SESSION_COOKIE):'';
  if(!presented&&!authPaths.has(req.path)){
   const contexts=String(req.headers.cookie||'').split(';').map(x=>x.trim()).map(x=>/^__Host-mis_session_([A-Za-z0-9_-]{16})=(.*)$/.exec(x)).filter(x=>x&&uuid(x[2]));
   if(contexts.length===1){id=contexts[0][1];token=contexts[0][2];}else if(!contexts.length)token=cookie(req,SESSION_COOKIE);
  }
  const usesCookie=(!presented||isMarker(presented))&&uuid(token);
  if(usesCookie||presented){res.set('Cache-Control','no-store');res.vary('Cookie');res.vary('Authorization');}
  if(isMarker(presented)&&!usesCookie)return res.status(401).json({error:'Your sign-in has expired. Sign in through Pulse again.'});
  // Even sibling subdomains must not initiate credentialed mutations or login.
  if((usesCookie&&unsafe)||(authPaths.has(req.path)&&unsafe)||req.path==='/api/security/session/migrate'){
   if(req.get('sec-fetch-site')==='cross-site'||(req.get('origin')&&req.get('origin')!==origin))return res.status(403).json({error:'This request must originate from MIS.',code:'CSRF_REJECTED'});
  }
  if(usesCookie){
   if(unsafe&&!equal(req.get('x-csrf-token'),csrfFor(token)))return res.status(403).json({error:'Refresh MIS and try again.',code:'CSRF_REJECTED'});
   req.headers.authorization='Bearer '+token;req.browserSession=true;
   req.browserSessionId=id;
  }
  req.establishBrowserSession=(value,{newContext=false}={})=>{
   if(!uuid(value))throw Error('Invalid browser session');
   // MIS shared sign-in is tab/session based by default, so shared site PCs
   // never keep a credential after the browser closes. Only a person who ticked
   // "Remember me" on the Pulse sign-in page gets cookies that survive a browser
   // restart; they last REMEMBER_DEVICE_MS and renew each time MIS is opened.
   const selected=!newContext&&req.browserSessionId||randomBytes(12).toString('base64url');
   const remember=newContext?req.rememberDevice===true:Boolean(req.browserSessionId)&&cookie(req,REMEMBER_COOKIE+'_'+req.browserSessionId)==='1';
   req.browserSessionId=selected;req.browserSessionMarker=BROWSER_SESSION_MARKER+'.'+selected;
   // Tells the page it may keep its pointer (the marker, not a credential) on the device.
   req.browserSessionRemembered=remember;
   const lifetime=remember?{maxAge:REMEMBER_DEVICE_MS}:{};
   res.cookie(SESSION_COOKIE+'_'+selected,value,{...options,...lifetime});
   res.cookie(CSRF_COOKIE+'_'+selected,csrfFor(value),{...options,httpOnly:false,...lifetime});
   if(remember)res.cookie(REMEMBER_COOKIE+'_'+selected,'1',{...options,...lifetime});
   return req.browserSessionMarker;
  };
  if(authPaths.has(req.path)){
   const json=res.json.bind(res);res.json=body=>{
    if(uuid(body?.token)&&res.statusCode<300){const marker=req.establishBrowserSession(body.token,{newContext:true});body={...body,token:marker,browserSession:true,rememberDevice:req.browserSessionRemembered===true};res.set('Cache-Control','no-store');}
    return json(body);
   };
  }
  if(['/api/logout','/api/mis-credentials/logout'].includes(req.path)){
   const suffix=req.browserSessionId?'_'+req.browserSessionId:'';
   res.clearCookie(SESSION_COOKIE+suffix,options);res.clearCookie(CSRF_COOKIE+suffix,{...options,httpOnly:false});
   if(suffix)res.clearCookie(REMEMBER_COOKIE+suffix,options);
  }
  return next();
 };
}
