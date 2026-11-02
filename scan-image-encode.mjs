import {createCanvas,loadImage} from '@napi-rs/canvas';
import {scanImageMime} from './scan-image-format.mjs';

// Server-side counterpart of the browser encoder: cards are ink on paper, so a
// grayscale WebP at about 200 dpi keeps handwriting legible at roughly a third
// of the JPEG bytes and a tenth or less of a colour PNG. Used by the local
// Windows scanner service so each page is encoded once, natively, before it is
// retained and transferred.
export const SCAN_ENCODE_LONG_EDGE=2400,SCAN_ENCODE_WEBP_QUALITY=80,SCAN_ENCODE_MAX_BYTES=500000;
export async function encodeScanCanvasNative(source,{longEdge=SCAN_ENCODE_LONG_EDGE,quality=SCAN_ENCODE_WEBP_QUALITY}={}){
 const scale=Math.min(1,longEdge/Math.max(source.width,source.height));
 const width=Math.max(1,Math.round(source.width*scale)),height=Math.max(1,Math.round(source.height*scale));
 const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
 try{
  ctx.fillStyle='white';ctx.fillRect(0,0,width,height);
  ctx.filter='grayscale(1)';ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(source,0,0,width,height);
  return await canvas.encode('webp',quality);
 }finally{canvas.width=canvas.height=1;}
}
export async function prepareLocalScanImage(bytes){
 // Already-prepared pages (a retry, or a WebP produced by the browser) keep their bytes.
 if(scanImageMime(bytes)==='image/webp'&&bytes.length<=SCAN_ENCODE_MAX_BYTES)return bytes;
 const image=await loadImage(bytes);
 if(!image.width||!image.height||image.width*image.height>20000000)throw new Error('Scan dimensions exceed the 20 megapixel limit.');
 let encoded=await encodeScanCanvasNative(image);
 for(const [longEdge,quality] of [[2200,75],[2000,70],[1800,65],[1600,60]]){
  if(encoded.length<=SCAN_ENCODE_MAX_BYTES)break;
  encoded=await encodeScanCanvasNative(image,{longEdge,quality});
 }
 return encoded;
}
