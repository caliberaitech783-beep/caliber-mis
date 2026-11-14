// Scan previews for the review page. Each card opened in review used to start its
// own download of the original scan, and leaving the card threw the bytes away, so
// on a site link every card showed "Loading scan preview…" for the whole download.
// Now the loader keeps the last few scans in memory, downloads the next cards in
// review order while the operator works on the current one, and reuses a download
// that is already running. Nothing is written to disk; the cache is cleared when
// the page is left or the sign-in changes.
export const SCAN_PREVIEW_CACHE_LIMIT=8,SCAN_PREVIEW_PREFETCH=2,SCAN_PREVIEW_TIMEOUT_MS=20000,SCAN_PREVIEW_ATTEMPTS=2;
// 15 November 2026: every refusal used to read "Could not load scan.", so nobody could
// tell an ended sign-in from a removed card or a busy server.
export async function scanPreviewFailure(response){
 if(response.status===401)return 'Your sign-in has ended. Sign in again to see the scan.';
 let reason='';
 try{const body=await response.json();reason=typeof body?.error==='string'?body.error.trim():'';}catch{}
 if(reason)return 'Could not load scan: '+reason;
 return response.status?'Could not load scan (server answered '+response.status+').':'Could not load scan.';
}
const pause=(ms,signal)=>new Promise(resolve=>{if(!ms||signal.aborted)return resolve();const timer=setTimeout(resolve,ms);signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
export function createScanPreviewLoader({fetch=(...args)=>globalThis.fetch(...args),trim,createObjectURL=blob=>URL.createObjectURL(blob),revokeObjectURL=url=>URL.revokeObjectURL(url),limit=SCAN_PREVIEW_CACHE_LIMIT,timeoutMs=SCAN_PREVIEW_TIMEOUT_MS,retryDelayMs=1000,now=Date.now}={}){
 const entries=new Map();let token='',current='';
 const release=entry=>{entry.controller.abort();if(entry.cropped&&entry.cropped!==entry.original)revokeObjectURL(entry.cropped);if(entry.original)revokeObjectURL(entry.original);};
 const forget=id=>{const entry=entries.get(id);if(!entry)return;entries.delete(id);release(entry);};
 const clear=()=>{for(const id of [...entries.keys()])forget(id);};
 const evict=()=>{while(entries.size>limit){let oldest=null;for(const [id,entry] of entries){if(id===current)continue;if(!oldest||entry.used<oldest.entry.used)oldest={id,entry};}if(!oldest)break;forget(oldest.id);}};
 const start=id=>{
  const controller=new AbortController(),entry={controller,used:now(),timedOut:false,original:'',cropped:'',blob:null,croppedPromise:null};
  const timer=setTimeout(()=>{entry.timedOut=true;controller.abort();},timeoutMs);
  entry.promise=(async()=>{
   try{
    // One automatic second try for a busy server or a dropped connection; a refusal
    // (card removed, sign-in ended) is final and its reason is shown as the server gave it.
    let response;
    for(let attempt=1;;attempt++){
     try{response=await fetch('/api/scan-cards/'+id+'/image',{signal:controller.signal,headers:{Authorization:'Bearer '+token}});}
     catch(error){if(controller.signal.aborted||attempt>=SCAN_PREVIEW_ATTEMPTS)throw error;await pause(retryDelayMs,controller.signal);continue;}
     if(response.ok||!(response.status>=500)||attempt>=SCAN_PREVIEW_ATTEMPTS)break;
     await pause(retryDelayMs,controller.signal);
    }
    if(!response.ok)throw new Error(await scanPreviewFailure(response));
    const blob=await response.blob();
    if(controller.signal.aborted)throw new Error('Could not load scan.');
    entry.blob=blob;entry.original=createObjectURL(blob);
    return entry;
   }catch(error){
    if(entries.get(id)===entry)entries.delete(id);
    throw entry.timedOut?new Error('The scan preview took too long to load.'):error;
   }finally{clearTimeout(timer);}
  })();
  entries.set(id,entry);evict();
  return entry;
 };
 return {
  setToken(value){if(value===token)return;token=value;clear();},
  // The selected card: its download, or the copy already in memory.
  load(id){current=id;const entry=entries.get(id)||start(id);entry.used=now();return entry.promise;},
  // The white scanner margins are cut once per card, after the original is shown.
  async cropped(id){
   const entry=entries.get(id);if(!entry||!entry.blob)return '';
   if(!entry.croppedPromise)entry.croppedPromise=Promise.resolve().then(()=>trim(entry.blob)).then(result=>{
    if(entries.get(id)!==entry)return '';
    entry.cropped=result&&result!==entry.blob?createObjectURL(result):entry.original;return entry.cropped;
   }).catch(()=>{entry.cropped=entry.original;return entry.original;});
   return entry.croppedPromise;
  },
  prefetch(ids){for(const id of ids)if(id&&!entries.has(id))start(id).promise.catch(()=>{});},
  has:id=>Boolean(entries.get(id)?.original),
  pending:id=>Boolean(entries.get(id))&&!entries.get(id).original,
  size:()=>entries.size,
  forget,clear
 };
}
