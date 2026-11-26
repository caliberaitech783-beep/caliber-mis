// A committed card can outlive its HTTP response (proxy, upload or connection stall).
// Recover only by its existing save reference; never replay a write here.
export async function saveManualLogBook(save,{recover,timeoutMs=30_000,recoverAfterMs=8_000,recoverEveryMs=3_000}={}){
 const controller=new AbortController(),timers=new Set();
 const wait=ms=>new Promise(resolve=>{
  const done=()=>{clearTimeout(timer);timers.delete(timer);controller.signal.removeEventListener('abort',done);resolve();};
  const timer=setTimeout(done,ms);timers.add(timer);controller.signal.addEventListener('abort',done,{once:true});
 });
 const pending=()=>new Promise(()=>{});
 const recovery=async()=>{
  await wait(recoverAfterMs);
  while(!controller.signal.aborted){
   try{const record=await recover(controller.signal);if(record?.id&&record?.book_no&&record?.data)return record;}
   catch{} // The deadline still applies when the connection or lookup is unavailable.
   if(!controller.signal.aborted)await wait(recoverEveryMs);
  }
  return pending();
 };
 let deadline;
 try{
  return await Promise.race([
   Promise.resolve().then(()=>save(controller.signal)).then(record=>{
    if(!record?.id||!record?.book_no||!record?.data)throw new TypeError('Invalid save acknowledgement');
    return record;
   }).catch(error=>{
    if(recover&&(error?.name==='TypeError'||error?.name==='AbortError'))return pending();
    throw error;
   }),
   recover?recovery():pending(),
   new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Object.assign(new Error('The server has not confirmed this save yet. Your entry has been kept. Check the saved register before retrying; do not start a new entry for this card.'),{code:'SAVE_UNCONFIRMED'})),timeoutMs);}),
  ]);
 }finally{clearTimeout(deadline);controller.abort();for(const timer of timers)clearTimeout(timer);}
}
