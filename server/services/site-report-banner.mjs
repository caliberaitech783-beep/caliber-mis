import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import {fileURLToPath} from 'node:url';

// Site picture sent first with every site-wise batch completion report on
// Telegram (owner, 15 Nov 2026): the site name on a Pulse-II card, so a chat
// full of reports shows which site each one is for at a glance.
const asset=path=>fileURLToPath(new URL('../../'+path,import.meta.url));
let fontsReady=false;
const fonts=()=>{if(fontsReady)return;fontsReady=true;
 try{GlobalFonts.registerFromPath(asset('public/scan-pdf-fonts/LiberationSans-Bold.ttf'),'PulseBannerBold');
  GlobalFonts.registerFromPath(asset('public/scan-pdf-fonts/LiberationSans-Regular.ttf'),'PulseBanner');}catch{/* falls back to the default font */}};
let logo=null;
const pulseLogo=()=>logo||=loadImage(asset('public/pulse-ii-icon-512.png')).catch(()=>null);

const W=1200,H=420;
const fit=(ctx,text,max,start,min,font)=>{let size=start;for(;size>min;size-=4){ctx.font=`${size}px ${font}`;if(ctx.measureText(text).width<=max)break;}return size;};

export async function siteReportBanner({site,kind='VLB',batch='',subtitle='Site-wise batch completion report'}={}){
 fonts();
 const canvas=createCanvas(W,H),ctx=canvas.getContext('2d');
 const bg=ctx.createLinearGradient(0,0,W,H);bg.addColorStop(0,'#1e1b4b');bg.addColorStop(1,'#5b21b6');
 ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
 ctx.fillStyle='rgba(255,255,255,0.06)';ctx.beginPath();ctx.arc(W-90,70,260,0,Math.PI*2);ctx.fill();
 const image=await pulseLogo();
 if(image){ctx.save();ctx.beginPath();ctx.roundRect(60,60,120,120,24);ctx.clip();ctx.drawImage(image,60,60,120,120);ctx.restore();}
 ctx.fillStyle='#c4b5fd';ctx.font='34px PulseBannerBold, sans-serif';ctx.textBaseline='middle';
 ctx.fillText('CALIBER PULSE-II',210,104);
 ctx.fillStyle='#e9d5ff';ctx.font='28px PulseBanner, sans-serif';ctx.fillText(subtitle,210,146);
 const name=String(site||'Site not set').toUpperCase();
 const size=fit(ctx,name,W-120,104,44,'PulseBannerBold, sans-serif');
 ctx.fillStyle='#ffffff';ctx.font=`${size}px PulseBannerBold, sans-serif`;ctx.textBaseline='alphabetic';
 ctx.fillText(name,60,300);
 let x=60;
 if(kind){ctx.font='30px PulseBannerBold, sans-serif';const w=ctx.measureText(kind).width+44;
  ctx.fillStyle='#facc15';ctx.beginPath();ctx.roundRect(60,334,w,52,26);ctx.fill();
  ctx.fillStyle='#1e1b4b';ctx.textBaseline='middle';ctx.fillText(kind,82,361);x+=w+20;}
 // The full batch name, too wide for one line of the text below the picture.
 if(batch){const text=String(batch);const s=fit(ctx,text,W-60-x,34,18,'PulseBanner, sans-serif');
  ctx.fillStyle='#ffffff';ctx.font=`${s}px PulseBanner, sans-serif`;ctx.textBaseline='middle';ctx.fillText(text,x,361);}
 return canvas.encode('png');
}
