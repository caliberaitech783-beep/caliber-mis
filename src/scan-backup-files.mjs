import {scanImageExtension,SCAN_IMAGE_EXTENSIONS} from '../public/scan-image-type.mjs';
export async function sha256(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
// Existing SSD files are reused only after verification; mismatches are never overwritten.
export async function verifiedFile(directory,name,bytes,expectedHash){
 let handle;
 try{handle=await directory.getFileHandle(name);const existing=await handle.getFile();if(existing.size!==bytes.byteLength||await sha256(await existing.arrayBuffer())!==expectedHash)throw Error(`${name} already exists with different contents. Select a different backup folder.`);return;}
 catch(error){if(error.name!=='NotFoundError')throw error;}
 handle=await directory.getFileHandle(name,{create:true});const writer=await handle.createWritable();
 try{await writer.write(bytes);await writer.close();}catch(error){try{await writer.abort()}catch{}throw error;}
 const saved=await handle.getFile();if(saved.size!==bytes.byteLength||await sha256(await saved.arrayBuffer())!==expectedHash)throw Error(`SSD verification failed for ${name}. The backup is incomplete.`);
}
// A card already on this SSD folder with the right checksum is not downloaded again when a backup resumes.
async function savedImage(folder,item){
 for(const ext of new Set(Object.values(SCAN_IMAGE_EXTENSIONS))){
  try{const file=await (await folder.getFileHandle(item.card_id+ext)).getFile();if(file.size===Number(item.image_bytes)&&await sha256(await file.arrayBuffer())===item.image_hash)return {ext,bytes:file.size};}
  catch(error){if(error.name!=='NotFoundError')throw error;}
 }
 return null;
}
const conflict=error=>/different contents|Invalid/.test(error?.message||'');
// Network blips are retried; a file conflict on the SSD is never retried.
export async function retry(task,{attempts=3,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(let attempt=1;;attempt++){
  try{return await task()}catch(error){if(attempt>=attempts||conflict(error)||error?.name==='NotAllowedError')throw error;await wait(1000*attempt);}
 }
}
export async function copyBackup({job,directory,api,image,onProgress=()=>{},workers=3,wait}){
 if(!/^[a-f0-9-]{36}$/i.test(job.id))throw Error('Invalid backup reference.');
 const folder=await directory.getDirectoryHandle('Pulse-II-'+job.id,{create:true});
 let after=null,count=0,bytes=0,reused=0;const failed=[];
 async function copy(item){
  if(!/^[a-f0-9-]{36}$/i.test(item.card_id))throw Error('Invalid card in backup.');
  let saved=await savedImage(folder,item),ext=saved?.ext;
  if(!saved){
   const content=await retry(async()=>{const content=await image(`/api/scan-backups/${job.id}/images/${item.card_id}`);if(content.byteLength!==Number(item.image_bytes)||await sha256(content)!==item.image_hash)throw Error('Downloaded image did not match its stored checksum.');return content},{wait});
   ext=scanImageExtension(new Uint8Array(content));
   await verifiedFile(folder,item.card_id+ext,content,item.image_hash);
  }else reused++;
  const metadata=new TextEncoder().encode(JSON.stringify({...item.metadata,imageFile:item.card_id+ext,imageSha256:item.image_hash},null,2)+'\n');
  await verifiedFile(folder,item.card_id+'.json',metadata,await sha256(metadata));
  if(!item.verified_at)await retry(()=>api(`/api/scan-backups/${job.id}/verified`,{cardId:item.card_id,sha256:item.image_hash}),{wait});
  count++;bytes+=Number(item.image_bytes);onProgress({count,bytes,failed:failed.length});
 }
 do{
  const page=await retry(()=>api(`/api/scan-backups/${job.id}/items${after?'?after='+after:''}`),{wait});
  const queue=[...page.items];
  await Promise.all(Array.from({length:Math.max(1,workers)},async()=>{
   for(let item=queue.shift();item;item=queue.shift()){
    try{await copy(item)}catch(error){if(conflict(error)||error?.name==='NotAllowedError')throw error;failed.push({cardId:item.card_id,error:error.message});onProgress({count,bytes,failed:failed.length});}
   }
  }));
  after=page.next;
 }while(after);
 if(failed.length)return {count,bytes,reused,failed,folder:folder.name,complete:false};
 const manifest=new TextEncoder().encode(JSON.stringify({version:1,backupId:job.id,from:job.window_start,toExclusive:job.window_end,cards:count,imageBytes:bytes,storage:'Hot',cloudImagesRetained:true},null,2)+'\n');
 await verifiedFile(folder,'backup-manifest.json',manifest,await sha256(manifest));
 await api(`/api/scan-backups/${job.id}/complete`,{destination:directory.name+'/'+folder.name});
 return {count,bytes,reused,failed,folder:folder.name,complete:true};
}
