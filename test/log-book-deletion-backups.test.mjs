import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {inspectDeletionBackup,removeDeletionBackups} from '../src/log-book-deletion-backups.mjs';
import {sha256} from '../src/scan-backup-files.mjs';
import {createScanBlobStorage} from '../scan-blob-storage.mjs';

test('SSD preview is read-only; removal needs verified OTP, checks fingerprints and preserves unlisted files',async()=>{
 const card=randomUUID(),backup=randomUUID(),image=new TextEncoder().encode('source image'),imageHash=await sha256(image);
 const name='Pulse-II-'+backup,files=new Map(),removed=[];
 const folder={name,async queryPermission(){return 'granted';},async getFileHandle(file){if(!files.has(file))throw Object.assign(Error('missing'),{name:'NotFoundError'});return {async getFile(){const bytes=files.get(file);return {size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer};}};},async removeEntry(file){removed.push(file);files.delete(file);}};
 files.set(card+'.png',image);files.set(card+'.json',new TextEncoder().encode(JSON.stringify({cardId:card,imageFile:card+'.png',imageSha256:imageHash,draft:{private:'source'}})));files.set('backup-manifest.json',new TextEncoder().encode('preserve'));
 const expected=['.png','.json'].map(ext=>({key:backup+'/'+card+ext,backup_id:backup,card_id:card,folderName:name,filename:card+ext,imageFilename:card+'.png',imageHash,kind:ext==='.json'?'metadata':'image',expectedBytes:ext==='.json'?null:String(image.length)}));
 const inspected=await inspectDeletionBackup(folder,expected);assert.equal(inspected.length,2);assert.equal(removed.length,0);assert.equal(files.size,3);
 const state={otpVerified:false,databaseDeleted:false,scopeHash:'bound-scope',pendingFiles:inspected,files:expected},folders=new Map([[name,folder]]),receipts=[];
 await assert.rejects(()=>removeDeletionBackups({state,folders,onReceipt:r=>receipts.push(r)}),/OTP/);assert.equal(removed.length,0);
 state.otpVerified=true;state.databaseDeleted=true;
 files.set(card+'.png',new TextEncoder().encode('changed image'));await assert.rejects(()=>removeDeletionBackups({state,folders,onReceipt:r=>receipts.push(r)}),/changed after approval/);assert.equal(removed.length,0);files.set(card+'.png',image);
 folder.queryPermission=async()=> 'prompt';await assert.rejects(()=>removeDeletionBackups({state,folders,onReceipt:r=>receipts.push(r)}),/access is unavailable/);assert.equal(removed.length,0);folder.queryPermission=async()=> 'granted';
 let failReceipt=true;await assert.rejects(()=>removeDeletionBackups({state,folders,onReceipt:async()=>{if(failReceipt)throw Error('Network unavailable');}}),/Network/);assert.equal(removed.length,1);failReceipt=false;
 await removeDeletionBackups({state,folders,onReceipt:r=>receipts.push(r)});assert.equal(receipts.length,2);assert.equal(receipts[0].status,'already-absent');assert.equal(receipts[1].status,'deleted');assert.deepEqual([...files.keys()],['backup-manifest.json']);
 await assert.rejects(()=>inspectDeletionBackup({...folder,name:'wrong folder'},expected),/exact backup folder/);
 await assert.rejects(()=>inspectDeletionBackup(folder,[{...expected[0],filename:'../outside.png'}]),/exact backup folder/);
 const absent=await inspectDeletionBackup(folder,expected);assert.ok(absent.every(f=>f.exists===false));
});

test('cloud deletion is conditional on the exact previewed image version',async()=>{
 const calls=[],key='vehicle/'+randomUUID()+'/'+randomUUID()+'.png';
 const storage=createScanBlobStorage({account:'testscanstorage',container:'scanned-cards'},{env:{IDENTITY_ENDPOINT:'http://identity/token',IDENTITY_HEADER:'test'},fetchImpl:async(url,options)=>{
  if(String(url).startsWith('http:'))return Response.json({access_token:'token',expires_on:Date.now()/1000+3600});
  calls.push(options);
  if(options.method==='HEAD')return new Response(null,{headers:{etag:'"v1"','content-length':'4','x-ms-meta-sha256':'abc'}});
  return new Response(null,{status:options.headers['If-Match']==='"v1"'?204:412});
 }});
 const preview=await storage.stat(key);assert.equal(preview.etag,'"v1"');assert.equal(preview.bytes,4);assert.equal(preview.sha256,'abc');
 await assert.rejects(()=>storage.remove(key,{etag:'"v2"'}),e=>e.status===412);
 await storage.remove(key,{etag:preview.etag});assert.equal(calls.at(-1).headers['If-Match'],'"v1"');assert.equal(calls.at(-1).headers['x-ms-delete-snapshots'],'include');
});
