// The chosen SSD folder is remembered in this browser only, so the next backup can reuse it.
const DB='pulse-ii-scan-backup',STORE='folders',KEY='ssd';
function open(){
 return new Promise((resolve,reject)=>{const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
async function run(mode,action){
 const db=await open();
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),request=action(tx.objectStore(STORE));tx.oncomplete=()=>resolve(request?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
 finally{db.close()}
}
export async function rememberedFolder(){try{if(typeof indexedDB==='undefined')return null;return (await run('readonly',store=>store.get(KEY)))||null}catch{return null}}
export async function rememberFolder(handle){try{if(typeof indexedDB!=='undefined')await run('readwrite',store=>store.put(handle,KEY))}catch{}}
export async function forgetFolder(){try{if(typeof indexedDB!=='undefined')await run('readwrite',store=>store.delete(KEY))}catch{}}
// Reusing a remembered folder needs the browser's write permission again; the request must run from a click.
export async function folderWithPermission(handle){
 if(!handle?.queryPermission)return null;
 const options={mode:'readwrite'};
 if(await handle.queryPermission(options)==='granted')return handle;
 return await handle.requestPermission(options)==='granted'?handle:null;
}
