import {sniffScanImageType} from '../public/scan-image-type.mjs';
// Card readers downscale images well below this size, so larger uploads only
// cost transfer time and storage. 1700 px across an A4 page is about 200 dpi,
// the usual floor for handwriting OCR and legible review zoom.
export const SCAN_UPLOAD_MAX_WIDTH=1700,SCAN_UPLOAD_MAX_HEIGHT=2267;
// Cards are ink on paper: grayscale WebP at this quality is visually equal to
// the earlier colour JPEG for handwriting at roughly a third of the bytes.
export const SCAN_UPLOAD_WEBP_QUALITY=0.8;
// Browsers without a WebP encoder (older Safari) fall back to grayscale JPEG.
export const SCAN_UPLOAD_JPEG_QUALITY=0.85;
// Requests in flight at once. Order is preserved by client-assigned ordinals.
export const SCAN_UPLOAD_CONCURRENCY=3;
const toBlob=(canvas,type,quality)=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not prepare scan image.')),type,quality));
function grayscaleCopy(source,{document:doc=globalThis.document}={}){
 const canvas=doc.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
 const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.filter='grayscale(1)';ctx.drawImage(source,0,0);
 return canvas;
}
// Encodes a rendered page or composed card as grayscale WebP, or grayscale JPEG
// where the browser cannot encode WebP. The source canvas is left unchanged.
export async function encodeScanCanvas(canvas,options={}){
 const gray=grayscaleCopy(canvas,options);
 try{
  const webp=await toBlob(gray,'image/webp',SCAN_UPLOAD_WEBP_QUALITY);
  if(webp.type==='image/webp')return webp;
  return toBlob(gray,'image/jpeg',SCAN_UPLOAD_JPEG_QUALITY);
 }finally{gray.width=gray.height=0;}
}

export async function prepareScanImages(images){
 const loaded=[];
 let canvas;
 try{
  for(const blob of images){
   const bitmap=await createImageBitmap(blob),scale=Math.min(1,SCAN_UPLOAD_MAX_WIDTH/bitmap.width,SCAN_UPLOAD_MAX_HEIGHT/bitmap.height);
   loaded.push({blob,bitmap,width:Math.round(bitmap.width*scale),height:Math.round(bitmap.height*scale),scale});
  }
  const single=loaded.length===1&&loaded[0].scale===1?loaded[0]:null;
  // A WebP that is already within the upload size is upload-ready; preserve its exact bytes.
  if(single&&sniffScanImageType(new Uint8Array(await single.blob.slice(0,12).arrayBuffer()))==='image/webp')return single.blob;
  canvas=document.createElement('canvas');
  canvas.width=Math.max(...loaded.map(row=>row.width));canvas.height=loaded.reduce((sum,row)=>sum+row.height,0);
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
  let y=0;for(const row of loaded){ctx.drawImage(row.bitmap,0,y,row.width,row.height);y+=row.height;}
  const image=await encodeScanCanvas(canvas);
  // Small PNG line drawings can already be smaller than the encoded page.
  return single?.blob.type==='image/png'&&single.blob.size<=image.size?single.blob:image;
 }finally{
  for(const row of loaded)row.bitmap.close();
  if(canvas)canvas.width=canvas.height=0;
 }
}
