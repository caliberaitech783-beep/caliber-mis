import {loadImage,createCanvas} from '@napi-rs/canvas';
export async function locateTripCard(bytes,text=''){
 const standardGrid=/MACHINE[\s-]*WISE\s+SUMMARY/i.test(text)&&/\bSHIFT\b/i.test(text);
 if(/JOB\s+CARD/i.test(text)||(!standardGrid&&!/TRIP\s+CARD|READING|OPENING[\s\S]*CLOSING/i.test(text)))return null;
 const im=await loadImage(bytes),c=createCanvas(im.width,im.height),ctx=c.getContext('2d');ctx.drawImage(im,0,0);
 const {data}=ctx.getImageData(0,0,c.width,c.height),w=c.width;
 const paper=x=>{let white=0,n=0;for(let y=20;y<c.height*.16;y+=10){const i=(y*w+x)*4;if(data[i]>210&&data[i+1]>210&&data[i+2]>210)white++;n++}return white/n>.35};
 let start=null,best=[0,0];for(let x=0;x<w;x+=2){if(paper(x))start??=x;else if(start!==null){if(x-start>best[1]-best[0])best=[start,x];start=null}}
 if(start!==null&&w-start>best[1]-best[0])best=[start,w];const [left,right]=best,pw=right-left;
 return left<w*.05||right>w*.95||pw<w*.35||pw>w*.8?null:{data,width:w,height:c.height,left,pw};
}
export function cropHandwriting(paper,[x0,x1,y0,y1],{tight=true,minInk=20}={}){
 const {data,width:w,left,pw,height}=paper,x=Math.round(left+pw*x0),y=Math.round(pw*y0),cw=Math.round(pw*(x1-x0)),ch=Math.round(pw*(y1-y0));
 if(x<0||y<0||x+cw>w||y+ch>height||cw<2||ch<2)return null;
 const c=createCanvas(cw+30,ch+30),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);const pixels=ctx.getImageData(15,15,cw,ch);let ink=0,l=cw,t=ch,r=0,b=0;
 for(let yy=0;yy<ch;yy++)for(let xx=0;xx<cw;xx++){const a=((y+yy)*w+x+xx)*4,k=(yy*cw+xx)*4;const blue=data[a+2]>data[a]+28&&data[a+2]>data[a+1]+10&&data[a]<210;const v=blue?0:255;if(blue){ink++;l=Math.min(l,xx);r=Math.max(r,xx);t=Math.min(t,yy);b=Math.max(b,yy)}pixels.data[k]=pixels.data[k+1]=pixels.data[k+2]=v;pixels.data[k+3]=255;}
 if(ink<minInk)return null;ctx.putImageData(pixels,15,15);if(!tight)return c.toBuffer('image/png');
 const out=createCanvas(r-l+31,b-t+25),ox=out.getContext('2d');ox.fillStyle='white';ox.fillRect(0,0,out.width,out.height);ox.drawImage(c,15+l,15+t,r-l+1,b-t+1,15,12,r-l+1,b-t+1);return out.toBuffer('image/png');
}
export const HEADER_REGIONS=[['location',.065,.32,.032,.070],['bookDate',.14,.49,.14,.19],['door',.105,.265,.218,.258],['employeeCode',.40,.625,.218,.258],['openingHmr',.166,.375,.308,.343],['closingHmr',.385,.59,.308,.343],['openingKmr',.166,.375,.344,.380],['closingKmr',.385,.59,.344,.380]];
