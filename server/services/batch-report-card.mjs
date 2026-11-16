import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import {fileURLToPath} from 'node:url';

// The site-wise batch completion report as one picture (owner, 16 Nov 2026): the
// purple site header, then the report with the sub batches in a table, so it
// looks the same on every phone. Telegram text cannot hold a table.
const asset=path=>fileURLToPath(new URL('../../'+path,import.meta.url));
let fontsReady=false;
const fonts=()=>{if(fontsReady)return;fontsReady=true;
 try{GlobalFonts.registerFromPath(asset('public/scan-pdf-fonts/LiberationSans-Bold.ttf'),'CardBold');
  GlobalFonts.registerFromPath(asset('public/scan-pdf-fonts/LiberationSans-Regular.ttf'),'Card');}catch{/* default font */}};
let logo=null;
const pulseLogo=()=>logo||=loadImage(asset('public/pulse-ii-icon-512.png')).catch(()=>null);

const W=1080,PAD=60;
const C={head:'#3C3489',headSoft:'#CECBF6',headText:'#EEEDFE',badge:'#FAC775',badgeText:'#412402',
 text:'#1f1d2b',muted:'#6b6880',line:'#e6e3f0',zebra:'#f7f6fb',band:'#EEEDFE',bandText:'#26215C',
 ok:'#2f7d1e',okBg:'#EAF3DE',bad:'#A32D2D',badBg:'#FCEBEB',page:'#ffffff'};
const BOLD='CardBold, sans-serif',REG='Card, sans-serif';
const fit=(ctx,text,max,start,min,font)=>{let size=start;for(;size>min;size-=2){ctx.font=`${size}px ${font}`;if(ctx.measureText(text).width<=max)break;}return size;};
const clip=(ctx,text,max)=>{let t=String(text);if(ctx.measureText(t).width<=max)return t;while(t.length>1&&ctx.measureText(t+'…').width>max)t=t.slice(0,-1);return t+'…';};

// report: {site,kind,batchName,batchLine,scanned,trips,extracted,processed,
//  subs:[{code,operator,total,auto,error}],more,all:{total,auto,error},time,perCard,accuracy,model}
export async function batchReportCard(report){
 fonts();
 const subs=report.subs||[],rows=subs.length+(report.more?1:0);
 const HEAD=330,ROW=64,info=3,footer=3;
 const H=HEAD+40+60+info*58+30+ROW*(rows+2)+30+footer*58+50;
 const canvas=createCanvas(W,H),ctx=canvas.getContext('2d');
 ctx.fillStyle=C.page;ctx.fillRect(0,0,W,H);
 // Header: logo, Pulse-II, site name, log book kind and full batch name.
 ctx.fillStyle=C.head;ctx.fillRect(0,0,W,HEAD);
 const image=await pulseLogo();
 if(image){ctx.save();ctx.beginPath();ctx.roundRect(PAD,46,96,96,22);ctx.clip();ctx.drawImage(image,PAD,46,96,96);ctx.restore();}
 ctx.textBaseline='middle';
 ctx.fillStyle=C.headSoft;ctx.font=`34px ${BOLD}`;ctx.fillText('CALIBER PULSE-II',PAD+124,78);
 ctx.fillStyle=C.headText;ctx.font=`30px ${REG}`;ctx.fillText('Site-wise batch completion report',PAD+124,118);
 const site=String(report.site||'Site not set').toUpperCase();
 ctx.fillStyle='#ffffff';ctx.font=`${fit(ctx,site,W-2*PAD,76,40,BOLD)}px ${BOLD}`;ctx.fillText(site,PAD,206);
 ctx.font=`28px ${BOLD}`;const kind=String(report.kind||'VLB'),bw=ctx.measureText(kind).width+44;
 ctx.fillStyle=C.badge;ctx.beginPath();ctx.roundRect(PAD,252,bw,48,24);ctx.fill();
 ctx.fillStyle=C.badgeText;ctx.fillText(kind,PAD+22,277);
 ctx.fillStyle='#ffffff';const name=String(report.batchName||'');ctx.font=`${fit(ctx,name,W-2*PAD-bw-24,30,18,REG)}px ${REG}`;ctx.fillText(name,PAD+bw+24,277);
 // Report lines.
 let y=HEAD+40+30;
 ctx.fillStyle=C.text;ctx.font=`40px ${BOLD}`;ctx.fillText('SITE-WISE BATCH COMPLETION REPORT',PAD,y);y+=70;
 const pair=(label,value)=>{ctx.fillStyle=C.muted;ctx.font=`30px ${REG}`;ctx.fillText(label,PAD,y);
  ctx.fillStyle=C.text;ctx.font=`34px ${REG}`;ctx.fillText(clip(ctx,value,W-PAD-300),PAD+240,y);y+=58;};
 pair('Batch',report.batchLine);
 pair('Cards',`Scanned ${report.scanned} · Trips ${report.trips}`);
 pair('Status',`Extracted ${report.extracted} · Processed ${report.processed}`);
 // Sub batch table.
 y+=30-ROW/2;
 const cols=[{key:'code',label:'SUB BATCH',x:PAD+20,w:190},{key:'operator',label:'OPERATOR',x:PAD+210,w:360},
  {key:'total',label:'TOTAL',x:W-PAD-300,right:true},{key:'auto',label:'AUTO',x:W-PAD-160,right:true,color:C.ok},{key:'error',label:'ERROR',x:W-PAD-20,right:true,color:C.bad}];
 const cell=(col,value,font,color)=>{ctx.font=font;ctx.fillStyle=color;ctx.textAlign=col.right?'right':'left';
  ctx.fillText(col.w?clip(ctx,value,col.w):String(value),col.x,y+ROW/2);ctx.textAlign='left';};
 ctx.fillStyle=C.zebra;ctx.fillRect(PAD,y,W-2*PAD,ROW);
 for(const col of cols)cell(col,col.label,`24px ${BOLD}`,col.color||C.muted);
 y+=ROW;
 const body=[...subs,...(report.more?[{code:`+${report.more} more`,operator:'',total:'',auto:'',error:''}]:[])];
 body.forEach((row,i)=>{
  if(i%2)ctx.fillStyle=C.zebra,ctx.fillRect(PAD,y,W-2*PAD,ROW);
  ctx.fillStyle=C.line;ctx.fillRect(PAD,y+ROW-1,W-2*PAD,1);
  for(const col of cols)cell(col,row[col.key]??'',`32px ${col.key==='code'?BOLD:REG}`,col.key==='auto'&&row.auto!==''?C.ok:col.key==='error'&&row.error!==''&&Number(row.error)>0?C.bad:C.text);
  y+=ROW;});
 ctx.fillStyle=C.band;ctx.fillRect(PAD,y,W-2*PAD,ROW);
 const all=report.all||{};
 for(const col of cols)cell(col,{code:'All',operator:`${subs.length+(report.more||0)} sub batches`,total:all.total,auto:all.auto,error:all.error}[col.key]??'',`32px ${BOLD}`,col.key==='auto'?C.ok:col.key==='error'&&all.error>0?C.bad:C.bandText);
 y+=ROW+30+29;
 pair('Time',report.time);
 pair('Speed',`${report.perCard}/card · Accuracy ${report.accuracy}`);
 pair('Model',report.model);
 return canvas.encode('png');
}
