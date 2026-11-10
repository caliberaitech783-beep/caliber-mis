// Errors carry the HTTP status, and `transient: true` when the server said the
// failure is temporary (its own JSON body, or a gateway 502/503/504 page while
// the app restarts), so callers can wait and retry instead of showing a hard stop.
const GATEWAY_BUSY=new Set([502,503,504]);
export async function readScannerResponse(response){
 const text=await response.text();let data;
 const failure=(message,transient)=>Object.assign(new Error(message),{status:response.status,...(transient?{transient:true}:{})});
 try{data=JSON.parse(text)}catch{throw failure(response.status===401?'Your session expired. Sign in again.':'The local scanner service is starting or reconnecting. This page will retry automatically.',GATEWAY_BUSY.has(response.status));}
 if(!response.ok)throw failure(data?.error||'The local scanner service is unavailable.',data?.transient===true);
 if(!data||typeof data!=='object')throw failure('The local scanner service returned an invalid response. Refresh scanners to retry.');
 return data;
}
