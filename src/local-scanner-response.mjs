// Errors carry the HTTP status, and `transient: true` when the server said the
// failure is temporary (its own JSON body, or a gateway 502/503/504 page while
// the app restarts), so callers can wait and retry instead of showing a hard stop.
const GATEWAY_BUSY=new Set([502,503,504]);
export async function readScannerResponse(response,{mis=false}={}){
 const text=await response.text();let data;
 const gatewayBusy=GATEWAY_BUSY.has(response.status);
 const service=mis?'The MIS server':'The local scanner service';
 const failure=(message,transient)=>Object.assign(new Error(message),{status:response.status,...(transient?{transient:true}:{})});
 try{data=JSON.parse(text)}catch{
  if(response.status===401)throw failure('Your session expired. Sign in again.');
  if(mis)throw failure(service+' returned an unexpected response (HTTP '+response.status+').',gatewayBusy||response.ok);
  throw failure(service+' is starting or reconnecting. This page will retry automatically.',gatewayBusy);
 }
 // `code` names a refusal the page answers itself (a question it puts to the person), not only shows.
 if(!response.ok)throw Object.assign(failure(data?.error||service+' is unavailable.',data?.transient===true||(mis&&gatewayBusy)),data?.latest?{latest:data.latest}:{},typeof data?.code==='string'?{code:data.code}:{});
 if(!data||typeof data!=='object'||(mis&&Array.isArray(data)))throw failure(mis?service+' returned an invalid response.':service+' returned an invalid response. Refresh scanners to retry.',mis);
 return data;
}
