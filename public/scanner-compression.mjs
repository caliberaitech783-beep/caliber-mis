export const MAX_PAGE_BYTES=500000;
export async function compressScannerPage(blob,{decode=createImageBitmap,makeCanvas=()=>document.createElement('canvas')}={}){
 const image=await decode(blob);
 try{
  if(!image.width||!image.height||image.width*image.height>40000000)throw Error('Scanner image dimensions are too large. The original is retained.');
  const canvas=makeCanvas(),context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)throw Error('This browser cannot prepare scanner images.');
  for(const longEdge of [2600,2400,2200,2000,1800,1600]){
   const scale=Math.min(1,longEdge/Math.max(image.width,image.height));
   canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
   context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(image,0,0,canvas.width,canvas.height);
   const pixels=context.getImageData(0,0,canvas.width,canvas.height);
   for(let index=0;index<pixels.data.length;index+=4){const gray=Math.round(.299*pixels.data[index]+.587*pixels.data[index+1]+.114*pixels.data[index+2]);pixels.data[index]=pixels.data[index+1]=pixels.data[index+2]=gray;}
   context.putImageData(pixels,0,0);
   for(const quality of [.92,.85,.78,.70,.62,.55]){
    const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
    if(!jpeg||jpeg.type!=='image/jpeg')throw Error('JPEG compression is unavailable in this browser.');
    if(jpeg.size<=MAX_PAGE_BYTES)return {blob:jpeg,width:canvas.width,height:canvas.height,quality};
   }
  }
  throw Error('This page cannot fit within 500 KB without reducing text resolution further. The original is retained; use Upload files for manual review.');
 }finally{image.close?.();}
}
