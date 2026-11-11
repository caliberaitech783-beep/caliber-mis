import path from 'node:path';
import {scanImageMime,scanImageDimensions} from './scan-image-format.mjs';
import {validPdf,validOfficeDocument} from './attachment-document-validation.mjs';
export async function validateAttachment(filename,bytes){
 const ext=path.extname(String(filename)).toLowerCase();
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>10485760)throw Object.assign(Error('Choose a non-empty attachment up to 10 MB.'),{status:400});
 let valid=false;
 if(ext==='.pdf')valid=await validPdf(bytes).catch(()=>false);
 else if(['.png','.jpg','.jpeg','.webp'].includes(ext)){
  const mime=scanImageMime(bytes),expected=ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg';
  if(mime===expected){try{scanImageDimensions(bytes);valid=true;}catch{}}
 }else if(['.docx','.xlsx'].includes(ext))valid=await validOfficeDocument(bytes,ext).catch(()=>false);
 else if(['.csv','.txt'].includes(ext))valid=!bytes.includes(0)&&!bytes.subarray(0,2).equals(Buffer.from('MZ'))&&!/<\s*(?:script|html|svg|iframe)\b/i.test(bytes.toString('utf8'));
 if(!valid)throw Object.assign(Error('Upload a valid PDF, PNG, JPEG, WebP, DOCX, XLSX, CSV or text document. Executable, HTML, SVG and macro-enabled files are not accepted.'),{status:400});
 return true;
}
