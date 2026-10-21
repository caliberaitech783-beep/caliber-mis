import {loadImage,createCanvas} from '@napi-rs/canvas';
import path from 'node:path';
import {readingCellImages} from './trip-meter-ocr.mjs';
let recognizer;
export async function loadHandwritingModel(){
 if(!recognizer)recognizer=(async()=>{const {pipeline,env}=await import('@huggingface/transformers');env.cacheDir=process.env.HANDWRITING_MODEL_CACHE||path.join(import.meta.dirname,'ocr-model-cache');return pipeline('image-to-text','Xenova/trocr-small-handwritten',{revision:'2432e24d184b1d964d07ed04f5d9e21d31a59141',dtype:'q8',device:'cpu',session_options:{intraOpNumThreads:2,interOpNumThreads:1}})})().catch(e=>{recognizer=null;throw e});
 return recognizer;
}
export function cleanHandwrittenField(key,text){
 const value=String(text||'').trim().replace(/^["'“”‘’]+|["'“”‘’.,:;]+$/g,'').trim();
 if(key==='location')return /^[A-Za-z][A-Za-z .()/-]{2,60}$/.test(value)?value:'';
 if(key==='bookDate'){const m=value.match(/^(\d{1,2})\s*[/ .-]?\s*(\d{1,2})\s*[/ .-]?\s*(\d{2}|\d{4})$/);if(!m)return '';const date=`${m[3].length===2?'20'+m[3]:m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;return Number.isFinite(Date.parse(date))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date?date:'';}
 if(key==='door'){const v=value.toUpperCase().replace(/[ .-]/g,'');return /^[A-Z]{1,5}\d{1,6}$/.test(v)?v:'';}
 if(key==='employeeCode'){const v=value.replace(/^CMPL\s*[- ]*/i,'').replace(/\s/g,'');return /^\d{3,6}$/.test(v)?v:'';}
 // Reject letter substitutions rather than turning an uncertain B into 8.
 const number=value.replace(/\s/g,'');return /^\d{3,8}(?:\.\d{1,3})?$/.test(number)&&!/^0\d/.test(number)?number:'';
}
async function inkGroups(bytes){const im=await loadImage(bytes),c=createCanvas(im.width,im.height),ctx=c.getContext('2d');ctx.drawImage(im,0,0);const {data}=ctx.getImageData(0,0,c.width,c.height);let groups=0,active=false;for(let x=0;x<c.width;x++){let ink=0;for(let y=0;y<c.height;y++)if(data[(y*c.width+x)*4]<100)ink++;const on=ink>Math.max(2,c.height*.06);if(on&&!active)groups++;active=on;}return groups;}
export async function recognizeHandwrittenCard(bytes,text,{recognize}={}){
 const cells=await readingCellImages(bytes,text),loose=await readingCellImages(bytes,text,{tight:false});if(!Object.keys(cells).length)return {fields:{},candidates:{}};
 const {RawImage}=await import('@huggingface/transformers');const model=recognize||await loadHandwritingModel();const candidates={},fields={};
 for(const [key,bytes]of Object.entries(cells)){
  const image=await RawImage.fromBlob(new Blob([bytes],{type:'image/png'}));const result=await model(image,{max_new_tokens:28});const raw=result?.[0]?.generated_text||'';const value=cleanHandwrittenField(key,raw);const alternate=await model(await RawImage.fromBlob(new Blob([loose[key]],{type:'image/png'})),{max_new_tokens:28});const otherText=alternate?.[0]?.generated_text||'',other=cleanHandwrittenField(key,otherText);let conflict=Boolean(value&&other&&value!==other),chosen=conflict?'':value||other;const groups=key==='employeeCode'?await inkGroups(bytes):null;if(chosen&&groups>chosen.length){chosen='';conflict=true;}candidates[key]={text:raw,alternateText:otherText,value:chosen,conflict,inkGroups:groups,alternatives:[...new Set([value,other].filter(Boolean))],source:'TrOCR handwritten cell',needsReview:true};if(chosen)fields[key]=chosen;
 }
 return {fields,candidates};
}
