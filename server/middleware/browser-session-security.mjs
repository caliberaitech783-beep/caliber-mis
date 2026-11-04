import {createHmac,timingSafeEqual} from 'node:crypto';
export const BROWSER_SESSION_MARKER='browser-session';
export const SESSION_COOKIE='__Host-mis_session',CSRF_COOKIE='__Host-mis_csrf';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const cookie=(req,name)=>String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
const options={httpOnly:true,secure:true,sameSite:'strict',path:'/'};
export const csrfFor=token=>createHmac('sha256',token).update('mis-csrf-v1').digest('base64url');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const authPaths=new Set(['/api/login','/api/change-initial-password','/api/mis-credentials/login','/api/mis-credentials/session','/api/mis-sso/session']);
export function browserSessionMiddleware({publicUrl='https://pulse-ll.cmll.in',enabled=true}={}){
 const origin=new URL(publicUrl).origin;
 return (req,res,next)=>{
  if(!enabled||!req.path.startsWith('/api/'))return next();
  const unsafe=!['GET','HEAD','OPTIONS'].includes(req.method),presented=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim(),token=cookie(req,SESSION_COOKIE);
  const usesCookie=(!presented||presented===BROWSER_SESSION_MARKER)&&uuid(token);
  if(usesCookie||presented){res.set('Cache-Control','no-store');res.vary('Cookie');res.vary('Authorization');}
  if(presented===BROWSER_SESSION_MARKER&&!usesCookie)return res.status(401).json({error:'Your sign-in has expired. Sign in through Pulse again.'});
  // Even sibling subdomains must not initiate credentialed mutations or login.
  if((usesCookie&&unsafe)||(authPaths.has(req.path)&&unsafe)||req.path==='/api/security/session/migrate'){
   if(req.get('sec-fetch-site')==='cross-site'||(req.get('origin')&&req.get('origin')!==origin))return res.status(403).json({error:'This request must originate from MIS.',code:'CSRF_REJECTED'});
  }
  if(usesCookie){
   if(unsafe&&!equal(req.get('x-csrf-token'),csrfFor(token)))return res.status(403).json({error:'Refresh MIS and try again.',code:'CSRF_REJECTED'});
   req.headers.authorization='Bearer '+token;req.browserSession=true;
  }
  req.establishBrowserSession=value=>{
   if(!uuid(value))throw Error('Invalid browser session');
   // MIS shared sign-in was tab/session based; do not introduce a persistent
   // credential on shared PCs. Database and central-grant expiry still apply.
   res.cookie(SESSION_COOKIE,value,options);
   res.cookie(CSRF_COOKIE,csrfFor(value),{...options,httpOnly:false});
  };
  if(authPaths.has(req.path)){
   const json=res.json.bind(res);res.json=body=>{
    if(uuid(body?.token)&&res.statusCode<300){req.establishBrowserSession(body.token);body={...body,token:BROWSER_SESSION_MARKER,browserSession:true};res.set('Cache-Control','no-store');}
    return json(body);
   };
  }
  if(['/api/logout','/api/mis-credentials/logout'].includes(req.path)){
   res.clearCookie(SESSION_COOKIE,options);res.clearCookie(CSRF_COOKIE,{...options,httpOnly:false});
  }
  return next();
 };
}
