import path from 'node:path';

export function securityHeaders(req,res,next){
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','strict-origin-when-cross-origin');
  res.set('Content-Security-Policy',"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; frame-src 'self' blob: data:; media-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self' https: wss: ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*");
  if(req.secure)res.set('Strict-Transport-Security','max-age=31536000');
  next();
}

// Apply only at the static boundary: API exports and scanner modules remain usable.
export function protectStaticFiles(req,res,next){
  let name;
  try{name=decodeURIComponent(req.path).replaceAll('\\','/');}catch{return res.status(400).end();}
  name=path.posix.normalize(name);
  const parts=name.split('/');
  if(parts.some(part=>part.startsWith('.')&&part!=='.well-known')||
    /\.(?:map|log|sql|sqlite|db|pem|key|env|bak)$/i.test(name)||
    /\/(?:package(?:-lock)?\.json|server\.mjs|AGENTS\.md)$/i.test(name)||
    /^\/(?:server|src|test|scripts|node_modules|backups|outputs)(?:\/|$)/i.test(name))return res.status(404).end();
  next();
}

// Account-based throttling cannot be bypassed by spoofing forwarded IP headers.
// Bounded storage fails closed under saturation rather than evicting active limits.
export function createLoginLimiter({limit=20,windowMs=300000,maxEntries=10000,now=Date.now,key=req=>req.body?.username||''}={}){
  const entries=new Map();
  return (req,res,next)=>{
    const time=now();
    for(const [key,value] of entries)if(value.expires<=time)entries.delete(key);
    const id=String(key(req)).trim().toLowerCase().slice(0,120);
    let entry=entries.get(id);
    if(!entry&&entries.size<maxEntries){entry={count:0,expires:time+windowMs};entries.set(id,entry);}
    if(!entry||entry.count>=limit){
      res.set('Retry-After',String(Math.max(1,Math.ceil(((entry?.expires||time+windowMs)-time)/1000))));
      return res.status(429).json({error:'Too many sign-in attempts. Please try again later.'});
    }
    entry.count++;
    return next();
  };
}
