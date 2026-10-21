import {loadImage,createCanvas} from '@napi-rs/canvas';

// This layout has a separate HMR/KMR table above the trip rows. Only blue
// handwriting is isolated; other layouts and grayscale scans use normal OCR.
export async function readingCellImages(bytes,text='',{tight=true}={}){
 if(!/TRIP\s+CARD|READING|OPENING[\s\S]*CLOSING/i.test(text))return {};
 const im=await loadImage(bytes),c=createCanvas(im.width,im.height),ctx=c.getContext('2d');ctx.drawImage(im,0,0);
 const {data}=ctx.getImageData(0,0,c.width,c.height),w=c.width;
 const paper=x=>{let white=0,n=0;for(let y=20;y<c.height*.16;y+=10){let i=(y*w+x)*4;if(data[i]>210&&data[i+1]>210&&data[i+2]>210)white++;n++}return white/n>.35};
 let start=null,best=[0,0];for(let x=0;x<w;x+=2){if(paper(x))start??=x;else if(start!==null){if(x-start>best[1]-best[0])best=[start,x];start=null}}
 if(start!==null&&w-start>best[1]-best[0])best=[start,w];
 const [left,right]=best,pw=right-left;if(left<w*.05||right>w*.95||pw<w*.35||pw>w*.8)return {};
 const out={};
 for(const [key,x0,x1,y0,y1] of [['location',.065,.32,.032,.070],['bookDate',.14,.49,.14,.19],['door',.105,.265,.218,.258],['employeeCode',.40,.625,.218,.258],['openingHmr',.166,.375,.308,.343],['closingHmr',.385,.59,.308,.343],['openingKmr',.166,.375,.344,.380],['closingKmr',.385,.59,.344,.380]]){
  const x=Math.round(left+pw*x0),y=Math.round(pw*y0),cw=Math.round(pw*(x1-x0)),ch=Math.round(pw*(y1-y0));
  const crop=createCanvas(cw+30,ch+30),cx=crop.getContext('2d');cx.fillStyle='white';cx.fillRect(0,0,crop.width,crop.height);const pixels=cx.getImageData(15,15,cw,ch);let ink=0;
  for(let yy=0;yy<ch;yy++)for(let xx=0;xx<cw;xx++){const a=((y+yy)*w+x+xx)*4,b=(yy*cw+xx)*4;const blue=data[a+2]>data[a]+28&&data[a+2]>data[a+1]+10&&data[a]<210;const v=blue?0:255;if(blue)ink++;pixels.data[b]=pixels.data[b+1]=pixels.data[b+2]=v;pixels.data[b+3]=255;}
  if(ink<20)continue;cx.putImageData(pixels,15,15);if(!tight){out[key]=crop.toBuffer('image/png');continue;}let l=cw,t=ch,r=0,b=0;for(let yy=0;yy<ch;yy++)for(let xx=0;xx<cw;xx++)if(pixels.data[(yy*cw+xx)*4]<100){l=Math.min(l,xx);r=Math.max(r,xx);t=Math.min(t,yy);b=Math.max(b,yy)}const trimmed=createCanvas(r-l+31,b-t+25),tc=trimmed.getContext('2d');tc.fillStyle='white';tc.fillRect(0,0,trimmed.width,trimmed.height);tc.drawImage(crop,15+l,15+t,r-l+1,b-t+1,15,12,r-l+1,b-t+1);out[key]=trimmed.toBuffer('image/png');
 }
 return out;
}

export async function recognizeReadingCells(worker,bytes,text){
 const cells=await readingCellImages(bytes,text),readings={};
 try{await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789.'});
  for(const [key,image] of Object.entries(cells)){if(!['employeeCode','openingKmr','closingKmr','openingHmr','closingHmr'].includes(key))continue;const {data}=await worker.recognize(image);const value=data.text.trim().replace(/\s/g,'');if(/^\d{3,8}(?:\.\d{1,3})?$/.test(value)&&!/^0/.test(value))readings[key]={value,confidence:data.confidence,source:'reading-table-cell',needsReview:true};}
 }finally{await worker.setParameters({tessedit_pageseg_mode:'3',tessedit_char_whitelist:''});}
 return readings;
}
