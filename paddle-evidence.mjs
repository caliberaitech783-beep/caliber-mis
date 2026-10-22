import {createHash} from 'node:crypto';
import {paddleLayout} from './paddle-layout.mjs';
const invalid=()=>{throw Object.assign(new Error('Local OCR evidence is invalid or belongs to a different scan. Re-read this page on the PC.'),{status:400})};
export function validatePaddleEvidence(value,image){
 image=Buffer.from(image);if(image.length<24||image.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')invalid();
 if(!value||value.version!==1||value.provider!=='paddleocr'||value.imageHash!==createHash('sha256').update(image).digest('hex'))invalid();
 const width=image.readUInt32BE(16),height=image.readUInt32BE(20);
 if(value.imageSize?.length!==2||value.imageSize[0]!==width||value.imageSize[1]!==height||!Number.isFinite(value.confidence)||value.confidence<0||value.confidence>100||typeof value.text!=='string'||value.text.length>100000||value.pages?.length!==1)invalid();
 const p=value.pages[0],count=p.rec_texts?.length;
 if(!Number.isInteger(count)||count>3000||p.rec_boxes?.length!==count||p.rec_scores?.length!==count)invalid();
 let characters=0;
 const texts=p.rec_texts.map(t=>{if(typeof t!=='string'||t.length>1000)invalid();characters+=t.length;return t});if(characters>100000)invalid();
 const boxes=p.rec_boxes.map(b=>{if(!Array.isArray(b)||b.length!==4||b.some(n=>!Number.isFinite(n))||b[0]<0||b[1]<0||b[2]>width||b[3]>height||b[2]<=b[0]||b[3]<=b[1])invalid();return [...b]});
 const scores=p.rec_scores.map(n=>{if(!Number.isFinite(n)||n<0||n>1)invalid();return n});
 const regions={};for(const key of ['bookDate','door','employeeCode','cardNo','tripCardNo','openingHmr','closingHmr','openingKmr','closingKmr'])if(value.regions?.[key]){const v=value.regions[key];if(typeof v.text!=='string'||v.text.length>256)invalid();regions[key]={text:v.text};}
 return {version:1,provider:'paddleocr',model:'PP-OCRv5 mobile',imageHash:value.imageHash,imageSize:[width,height],text:value.text,confidence:value.confidence,pages:[{rec_texts:texts,rec_boxes:boxes,rec_scores:scores}],regions};
}
export function createPaddleEvidence(result,image){return validatePaddleEvidence({...result,version:1,imageHash:createHash('sha256').update(image).digest('hex')},image)}
export function paddleEvidenceResult(value,image,kind){const evidence=validatePaddleEvidence(value,image);return {...evidence,...paddleLayout(evidence,{kind})}}
