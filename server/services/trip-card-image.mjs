import {loadImage,createCanvas} from '@napi-rs/canvas';
// Conservative colour-tick detector for the known three-box Trip Card template.
// Grayscale, rotated, borderless or ambiguous scans fall back to manual selection.
export async function detectTripShiftMark(bytes,text=''){
 if(!/TRIP\s+CARD|READING|OPENING[\s\S]*CLOSING/i.test(text)||!/SHIFT/i.test(text))return {};
 const image=await loadImage(bytes),canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const {data}=ctx.getImageData(0,0,image.width,image.height),w=image.width,h=image.height;
 const white=x=>{let count=0,total=0;for(let y=Math.round(h*.03);y<h*.35;y+=12){const i=(y*w+x)*4;if(data[i]>220&&data[i+1]>220&&data[i+2]>220)count++;total++}return count/total>.35};
 let best=[0,0],start=null;for(let x=0;x<w;x+=4){if(white(x)){start??=x}else if(start!==null){if(x-start>best[1]-best[0])best=[start,x];start=null}}if(start!==null&&w-start>best[1]-best[0])best=[start,w];const [left,right]=best,width=right-left;
 if(left<w*.05||right>w*.95||width<w*.3||width>w*.8)return {};
 const scores=[.175,.445,.70].map(x=>{let blue=0,total=0;for(let y=Math.round(width*.07);y<width*.105;y++)for(let px=Math.round(left+width*x);px<left+width*(x+.075);px++){const i=(y*w+px)*4;if(data[i+2]>data[i]+50&&data[i+2]>data[i+1]+25&&data[i]<180)blue++;total++}return blue/total});const sorted=scores.map((score,i)=>({score,i})).sort((a,b)=>b.score-a.score);if(sorted[0].score<.012||sorted[0].score<sorted[1].score*3)return {};return {cardShift:['I','II','III'][sorted[0].i],shiftDetection:'Known Trip Card blue tick; verify against image'};
}
