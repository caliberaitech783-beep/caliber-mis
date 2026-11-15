// Worker thread for scan-fingerprint-pool.mjs: one fingerprint at a time.
import {parentPort} from 'node:worker_threads';
import {fingerprintScanImage} from './scan-fingerprint.mjs';

parentPort.on('message',async({id,image})=>{
 try{parentPort.postMessage({id,result:await fingerprintScanImage(Buffer.from(image.buffer,image.byteOffset,image.byteLength))});}
 catch(error){parentPort.postMessage({id,error:error?.message||String(error)});}
});
