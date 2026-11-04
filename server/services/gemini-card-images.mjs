import {createCanvas,loadImage} from '@napi-rs/canvas';
// WebP at this quality keeps the handwriting pixels the model reads while the
// request body shrinks to roughly a third of the earlier quality-95 JPEG views.
export const DETAIL_VIEW_WEBP_QUALITY=82;

// Complete overlapping columns retain header, meters and every trip row whether
// the capture is upright or upside down. No orientation-dependent crop can hide
// a header at the bottom. Original bytes are retained separately in the request.
// The machine-wise summary sits under the trip grid. These bands show it larger,
// upright for either capture orientation, beside the complete column views.
async function checkedImage(bytes){
 const image=await loadImage(bytes),{width,height}=image;
 if(!width||!height||width*height>20000000)throw Error('Scan dimensions exceed the 20 megapixel limit.');
 return image;
}
async function encodeView(image,{label,sx=0,sy=0,width,height,degrees}){
 const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
 try{
  ctx.fillStyle='white';ctx.fillRect(0,0,width,height);if(degrees===180){ctx.translate(width,height);ctx.rotate(Math.PI);}ctx.drawImage(image,sx,sy,width,height,0,0,width,height);
  return {label:label+` (${degrees} degree view)`,mimeType:'image/webp',image:await canvas.encode('webp',DETAIL_VIEW_WEBP_QUALITY)};
 }finally{
  // Release native pixel buffers after encoding, rather than waiting for GC
  // while the provider request retains its much smaller encoded views.
  canvas.width=canvas.height=1;
 }
}
function summaryViews(image){
 const {width,height}=image;
 return Promise.all([['Bottom band containing the machine-wise summary',.62,0],['Top band containing the machine-wise summary',0,180]].map(async([label,y,degrees])=>{
  const sy=Math.floor(y*height),sh=Math.min(height-sy,Math.ceil(.38*height));
  return encodeView(image,{label,sy,width,height:sh,degrees});
 }));
}
function columnViews(image){
 const {width,height}=image;
 const views=[];for(const degrees of [0,180])for(const [label,x,w] of [['Left overlapping full-height column',0,.54],['Right overlapping full-height column',.46,.54]]){
  const sx=Math.floor(x*width),sw=Math.min(width-sx,Math.ceil(w*width));
  views.push(encodeView(image,{label,sx,width:sw,height,degrees}));
 }
 // Native encoders run together; retain the same pixels, dimensions and quality.
 return Promise.all(views);
}
export async function summaryDetailViews(bytes){return summaryViews(await checkedImage(bytes));}
export async function cardDetailViews(bytes){return columnViews(await checkedImage(bytes));}
export async function allCardDetailViews(bytes){
 // The six views share one decode of the original card.
 const image=await checkedImage(bytes),[columns,summary]=await Promise.all([columnViews(image),summaryViews(image)]);
 return [...columns,...summary];
}
