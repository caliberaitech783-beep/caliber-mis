import {sha256} from './scan-backup-files.mjs';
const validName=name=>/^[a-f0-9-]{36}\.(png|jpg|json)$/i.test(name||'');
export async function inspectDeletionBackup(folder,files){
 if(!folder||!files.length||folder.name!==files[0].folderName||files.some(f=>f.folderName!==folder.name||!validName(f.filename)))throw Error('Choose the exact backup folder shown in the approval list.');
 const result=[];
 for(const expected of files){
  let file;try{file=await(await folder.getFileHandle(expected.filename)).getFile();}catch(e){if(e.name==='NotFoundError'){result.push({key:expected.key,exists:false,bytes:0,sha256:null});continue;}throw e;}
  const bytes=await file.arrayBuffer(),hash=await sha256(bytes);
  if(expected.kind==='image'&&(hash!==expected.imageHash||String(file.size)!==expected.expectedBytes))throw Error(expected.filename+' does not match the registered scan. Choose the correct backup folder.');
  if(expected.kind==='metadata'){
   let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error(expected.filename+' is not valid backup metadata.');}
   if(data.cardId!==expected.card_id||data.imageFile!==expected.imageFilename||data.imageSha256!==expected.imageHash)throw Error(expected.filename+' belongs to a different scan.');
  }
  result.push({key:expected.key,exists:true,bytes:file.size,sha256:hash});
 }
 return result;
}

export async function removeDeletionBackups({state,folders,onReceipt}){
 if(!state?.otpVerified||!state.databaseDeleted||!state.scopeHash)throw Error('Successful WhatsApp OTP verification is required before removing backup files.');
 for(const approved of state.pendingFiles){
  const expected=state.files.find(f=>f.key===approved.key),folder=folders.get(expected?.folderName);
  if(!expected||!folder||folder.name!==expected.folderName||!validName(expected.filename))throw Error('Choose the exact listed backup folder to resume cleanup.');
  if(folder.queryPermission&&await folder.queryPermission({mode:'readwrite'})!=='granted')throw Error('Backup folder access is unavailable. Choose the folder again to resume.');
  let file;try{file=await(await folder.getFileHandle(expected.filename)).getFile();}catch(e){if(e.name!=='NotFoundError')throw e;}
  let status='already-absent';
  if(file){
   if(file.size!==approved.bytes||await sha256(await file.arrayBuffer())!==approved.sha256)throw Error(expected.filename+' changed after approval. Cleanup stopped without deleting that file.');
   await folder.removeEntry(expected.filename); // Exact file only; never recursive.
   try{await folder.getFileHandle(expected.filename);throw Error('Backup file removal could not be verified.');}catch(e){if(e.name!=='NotFoundError')throw e;}
   status='deleted';
  }
  await onReceipt({...approved,status});
 }
}

export function sameDeletionFiles(left,right){
 const canonical=rows=>JSON.stringify([...rows].sort((a,b)=>a.key.localeCompare(b.key)).map(({key,exists,bytes,sha256})=>({key,exists,bytes,sha256})));
 return canonical(left)===canonical(right);
}
