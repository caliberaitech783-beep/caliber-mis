// A card upload is safe to repeat: the server keys every card on the
// uploadKey the browser generated, so a second POST of the same card returns
// the stored card instead of a second copy. That makes it safe to wait out a
// server restart (a deployment, a scale event) in the middle of a 40-card
// upload instead of failing the rest of the batch.
export const UPLOAD_RETRY_DELAYS_MS=[1000,2000,3000,5000,8000,13000];
const TRANSIENT_MESSAGE=/starting or reconnecting|unavailable|interrupted|network|gateway|timed? ?out|\b50[234]\b/i;

export function isTransientUploadError(error){
 if(!error)return false;
 if(error.name==='AbortError')return false;
 if(error.name==='TypeError')return true;
 if(Number.isInteger(error.status)&&[408,425,429,502,503,504].includes(error.status))return true;
 return TRANSIENT_MESSAGE.test(String(error.message||''));
}

export async function uploadWithRetry(send,{signal=null,delays=UPLOAD_RETRY_DELAYS_MS,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onRetry=()=>{}}={}){
 for(let attempt=0;;attempt++){
  try{return await send(attempt);}
  catch(error){
   if(signal?.aborted||attempt>=delays.length||!isTransientUploadError(error))throw error;
   onRetry({attempt:attempt+1,remaining:delays.length-attempt,error});
   await sleep(delays[attempt]);
   if(signal?.aborted)throw error;
  }
 }
}
