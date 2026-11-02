import {createCanvas} from '@napi-rs/canvas';
// A trip card: thin printed form (grid, headings) plus pen handwriting that differs per card.
export function drawCard({seed=1,shiftX=0,shiftY=0,brightness=0,noise=0,rotate=false,writing='A'}={}){
 const width=1240,height=1754,canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
 ctx.fillStyle='white';ctx.fillRect(0,0,width,height);
 ctx.save();if(rotate){ctx.translate(width,height);ctx.rotate(Math.PI);}ctx.translate(shiftX,shiftY);
 ctx.strokeStyle='#333';ctx.lineWidth=1;ctx.font='bold 30px sans-serif';ctx.fillStyle='#222';
 ctx.fillText('CALIBER MINING & LOGISTICS · TRIP CARD',80,70);
 for(const [label,y] of [['Date',130],['Door No',180],['Driver',230],['Caliber ID',280]]){ctx.fillText(label,80,y);ctx.strokeRect(300,y-32,600,42);}
 for(let row=0;row<20;row++){const y=380+row*52;ctx.strokeRect(80,y,1080,52);for(const x of [180,420,660,900]){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+52);ctx.stroke();}}
 ctx.fillText('MACHINE-WISE SUMMARY',80,1480);for(let row=0;row<4;row++)ctx.strokeRect(80,1500+row*50,1080,50);
 // Handwriting: deterministic strokes from the seed so the same card renders identically.
 let state=seed*9301+49297;const rand=()=>{state=(state*9301+49297)%233280;return state/233280};
 ctx.strokeStyle='#0a2a6b';ctx.lineWidth=6;ctx.font='bold 64px sans-serif';ctx.fillStyle='#0a2a6b';
 ctx.fillText(writing+' 01-11-2026',320,160);ctx.fillText('V'+(seed*7%90+10),320,210);ctx.fillText('DRIVER '+writing,320,260);ctx.fillText('C'+(seed*13%900+100),320,310);
 for(let row=0;row<20;row++){const y=420+row*52;if(rand()<.4)continue;for(const x of [100,200,440,680,920]){ctx.beginPath();ctx.moveTo(x,y);for(let i=0;i<8;i++)ctx.lineTo(x+i*22+rand()*10,y-10+rand()*22);ctx.stroke();}}
 for(let row=0;row<3;row++){ctx.fillText('T-'+Math.floor(rand()*900+100)+'  '+Math.floor(rand()*9+1),120,1540+row*50);}
 ctx.restore();
 if(brightness){ctx.fillStyle=`rgba(${brightness>0?'255,255,255':'0,0,0'},${Math.abs(brightness)})`;ctx.fillRect(0,0,width,height);}
 if(noise){const image=ctx.getImageData(0,0,width,height),d=image.data;let s=seed*7;for(let i=0;i<d.length;i+=4){s=(s*1103515245+12345)&0x7fffffff;const n=((s>>8)%(2*noise+1))-noise;d[i]=Math.max(0,Math.min(255,d[i]+n));d[i+1]=Math.max(0,Math.min(255,d[i+1]+n));d[i+2]=Math.max(0,Math.min(255,d[i+2]+n));}ctx.putImageData(image,0,0);}
 return canvas.toBuffer('image/png');
}

