// Bound optional remote work without holding a database connection. A late
// response is observed by Promise.race but cannot change the saved fallback.
export async function readSaveBreakdownRequests(read,{timeoutMs=5000}={}){
 let timer;
 try{
  return await Promise.race([
   Promise.resolve().then(read),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Pulse breakdown hours did not respond within 5 seconds. Manual BD hours are used when provided; otherwise BD hours remain unknown.')),timeoutMs);})
  ]);
 }finally{clearTimeout(timer);}
}
