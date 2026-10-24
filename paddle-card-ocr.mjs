import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function readPaddleCard(image,{python=process.env.PADDLEOCR_PYTHON,timeout=240000}={}){
 if(!python)throw new Error('PADDLEOCR_PYTHON is not configured.');
 const directory=await mkdtemp(path.join(os.tmpdir(),'mis-paddle-'));
 try{
  const input=path.join(directory,'card.png');await writeFile(input,image);
  return await new Promise((resolve,reject)=>{
   const child=spawn(python,[fileURLToPath(new URL('./scripts/paddle-card-ocr.py',import.meta.url)),input],{windowsHide:true,env:{...process.env,PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK:'True'}});
   let stdout='',stderr='',settled=false;
   const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result)};
   const timer=setTimeout(()=>{child.kill();finish(new Error('PaddleOCR timed out. The card remains available for retry.'))},timeout);
   child.stdout.on('data',data=>{stdout+=data;if(stdout.length>10000000){child.kill();finish(new Error('PaddleOCR output exceeded the limit.'))}});
   child.stderr.on('data',data=>{stderr=(stderr+data).slice(-4000)});
   child.on('error',error=>finish(error));
   child.on('close',code=>{if(code!==0)return finish(new Error('PaddleOCR failed: '+stderr.slice(-1200)));try{const result=JSON.parse(stdout);if(typeof result.text!=='string'||!Number.isFinite(result.confidence))throw new Error('Invalid PaddleOCR response');finish(null,result)}catch(error){finish(error)}});
  });
 }finally{await rm(directory,{recursive:true,force:true})}
}
