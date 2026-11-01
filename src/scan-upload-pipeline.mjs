const abortError=()=>new DOMException('Upload aborted.','AbortError');

// Retain only the first counted PDF, so the common single-PDF upload opens once
// without holding every selected PDF in memory at the same time.
export function createPdfUploadSession(open){
 let retained=null,closed=false;
 const ensure=()=>{if(closed)throw Error('PDF upload session is closed.');};
 return {
  async count(file,signal){
   ensure();const entry=await open(file,signal),count=entry.doc.numPages;
   if(!retained)retained={file,...entry};else await entry.task.destroy();
   return count;
  },
  async take(file,signal){
   ensure();if(retained?.file===file){const entry=retained;retained=null;return entry;}
   return open(file,signal);
  },
  async dispose(){closed=true;const entry=retained;retained=null;if(entry)await entry.task.destroy();}
 };
}

// Prepare one card ahead while up to `concurrency` requests are uploading.
// Sends start in page order; the caller assigns ordinals in that order so
// responses may finish in any order. After a failure no further card starts,
// but requests already in flight are awaited so their results are known.
export async function transferScanGroups(groups,{prepare,send,signal,concurrency=1}){
 if(!Number.isInteger(concurrency)||concurrency<1)throw Error('Upload concurrency must be a positive integer.');
 const iterator=groups[Symbol.asyncIterator]();
 const check=()=>{if(signal?.aborted)throw abortError();};
 const next=async()=>{try{check();const item=await iterator.next();if(item.done)return {done:true};check();return {group:item.value,body:await prepare(item.value)};}catch(error){return {error};}};
 const inflight=new Set();let failure;
 let pending=next();
 try{
  for(;;){
   while(inflight.size>=concurrency&&!failure)await Promise.race(inflight);
   if(failure)break;
   const item=await pending;if(failure)break;if(item.error){failure=item.error;break;}if(item.done)break;
   pending=next();check();
   const task=send(item.group,item.body).then(()=>inflight.delete(task),error=>{inflight.delete(task);failure??=error;});
   inflight.add(task);
  }
  await Promise.all(inflight);if(failure)throw failure;
 }finally{
  await Promise.all(inflight);await pending;await iterator.return?.();
 }
}
