import test from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';import{pathToFileURL}from'node:url';
test('patched OCR image library handles supported scans through Transformers preprocessing',async()=>{
 const prefix=process.env.OCR_SECURITY_RUNTIME_PREFIX,require=createRequire(prefix?prefix+'/check.cjs':import.meta.url),sharp=require('sharp');
 const version=sharp.versions.sharp.split('.').map(Number);assert.ok(version[0]>0||version[1]>35||version[1]===35&&version[2]>=5,'OCR must use the patched sharp release');
 const {RawImage}=await import(prefix?pathToFileURL(prefix+'/node_modules/@huggingface/transformers/src/transformers.js').href:'@huggingface/transformers');
 for(const format of ['png','jpeg','webp']){
  const bytes=await sharp({create:{width:32,height:24,channels:3,background:'#fff'}})[format]().toBuffer();const image=await RawImage.fromBlob(new Blob([bytes],{type:'image/'+format}));
  assert.equal(image.width,32);assert.equal(image.height,24);assert.equal((await image.resize(16,12)).width,16);
 }
});
