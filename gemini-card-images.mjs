import {createCanvas,loadImage} from '@napi-rs/canvas';

// Extra views of the same capture, sent together in one request. The full original
// is always included separately, so these views cannot hide a different layout.
export async function cardDetailViews(bytes){
 const image=await loadImage(bytes),{width,height}=image;
 if(!width||!height||width*height>20000000)throw Error('Scan dimensions exceed the 20 megapixel limit.');
 const preview=createCanvas(Math.min(width,800),Math.max(1,Math.round(height*Math.min(width,800)/width))),ctx=preview.getContext('2d');
 ctx.fillStyle='white';ctx.fillRect(0,0,preview.width,preview.height);ctx.drawImage(image,0,0,preview.width,preview.height);
 const {data}=ctx.getImageData(0,0,preview.width,preview.height);let bottom=preview.height;
 // Remove only an entirely near-white bottom margin; keep grey scanner borders,
 // faint marks and the full original. Never threshold or sharpen handwriting.
 for(let y=preview.height-1;y>=0;y--){let ink=0;for(let x=0;x<preview.width;x++){const i=(y*preview.width+x)*4;if(Math.min(data[i],data[i+1],data[i+2])<240)ink++;}if(ink>1){bottom=Math.min(preview.height,y+5);break;}}
 const contentHeight=Math.max(Math.round(height*.35),Math.round(bottom*height/preview.height));
 const regions=[['Header and meter readings',0,0,1,.34],['Left trip table',0,.29,.54,.55],['Right trip table',.46,.29,.54,.55]];
 return regions.map(([label,x,y,w,h])=>{const sx=Math.floor(x*width),sy=Math.floor(y*contentHeight),sw=Math.min(width-sx,Math.ceil(w*width)),sh=Math.min(height-sy,Math.ceil(h*contentHeight));const canvas=createCanvas(sw,sh),c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,sw,sh);c.drawImage(image,sx,sy,sw,sh,0,0,sw,sh);return {label,image:canvas.toBuffer('image/png')};});
}
