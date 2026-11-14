// Calls to api.telegram.org over IPv4 only.
//
// 15 Nov 2026: every Telegram call from the live app waited 15 s and gave up (the MIS bot could not be saved),
// while Gemini calls worked. The app has no IPv6 route out, Telegram has one IPv4 and one IPv6 address, and a
// check from the same host connected to Telegram's IPv4 address in 0.17 s. Connecting over IPv4 only removes the
// stall. The answer looks like fetch's (ok, status, json(), text()) so callers and tests stay the same.
import https from 'node:https';

export function telegramFetch(url,{method='GET',headers={},body,signal}={}){
 return new Promise((resolve,reject)=>{
  const target=new URL(url);
  if(target.protocol!=='https:'||target.hostname!=='api.telegram.org'){reject(new Error('telegramFetch only calls api.telegram.org.'));return;}
  const payload=body===undefined||body===null?null:Buffer.isBuffer(body)?body:Buffer.from(String(body));
  const request=https.request({host:target.hostname,path:target.pathname+target.search,method,family:4,
   headers:{...headers,...(payload?{'Content-Length':payload.length}:{})},timeout:15000},response=>{
   const chunks=[];
   response.on('data',chunk=>chunks.push(chunk));
   response.on('end',()=>{
    const text=Buffer.concat(chunks).toString('utf8');
    resolve({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,text:async()=>text,json:async()=>JSON.parse(text)});
   });
   response.on('error',reject);
  });
  const fail=code=>{const error=new Error('Telegram could not be reached.');error.code=code;request.destroy(error);};
  request.on('timeout',()=>fail('ETIMEDOUT'));
  request.on('error',error=>reject(Object.assign(new Error('Telegram could not be reached.'),{code:error.code||'ECONNECTION'})));
  if(signal){if(signal.aborted){fail('ETIMEDOUT');return;}signal.addEventListener('abort',()=>fail('ETIMEDOUT'),{once:true});}
  if(payload)request.write(payload);
  request.end();
 });
}
