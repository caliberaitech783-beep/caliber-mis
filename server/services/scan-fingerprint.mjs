import {createCanvas,loadImage} from '@napi-rs/canvas';

// Visual fingerprint of a scanned card. A rescan of the same paper is never
// byte-identical (feed position, light and noise differ), so duplicates are
// recognised by where the ink lies. The page is averaged down to 512 pixels
// wide, graded into ink / paper relative to the paper tone and the darkest ink
// (so brightness and contrast differences cancel), and split into square cells
// (64 across, 8 pixels each) holding the ink weight of each cell, smoothed with
// its neighbours. Two cards are aligned first (the printed form is the same on
// every card, so the best overlap gives the feed offset, coarse grid then fine
// grid then quarter cells), then compared by ink overlap per band of the card:
// 0 means the same ink everywhere, 100 means no ink in common. Bands separate
// the handwriting areas (header, trip grid, machine-wise summary); a band with
// enough ink must match as well as the whole page. A card fed the other way
// round is compared through the reversed grid.
export const FINGERPRINT_VERSION=6;
export const FINGERPRINT_BANDS=[['header',0,.2],['grid',.2,.62],['summary',.62,1],['page',0,1]];
export const FINGERPRINT_MAX=100;
const COLS=64,WORK_WIDTH=512,INK_MARGIN=.12,SMOOTH=3,COARSE=4,COARSE_SHIFT=2,FINE_SHIFT=3,QUARTER=.25,DECISIVE_SHARE=.2;

export function scanFingerprintSettings(env=process.env){
 const number=(key,fallback)=>{const value=Number(env[key]);return Number.isInteger(value)&&value>=0&&value<=FINGERPRINT_MAX?value:fallback};
 return {enabled:env.SCAN_DUPLICATE_FINGERPRINT==='true',skipPercent:number('SCAN_DUPLICATE_SKIP_PERCENT',15),suspectPercent:number('SCAN_DUPLICATE_SUSPECT_PERCENT',30)};
}

// Repeated halving averages every source pixel into the result; one large
// drawImage step would sample a few pixels and turn scanner noise into bits.
function averagedGray(image){
 let source=image,width=image.width,height=image.height;
 const canvases=[];
 try{
  while(width>WORK_WIDTH*2){
   width=Math.round(width/2);height=Math.round(height/2);
   const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
   ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.fillStyle='white';ctx.fillRect(0,0,width,height);ctx.drawImage(source,0,0,width,height);
   canvases.push(canvas);source=canvas;
  }
  const finalWidth=WORK_WIDTH,finalHeight=Math.max(1,Math.round(height*WORK_WIDTH/width));
  const canvas=createCanvas(finalWidth,finalHeight),ctx=canvas.getContext('2d');
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.fillStyle='white';ctx.fillRect(0,0,finalWidth,finalHeight);ctx.drawImage(source,0,0,finalWidth,finalHeight);
  canvases.push(canvas);
  const {data}=ctx.getImageData(0,0,finalWidth,finalHeight),gray=new Uint8Array(finalWidth*finalHeight);
  for(let i=0;i<gray.length;i++)gray[i]=.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2];
  return {gray,width:finalWidth,height:finalHeight};
 }finally{for(const canvas of canvases)canvas.width=canvas.height=1;}
}

export async function fingerprintScanImage(bytes){
 const image=await loadImage(bytes);
 if(!image.width||!image.height||image.width*image.height>20000000)throw Error('Scan dimensions exceed the 20 megapixel limit.');
 const {gray:sharp,width,height}=averagedGray(image);
 // A light blur first: a one pixel printed line that lands between two pixels in
 // one scan and on one pixel in the next must weigh the same in both.
 const gray=new Uint8Array(sharp.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let total=0,n=0;for(let dy=-1;dy<=1;dy++){const yy=y+dy;if(yy<0||yy>=height)continue;for(let dx=-1;dx<=1;dx++){const xx=x+dx;if(xx<0||xx>=width)continue;total+=sharp[yy*width+xx];n++;}}gray[y*width+x]=total/n;}
 // Paper tone is the median brightness; ink tone the darkest two percent.
 const histogram=new Uint32Array(256);for(let i=0;i<gray.length;i++)histogram[gray[i]]++;
 const level=fraction=>{let seen=0;for(let v=0;v<256;v++){seen+=histogram[v];if(seen>=fraction*gray.length)return v;}return 255;};
 const paper=level(.5),inkTone=level(.02),range=Math.max(40,paper-inkTone);
 const cell=width/COLS,rows=Math.max(1,Math.round(height/cell));
 const raw=new Float64Array(COLS*rows);
 for(let cy=0;cy<rows;cy++)for(let cx=0;cx<COLS;cx++){
  const ya=Math.floor(cy*height/rows),yb=Math.max(ya+1,Math.floor((cy+1)*height/rows)),xa=Math.floor(cx*cell),xb=Math.max(xa+1,Math.floor((cx+1)*cell));
  let total=0;for(let y=ya;y<yb;y++)for(let x=xa;x<xb;x++){const depth=(paper-gray[y*width+x])/range-INK_MARGIN;if(depth>0){const d=depth>1?1:depth;total+=d*d;}}
  raw[cy*COLS+cx]=total/((yb-ya)*(xb-xa));
 }
 // Neighbour smoothing: ink near a cell edge counts partly for nearby cells.
 const cells=new Uint8Array(COLS*rows);
 for(let cy=0;cy<rows;cy++)for(let cx=0;cx<COLS;cx++){
  let total=0,weight=0;
  for(let dy=-SMOOTH;dy<=SMOOTH;dy++)for(let dx=-SMOOTH;dx<=SMOOTH;dx++){const y=cy+dy,x=cx+dx;if(y<0||y>=rows||x<0||x>=COLS)continue;const w=(SMOOTH+1-Math.abs(dx))*(SMOOTH+1-Math.abs(dy));total+=w*raw[y*COLS+x];weight+=w;}
  cells[cy*COLS+cx]=Math.min(255,Math.round(1000*total/weight));
 }
 return {version:FINGERPRINT_VERSION,cols:COLS,rows,cells:Buffer.from(cells).toString('base64')};
}

const decode=fingerprint=>{if(!fingerprint||fingerprint.version!==FINGERPRINT_VERSION||typeof fingerprint.cells!=='string')return null;const cells=Uint8Array.from(Buffer.from(fingerprint.cells,'base64'));return cells.length===fingerprint.cols*fingerprint.rows?cells:null;};
const bandRows=(rows,top,bottom)=>{const y0=Math.floor(top*rows),y1=Math.max(y0+1,Math.min(rows,Math.ceil(bottom*rows)));return [y0,y1];};

// Value of grid b at a fractional position, bilinear between its cells.
function sample(b,cols,rows,x,y){
 const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
 const at=(cx,cy)=>cx<0||cy<0||cx>=cols||cy>=rows?0:b[cy*cols+cx];
 if(!fx&&!fy)return at(x0,y0);
 return at(x0,y0)*(1-fx)*(1-fy)+at(x0+1,y0)*fx*(1-fy)+at(x0,y0+1)*(1-fx)*fy+at(x0+1,y0+1)*fx*fy;
}
function overlap(a,b,cols,rows,y0,y1,dx,dy){
 let shared=0,union=0;
 const whole=Number.isInteger(dx)&&Number.isInteger(dy);
 for(let y=y0;y<y1;y++)for(let x=0;x<cols;x++){
  const va=a[y*cols+x];let vb;
  if(whole){const bx=x+dx,by=y+dy;vb=bx<0||by<0||bx>=cols||by>=rows?0:b[by*cols+bx];}else vb=sample(b,cols,rows,x+dx,y+dy);
  shared+=Math.min(va,vb);union+=Math.max(va,vb);
 }
 return {distance:union?100*(1-shared/union):0,union};
}
function pooled(cells,cols,rows){
 const pcols=Math.ceil(cols/COARSE),prows=Math.ceil(rows/COARSE),out=new Float64Array(pcols*prows);
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)out[Math.floor(y/COARSE)*pcols+Math.floor(x/COARSE)]+=cells[y*cols+x];
 return {cells:out,cols:pcols,rows:prows};
}
// Feed offset between two scans: coarse grid in whole cells, then the fine grid
// around it in whole cells, then quarter cells.
function align(a,b,cols,rows){
 const pa=pooled(a,cols,rows),pb=pooled(b,cols,rows);
 let coarse={dx:0,dy:0,distance:Infinity};
 for(let dy=-COARSE_SHIFT;dy<=COARSE_SHIFT;dy++)for(let dx=-COARSE_SHIFT;dx<=COARSE_SHIFT;dx++){const {distance}=overlap(pa.cells,pb.cells,pa.cols,pa.rows,0,pa.rows,dx,dy);if(distance<coarse.distance)coarse={dx,dy,distance};}
 let best={dx:coarse.dx*COARSE,dy:coarse.dy*COARSE,distance:Infinity};
 const consider=(dx,dy)=>{const {distance}=overlap(a,b,cols,rows,0,rows,dx,dy);if(distance<best.distance)best={dx,dy,distance};};
 const cx=best.dx,cy=best.dy;
 for(let dy=-FINE_SHIFT;dy<=FINE_SHIFT;dy++)for(let dx=-FINE_SHIFT;dx<=FINE_SHIFT;dx++)consider(cx+dx,cy+dy);
 const fx=best.dx,fy=best.dy;
 for(let dy=-1+QUARTER;dy<1;dy+=QUARTER)for(let dx=-1+QUARTER;dx<1;dx+=QUARTER)if(dx||dy)consider(fx+dx,fy+dy);
 return best;
}
// A band with little ink (a short machine-wise summary, an empty header box)
// swings wildly between two scans of the same paper, so only bands holding at
// least a fifth of the page's ink decide; the whole page always does.
function gridDistance(a,b,cols,rows){
 const {dx,dy}=align(a,b,cols,rows),bands={},measured={};
 for(const [name,top,bottom] of FINGERPRINT_BANDS){const [y0,y1]=bandRows(rows,top,bottom);measured[name]=overlap(a,b,cols,rows,y0,y1,dx,dy);bands[name]=Math.round(measured[name].distance);}
 let max=bands.page;
 for(const [name] of FINGERPRINT_BANDS)if(name!=='page'&&measured[name].union>=DECISIVE_SHARE*measured.page.union&&bands[name]>max)max=bands[name];
 return {max,bands,offset:{dx,dy}};
}

// Distance between two cards. The feed orientation that overlaps better before
// alignment is the one aligned and compared.
export function fingerprintDistance(a,b){
 if(!a||!b||a.cols!==b.cols||a.rows!==b.rows)return {max:FINGERPRINT_MAX,bands:{}};
 const ga=decode(a),gb=decode(b);if(!ga||!gb)return {max:FINGERPRINT_MAX,bands:{}};
 const gbDown=Uint8Array.from(gb).reverse();
 const upright=overlap(ga,gb,a.cols,a.rows,0,a.rows,0,0).distance,rotated=overlap(ga,gbDown,a.cols,a.rows,0,a.rows,0,0).distance;
 const result=gridDistance(ga,rotated<upright?gbDown:gb,a.cols,a.rows);
 return {...result,rotated:rotated<upright};
}

export function classifyFingerprintMatch(distance,settings=scanFingerprintSettings()){
 if(distance.max<=settings.skipPercent)return 'duplicate';
 if(distance.max<=settings.suspectPercent)return 'suspect';
 return 'different';
}

// Closest candidate and its classification. Candidates carry {id,fingerprint,...}.
export function closestFingerprint(fingerprint,candidates,settings=scanFingerprintSettings()){
 let best=null;
 for(const candidate of candidates||[]){
  if(!candidate?.fingerprint)continue;
  const distance=fingerprintDistance(fingerprint,candidate.fingerprint);
  if(!Object.keys(distance.bands).length)continue; // not comparable (older version, different grid)
  if(!best||distance.max<best.distance.max)best={candidate,distance};
 }
 return best?{...best,match:classifyFingerprintMatch(best.distance,settings)}:null;
}
