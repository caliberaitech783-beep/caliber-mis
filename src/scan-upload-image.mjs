// Card readers downscale images well below this size, so larger uploads only
// cost transfer time. 2000 px across an A4 page is still about 240 dpi.
export const SCAN_UPLOAD_MAX_WIDTH=2000,SCAN_UPLOAD_MAX_HEIGHT=2667;
// Quality 0.9 is visually indistinguishable from 0.97 for handwriting but
// roughly halves the JPEG bytes.
export const SCAN_UPLOAD_JPEG_QUALITY=0.9;
// Requests in flight at once. Order is preserved by client-assigned ordinals.
export const SCAN_UPLOAD_CONCURRENCY=3;
export function encodeScanCanvas(canvas){
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not prepare scan image.')),'image/jpeg',SCAN_UPLOAD_JPEG_QUALITY));
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
  // A suitable JPEG is already upload-ready; preserve its exact bytes.
  if(single?.blob.type==='image/jpeg')return single.blob;
  canvas=document.createElement('canvas');
  canvas.width=Math.max(...loaded.map(row=>row.width));canvas.height=loaded.reduce((sum,row)=>sum+row.height,0);
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
  let y=0;for(const row of loaded){ctx.drawImage(row.bitmap,0,y,row.width,row.height);y+=row.height;}
  const image=await encodeScanCanvas(canvas);
  // Small PNG line drawings can already be smaller than JPEG.
  return single?.blob.type==='image/png'&&single.blob.size<=image.size?single.blob:image;
 }finally{
  for(const row of loaded)row.bitmap.close();
  if(canvas)canvas.width=canvas.height=0;
 }
}
