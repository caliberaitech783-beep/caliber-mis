import {createCanvas,loadImage} from '@napi-rs/canvas';

// Complete overlapping columns retain header, meters and every trip row whether
// the capture is upright or upside down. No orientation-dependent crop can hide
// a header at the bottom. Original bytes are retained separately in the request.
export async function cardDetailViews(bytes){
 const image=await loadImage(bytes),{width,height}=image;
 if(!width||!height||width*height>20000000)throw Error('Scan dimensions exceed the 20 megapixel limit.');
 const views=[];for(const degrees of [0,180])views.push(...[['Left overlapping full-height column',0,.54],['Right overlapping full-height column',.46,.54]].map(([label,x,w])=>{
  const sx=Math.floor(x*width),sw=Math.min(width-sx,Math.ceil(w*width)),canvas=createCanvas(sw,height),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,sw,height);if(degrees===180){ctx.translate(sw,height);ctx.rotate(Math.PI);}ctx.drawImage(image,sx,0,sw,height,0,0,sw,height);
  return {label:label+` (${degrees} degree view)`,mimeType:'image/jpeg',image:canvas.toBuffer('image/jpeg',95)};
 }));return views;
}
