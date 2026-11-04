import test from 'node:test';
import assert from 'node:assert/strict';
import {scanUploadType,SCAN_UPLOAD_ACCEPT} from '../src/scan-upload-file.mjs';
test('scan uploads accept PNG, JPG, JPEG and PDF with or without browser MIME metadata',()=>{
 for(const [extension,mime] of [['png','image/png'],['jpg','image/jpeg'],['jpeg','image/jpeg'],['pdf','application/pdf']]){
  for(const type of ['',mime,'application/octet-stream'])assert.equal(scanUploadType({name:'CARD.'+extension.toUpperCase(),type}),mime);
  assert.ok(SCAN_UPLOAD_ACCEPT.includes('.'+extension));assert.ok(SCAN_UPLOAD_ACCEPT.includes(mime));
 }
 assert.equal(scanUploadType({name:'card.jpg',type:'image/jpg'}),'image/jpeg');
 assert.throws(()=>scanUploadType({name:'card.exe',type:''}),/Use a PDF/);
 assert.throws(()=>scanUploadType({name:'card.png',type:'text/html'}),/Use a PDF/);
});
