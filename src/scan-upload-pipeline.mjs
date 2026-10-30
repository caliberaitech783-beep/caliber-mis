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

// Prepare one card ahead while one ordered request is uploading.
// A failed upload cannot send later cards or change page order.
export async function transferScanGroups(groups,{prepare,send,signal}){
 const iterator=groups[Symbol.asyncIterator]();
 const check=()=>{if(signal?.aborted)throw abortError();};
 const next=async()=>{try{check();const item=await iterator.next();if(item.done)return {done:true};check();return {group:item.value,body:await prepare(item.value)};}catch(error){return {error};}};
 let pending=next();
 try{
  for(;;){
   const item=await pending;if(item.error)throw item.error;if(item.done)break;
   pending=next();check();await send(item.group,item.body);
  }
 }finally{
  await pending;await iterator.return?.();
 }
}
