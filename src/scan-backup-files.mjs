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
export async function copyBackup({job,directory,api,image,onProgress=()=>{}}){
 if(!/^[a-f0-9-]{36}$/i.test(job.id))throw Error('Invalid backup reference.');
 const folder=await directory.getDirectoryHandle('Pulse-II-'+job.id,{create:true});
 let after=null,count=0,bytes=0;
 do{
  const page=await api(`/api/scan-backups/${job.id}/items${after?'?after='+after:''}`);
  for(const item of page.items){
   if(!/^[a-f0-9-]{36}$/i.test(item.card_id))throw Error('Invalid card in backup.');
   const content=await image(`/api/scan-backups/${job.id}/images/${item.card_id}`);
   if(content.byteLength!==Number(item.image_bytes)||await sha256(content)!==item.image_hash)throw Error('Downloaded image did not match its stored checksum.');
   const ext=new Uint8Array(content)[0]===255?'.jpg':'.png';
   await verifiedFile(folder,item.card_id+ext,content,item.image_hash);
   const metadata=new TextEncoder().encode(JSON.stringify({...item.metadata,imageFile:item.card_id+ext,imageSha256:item.image_hash},null,2)+'\n');
   await verifiedFile(folder,item.card_id+'.json',metadata,await sha256(metadata));
   await api(`/api/scan-backups/${job.id}/verified`,{cardId:item.card_id,sha256:item.image_hash});
   count++;bytes+=content.byteLength;onProgress({count,bytes});
  }
  after=page.next;
 }while(after);
 const manifest=new TextEncoder().encode(JSON.stringify({version:1,backupId:job.id,from:job.window_start,toExclusive:job.window_end,cards:count,imageBytes:bytes,storage:'Hot',cloudImagesRetained:true},null,2)+'\n');
 await verifiedFile(folder,'backup-manifest.json',manifest,await sha256(manifest));
 await api(`/api/scan-backups/${job.id}/complete`,{destination:directory.name+'/'+folder.name});
 return {count,bytes,folder:folder.name};
}
