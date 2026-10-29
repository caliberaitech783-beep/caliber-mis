// Preview-only bounds: ignore white scanner margins and isolated dust pixels.
export function scanContentBounds({data,width,height}){
 const rows=new Uint32Array(height),cols=new Uint32Array(width);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];
  if(data[i+3]>128&&(Math.min(r,g,b)<200||Math.max(r,g,b)-Math.min(r,g,b)>35)){rows[y]++;cols[x]++;}
 }
 const xs=[],ys=[];
 for(let x=0;x<width;x++)if(cols[x]>=Math.max(2,height*.008))xs.push(x);
 for(let y=0;y<height;y++)if(rows[y]>=Math.max(2,width*.008))ys.push(y);
 if(!xs.length||!ys.length)return null;
 const padding=2,x=Math.max(0,xs[0]-padding),y=Math.max(0,ys[0]-padding),right=Math.min(width,xs.at(-1)+padding+1),bottom=Math.min(height,ys.at(-1)+padding+1);
 if((right-x)*(bottom-y)<width*height*.15)return null;
 return {x,y,width:right-x,height:bottom-y};
}
export async function trimScanPreview(blob){
 const image=await createImageBitmap(blob);
 try{
  const scale=Math.min(1,1200/Math.max(image.width,image.height)),sample=document.createElement('canvas');
  sample.width=Math.max(1,Math.round(image.width*scale));sample.height=Math.max(1,Math.round(image.height*scale));
  const ctx=sample.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,sample.width,sample.height);ctx.drawImage(image,0,0,sample.width,sample.height);
  const bounds=scanContentBounds(ctx.getImageData(0,0,sample.width,sample.height));
  if(!bounds)return blob;
  const sx=Math.floor(bounds.x*image.width/sample.width),sy=Math.floor(bounds.y*image.height/sample.height),sw=Math.min(image.width-sx,Math.ceil(bounds.width*image.width/sample.width)),sh=Math.min(image.height-sy,Math.ceil(bounds.height*image.height/sample.height));
  const canvas=document.createElement('canvas');canvas.width=sw;canvas.height=sh;canvas.getContext('2d').drawImage(image,sx,sy,sw,sh,0,0,sw,sh);
  return await new Promise(resolve=>canvas.toBlob(value=>resolve(value||blob),'image/png'));
 }finally{image.close();}
}
