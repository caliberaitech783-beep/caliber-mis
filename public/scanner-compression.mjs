import {sniffScanImageType} from './scan-image-type.mjs';
export const MAX_PAGE_BYTES=500000;
// Pages are ink on paper, so they travel as grayscale WebP (grayscale JPEG where
// the browser has no WebP encoder). The canvas grayscale filter runs natively
// instead of a per-pixel JavaScript loop. A page the local service has already
// encoded within the limit is sent as it is, so each page is compressed once.
const toBlob=(canvas,type,quality)=>new Promise(resolve=>canvas.toBlob(resolve,type,quality));
export async function compressScannerPage(blob,{decode=createImageBitmap,makeCanvas=()=>document.createElement('canvas')}={}){
 const head=new Uint8Array(await blob.slice(0,12).arrayBuffer()),type=sniffScanImageType(head);
 if(type!=='image/png'&&blob.size<=MAX_PAGE_BYTES)return {blob,width:null,height:null,quality:null,reused:true};
 const image=await decode(blob);
 try{
  if(!image.width||!image.height||image.width*image.height>40000000)throw Error('Scanner image dimensions are too large. The original is retained.');
  const canvas=makeCanvas(),context=canvas.getContext('2d');
  if(!context)throw Error('This browser cannot prepare scanner images.');
  let format=null;
  for(const longEdge of [2400,2200,2000,1800,1600]){
   const scale=Math.min(1,longEdge/Math.max(image.width,image.height));
   canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
   context.filter='none';context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);
   context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.filter='grayscale(1)';
   context.drawImage(image,0,0,canvas.width,canvas.height);
   for(const quality of [.82,.76,.70,.64,.58,.52]){
    if(!format){const probe=await toBlob(canvas,'image/webp',quality);format=probe?.type==='image/webp'?'image/webp':'image/jpeg';if(format==='image/webp'&&probe.size<=MAX_PAGE_BYTES)return {blob:probe,width:canvas.width,height:canvas.height,quality};if(format==='image/webp')continue;}
    const encoded=await toBlob(canvas,format,format==='image/jpeg'?Math.min(.92,quality+.1):quality);
    if(!encoded||encoded.type!==format)throw Error('Image compression is unavailable in this browser.');
    if(encoded.size<=MAX_PAGE_BYTES)return {blob:encoded,width:canvas.width,height:canvas.height,quality};
   }
  }
  throw Error('This page cannot fit within 500 KB without reducing text resolution further. The original is retained; use Upload files for manual review.');
 }finally{image.close?.();}
}
