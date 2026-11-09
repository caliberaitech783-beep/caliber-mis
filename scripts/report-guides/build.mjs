// Builds the operating manuals of the report tabs into public/guides as <id>-en.pdf and <id>-hi.pdf,
// and records in manifest.json which version of each tab the manual was built from.
// Run `npm run build` first (the pictures use the built app styles), then:
//   node scripts/report-guides/build.mjs            every tab in src/report-guide-list.mjs
//   node scripts/report-guides/build.mjs ot daily   only these tabs
//   node scripts/report-guides/build.mjs --stale    only tabs whose code or text changed since their manual was built
// Needs Microsoft Edge or Google Chrome on this computer; it prints each page to PDF without opening a window.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {genericGuide} from './generic-guide.mjs';
import {fingerprint} from './sources.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..','..');
const {REPORT_GUIDE_IDS}=await import(pathToFileURL(path.join(root,'src/report-guide-list.mjs')).href);
const browser=[process.env.GUIDE_BROWSER,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(file=>file&&fs.existsSync(file));
if(!browser)throw Error('No Edge or Chrome found. Set GUIDE_BROWSER to the browser program.');
const assets=path.join(root,'dist','app-assets');
if(!fs.existsSync(assets))throw Error('Run "npm run build" first: dist/app-assets is missing.');
const manifestFile=path.join(here,'manifest.json'),manifest=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')):{};
const asked=process.argv.slice(2),isStale=id=>{try{return manifest[id]!==fingerprint(root,id);}catch{return true;}};
const ids=asked.includes('--stale')?REPORT_GUIDE_IDS.filter(isStale):asked.length?asked:REPORT_GUIDE_IDS;
const unknown=ids.filter(id=>!REPORT_GUIDE_IDS.includes(id));if(unknown.length)throw Error('Not in src/report-guide-list.mjs: '+unknown.join(', '));
if(!ids.length){console.log('every manual is up to date');process.exit(0);}

const work=fs.mkdtempSync(path.join(os.tmpdir(),'report-guides-')),target=path.join(root,'public','guides');fs.mkdirSync(target,{recursive:true});
const css=fs.readdirSync(assets).filter(file=>/^index-.*\.css$/.test(file)).map(file=>({file,time:fs.statSync(path.join(assets,file)).mtimeMs})).sort((a,b)=>b.time-a.time)[0].file;
fs.writeFileSync(path.join(work,'app.css'),fs.readFileSync(path.join(assets,css),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/manpower-reports.css'),'utf8'));
// Every print gets its own browser profile: a second print on a profile still in use never finishes.
// The browser sometimes stays open after writing the file, so the print is done when the PDF has stopped growing,
// and the browser is then closed.
let prints=0;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const close=child=>{try{if(process.platform==='win32')execFileSync('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'});else child.kill('SIGKILL');}catch{}};
const print=async(html,pdf)=>{
 for(let attempt=1;attempt<=2;attempt++){
  if(fs.existsSync(pdf))fs.rmSync(pdf);
  const child=spawn(browser,['--headless=new','--disable-gpu','--no-pdf-header-footer','--allow-file-access-from-files','--virtual-time-budget=15000','--user-data-dir='+path.join(work,'profile-'+(++prints)),'--print-to-pdf='+pdf,pathToFileURL(html).href],{stdio:'ignore'});
  let exited=false,size=-1,steady=0;child.on('exit',()=>{exited=true;});
  for(const started=Date.now();Date.now()-started<90000&&steady<3;){
   await sleep(500);const now=fs.existsSync(pdf)?fs.statSync(pdf).size:-1;
   steady=now>20000&&now===size?steady+1:0;size=now;if(exited&&steady<3&&now<=20000)break;
  }
  if(!exited)close(child);
  if(fs.existsSync(pdf)&&fs.statSync(pdf).size>20000)return;
 }
 throw Error('PDF was not produced: '+pdf);
};
for(const id of ids){
 for(const lang of ['en','hi']){
  let html,picture=true;
  if(id==='ot'){execFileSync(process.execPath,[path.join(here,'ot-guide.mjs'),root,work,...(lang==='hi'?['hi']:[])],{stdio:'ignore'});html=path.join(work,'ot-'+lang+'.html');}
  else({file:html,picture}=await genericGuide({root,outDir:work,id,lang}));
  const pdf=path.join(target,id+'-'+lang+'.pdf');await print(html,pdf);
  console.log(id+'-'+lang+'.pdf',Math.round(fs.statSync(pdf).size/1024)+' KB',picture?'':'(no picture)');
 }
 // Read the file again before writing, so two builds running side by side do not drop each other's entries.
 const latest=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')):{};latest[id]=fingerprint(root,id);
 fs.writeFileSync(manifestFile,JSON.stringify(Object.fromEntries(REPORT_GUIDE_IDS.filter(key=>latest[key]).map(key=>[key,latest[key]])),null,1)+'\n');
}
// GUIDE_KEEP=1 keeps the HTML pages so they can be opened in a browser for checking.
// The browser can hold its profile files for a moment after closing; a leftover temporary folder is harmless.
if(process.env.GUIDE_KEEP)console.log('pages kept in',work);else try{fs.rmSync(work,{recursive:true,force:true,maxRetries:5,retryDelay:500});}catch{console.log('temporary pages left in',work);}
console.log('built',ids.length,'manuals in',target);
