// Builds the operating manual of one report tab from its content file (content/<id>.json), in English or Hindi.
// Tabs that use the shared operations screen also get a picture: the real screen code rendered with sample data.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const load=file=>import(pathToFileURL(file).href);
const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
// Tabs drawn by the shared screen in src/operations-reports.jsx.
export const SHARED_SCREEN_IDS=['daily','vehicle','equipment','site','trends','vehicle-trips','loading','shift','timing','utilisation','breakdown','meters','missing','scans','tonnage','fuel','cost','targets','billing'];

const TEXT={
 en:{manual:'Operating manual',who:'For site in-charges, MIS staff and reviewers',asOf:'Matches the system as of 9 November 2026',sample:'The picture uses sample data, not real records',
  h:['What this report shows','Open the report and choose what to see','What is on the screen','The columns','Keep in mind','Download, print and search','Review checklist','Common questions'],
  open:menu=>'In the left menu open <b>'+esc(menu)+'</b>.',choose:'Then set the selectors described below.',oneRow:'One row',
  selector:'Selector or button',does:'What it does',part:'On the screen',shows:'What it shows',column:'Column',meaning:'Meaning',step:'Step',doThis:'Do this',question:'Question',answer:'Answer',
  picture:'Picture 1.',caption:'The report screen: selectors, totals and the table.',sampleData:'Sample data.',
  download:['Tables on this page have a <b>Generate</b> button: <b>Download as PDF</b>, <b>Download as Excel</b> or <b>Smart Print</b>. The file contains the whole table, not only the rows visible on screen.','Type in <b>Search this report</b> to find a door number, driver or card inside a table.','Press a column heading to sort by that column.','If the page looks old after an update, press <b>Ctrl + F5</b> once.'],
  closing:'<b>This manual shows how to read and verify the report.</b> What action to take on its findings is as instructed by management.'},
 hi:{manual:'संचालन मार्गदर्शिका',who:'साइट इंचार्ज, MIS स्टाफ़ और जाँच करने वालों के लिए',asOf:'9 नवंबर 2026 तक के सिस्टम के अनुसार',sample:'चित्र में नमूना डेटा है, असली रिकॉर्ड नहीं · स्क्रीन के बटन और कॉलम के नाम अंग्रेज़ी में ही लिखे हैं',
  h:['यह रिपोर्ट क्या दिखाती है','रिपोर्ट खोलें और चुनें कि क्या देखना है','स्क्रीन पर क्या-क्या है','कॉलम','ध्यान रखें','डाउनलोड, प्रिंट और खोज','जाँच की सूची','आम सवाल'],
  open:menu=>'बाएँ मेनू में <b>'+esc(menu)+'</b> खोलें।',choose:'फिर नीचे बताए गए सिलेक्टर चुनें।',oneRow:'एक पंक्ति',
  selector:'सिलेक्टर या बटन',does:'क्या करता है',part:'स्क्रीन पर',shows:'क्या दिखाता है',column:'कॉलम',meaning:'मतलब',step:'चरण',doThis:'यह करें',question:'सवाल',answer:'जवाब',
  picture:'चित्र 1.',caption:'रिपोर्ट की स्क्रीन: सिलेक्टर, कुल संख्याएँ और तालिका।',sampleData:'नमूना डेटा।',
  download:['इस पेज की तालिकाओं में <b>Generate</b> बटन है: <b>Download as PDF</b>, <b>Download as Excel</b> या <b>Smart Print</b>। फ़ाइल में पूरी तालिका आती है, केवल स्क्रीन पर दिख रही पंक्तियाँ नहीं।','किसी तालिका में डोर नंबर, ड्राइवर या कार्ड ढूँढने के लिए <b>Search this report</b> में लिखें।','किसी कॉलम के अनुसार क्रम लगाने के लिए उस कॉलम का शीर्षक दबाएँ।','अपडेट के बाद पेज पुराना दिखे तो एक बार <b>Ctrl + F5</b> दबाएँ।'],
  closing:'<b>यह मार्गदर्शिका रिपोर्ट पढ़ना और जाँचना बताती है।</b> इसके नतीजों पर क्या कार्रवाई करनी है, यह प्रबंधन के निर्देश के अनुसार होगा।'}};

const guideCss=`@page{size:A4;margin:15mm 15mm 16mm}*{box-sizing:border-box}html{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;font-size:10.6pt;line-height:1.45;color:#231a33}
.cover{padding:18px 22px;border-radius:12px;background:#59338b;color:#fff;margin-bottom:14px}.cover .kicker{margin:0 0 6px;font-size:8.5pt;letter-spacing:.12em;font-weight:700;opacity:.85}.cover h1{margin:0;font-size:22pt;line-height:1.15}.cover .sub{margin:4px 0 10px;font-size:13pt}.cover .meta{margin:0;font-size:8.8pt;opacity:.9}
h2{margin:16px 0 6px;font-size:13.5pt;color:#59338b;break-after:avoid}p{margin:0 0 7px}ol,ul{margin:0 0 8px;padding-left:20px}li{margin-bottom:3px}
.note{padding:8px 11px;border-left:4px solid #59338b;background:#f3eefa;border-radius:0 8px 8px 0;font-size:9.8pt}
table.plain{width:100%;border-collapse:collapse;margin:4px 0 9px;font-size:9.8pt}table.plain tr{break-inside:avoid}table.plain th{text-align:left;padding:6px 9px;background:#ece5f6;border:1px solid #d6cae6}table.plain td{padding:6px 9px;border:1px solid #ddd3ea;vertical-align:top}table.plain td:first-child{width:31%;font-weight:700}table.steps td:first-child{width:9%;text-align:center}
figure{margin:8px 0 10px;break-inside:avoid}figure .frame{border:1px solid #cfc3e0;border-radius:8px;overflow:hidden;background:#f6f3fb}figure iframe{display:block;border:0;width:1120px;zoom:.605}figcaption{margin-top:4px;font-size:9pt;color:#4f4660}`;
const hindiCss="body{font-family:'Nirmala UI',Mangal,Arial,sans-serif;font-size:10.8pt;line-height:1.62}.cover h1{font-size:21pt}h2{font-size:13pt}table.plain,.note{font-size:10pt}figcaption{font-size:9.4pt}";
const figureCss=`html,body{margin:0;background:#f6f3fb;height:auto;overflow:hidden}body{font-family:Arial,Helvetica,sans-serif}
.operations-reports{padding:14px}
.g-report{border:1px solid #dfd6e9;border-radius:12px;background:#fff;padding:14px 16px;overflow:hidden;margin-top:12px}.g-report>header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.g-report h2{margin:0 0 4px;font-size:17px}.g-report header p{margin:0;font-size:12px;color:#665e75}
.g-generate{padding:8px 14px;border:1px solid #c7b5dd;border-radius:9px;font-size:13px;font-weight:700;white-space:nowrap;background:#fff}
.g-tools{display:flex;align-items:center;gap:12px;margin:10px 0;font-size:12px;color:#665e75}.g-search{min-width:230px;padding:8px 12px;border:1px solid #d5cbe2;border-radius:9px;color:#8d859a;background:#fff}
.g-table{overflow:hidden;border:1px solid #e3ddec;border-radius:9px}.g-report table{border-collapse:collapse;font-size:12.5px;white-space:nowrap}.g-report th{padding:9px 14px;text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#59627a;background:#f1f4f9;border-bottom:1px solid #dfe3ec}.g-report td{padding:9px 14px;border-bottom:1px solid #eef0f4;vertical-align:middle}.g-report td:first-child,.g-report th:first-child{text-align:center}.g-empty{margin:10px 0 0;font-size:13px;color:#665e75}`;

// The shared operations screen rendered with the sample payload. Returns '' when no fixture is present.
async function sharedScreen(root,id){
 const fixtureFile=path.join(here,'fixture-operations.mjs');
 if(!SHARED_SCREEN_IDS.includes(id)||!fs.existsSync(fixtureFile))return '';
 const require=createRequire(path.join(root,'package.json')),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),h=React.createElement;
 const {transformWithOxc}=await load(require.resolve('vite')),model=await load(path.join(root,'src/operations-report-model.mjs')),dates=await load(path.join(root,'src/date-range-filter.mjs'));
 const payload=(await load(fixtureFile)).payload,days=[...new Set((payload.records||[]).map(r=>String(r.book_date||r.data?.bookDate||'').slice(0,10)).filter(Boolean))].sort();
 const from=days[0],to=days.at(-1);
 const ReportSection=({title,description,rows,columns,emptyMessage})=>h('section',{className:'g-report'},
  h('header',null,h('div',null,h('h2',null,title),h('p',null,description)),h('span',{className:'g-generate'},'Generate ▾')),
  h('div',{className:'g-tools'},h('span',{className:'g-search'},'Search this report'),h('span',null,rows.length+' record'+(rows.length===1?'':'s'))),
  rows.length?h('div',{className:'g-table'},h('table',null,h('thead',null,h('tr',null,h('th',null,'Sr. No.'),columns.map(c=>h('th',{key:c.key},c.label+' ⇅')))),
   h('tbody',null,rows.slice(0,6).map((row,i)=>h('tr',{key:i},h('td',null,i+1),columns.map(c=>h('td',{key:c.key},String(c.value(row)??'')))))))):h('p',{className:'g-empty'},emptyMessage));
 const source=fs.readFileSync(path.join(root,'src/operations-reports.jsx'),'utf8');
 const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function'),'operations-reports.jsx',{jsx:{runtime:'classic'}});
 // The Trip Timing tab draws its delay views with its own component: the real code, with React's own state.
 const timingRules=await load(path.join(root,'shared/trip-timing-report.mjs'));
 const timing=await transformWithOxc(fs.readFileSync(path.join(root,'src/trip-timing-report.jsx'),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replace(/^export /gm,''),'trip-timing-report.jsx',{jsx:{runtime:'classic'}});
 const timingEnv={React,useMemo:React.useMemo,useState:React.useState,StepBackButton:({label='Back'})=>React.createElement('button',{type:'button',className:'step-back-button'},'← '+label),...timingRules};
 const TripTimingReport=new Function(...Object.keys(timingEnv),timing.code+';return TripTimingReport')(...Object.values(timingEnv));
 // The Loading Equipment-wise tab draws its working and idle time view the same way.
 const loadingRules=await load(path.join(root,'shared/loading-machine-report.mjs'));
 const loadingScreen=await transformWithOxc(fs.readFileSync(path.join(root,'src/loading-machine-report.jsx'),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replace(/^export /gm,''),'loading-machine-report.jsx',{jsx:{runtime:'classic'}});
 const loadingEnv={React,useMemo:React.useMemo,useState:React.useState,StepBackButton:timingEnv.StepBackButton,tripEntries:timingRules.tripEntries,...loadingRules};
 const LoadingMachineReport=new Function(...Object.keys(loadingEnv),loadingScreen.code+';return LoadingMachineReport')(...Object.values(loadingEnv));
 const slots=[{from,to,site:'',shift:'',asset:'',employee:'',workOrder:'',loading:''},{...payload,reportRange:from+'|'+to},'',false,0,false];let cursor=0;
 const env={SmartSelect:'select',ManpowerReports:()=>null,ProductionReports:()=>null,MeterContinuityReport:()=>null,BatchStatusReport:()=>null,TripTimingReport,LoadingMachineReport,React,...model,...dates,useEffect:()=>{},useMemo:fn=>fn(),useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],()=>{}];}};
 const Screen=new Function(...Object.keys(env),code+';return SavedOperationReports')(...Object.values(env));
 return '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"><style>'+figureCss+'</style></head><body>'+renderToStaticMarkup(Screen({session:{token:'guide'},reportId:id,onSelect(){},ReportSection}))+'</body></html>';
}

export async function genericGuide({root,outDir,id,lang}){
 const content=JSON.parse(fs.readFileSync(path.join(here,'content',id+'.json'),'utf8')),t=TEXT[lang],c=content[lang],hi=lang==='hi';
 for(const key of ['purpose','row','filters','screen','columns','notes','checklist','faq'])if(c?.[key]==null)throw Error(id+' ('+lang+'): missing '+key);
 const screen=await sharedScreen(root,id),pairs=(rows,a,b,cls='')=>rows.length?'<table class="plain'+cls+'"><tr><th>'+a+'</th><th>'+b+'</th></tr>'+rows.map(([x,y])=>'<tr><td>'+esc(x)+'</td><td>'+esc(y)+'</td></tr>').join('')+'</table>':'';
 let n=0;const heading=i=>'<h2>'+(++n)+'. '+t.h[i]+'</h2>';
 const body='<header class="cover"><p class="kicker">CALIBER MINING AND LOGISTICS LIMITED · PULSE-II · '+esc(content.group).toUpperCase()+'</p><h1>'+esc(content.title)+'</h1><p class="sub">'+t.manual+'</p><p class="meta">'+t.who+' · '+esc(content.asOf?.[lang]||t.asOf)+(screen?' · '+t.sample:'')+'</p></header>'
  +'<section>'+heading(0)+'<p>'+esc(c.purpose)+'</p><p class="note"><b>'+t.oneRow+'.</b> '+esc(c.row)+'</p></section>'
  +'<section>'+heading(1)+'<p>'+t.open(content.menu)+' '+t.choose+'</p>'+pairs(c.filters,t.selector,t.does)+'</section>'
  +'<section>'+heading(2)+(screen?'<figure><div class="frame" data-fig="screen"></div><figcaption><b>'+t.picture+'</b> '+t.caption+' <i>'+t.sampleData+'</i></figcaption></figure>':'')+pairs(c.screen,t.part,t.shows)+'</section>'
  +'<section>'+heading(3)+pairs(c.columns,t.column,t.meaning)+'</section>'
  +'<section>'+heading(4)+'<ul>'+c.notes.map(note=>'<li>'+esc(note)+'</li>').join('')+'</ul></section>'
  +'<section>'+heading(5)+'<ul>'+t.download.map(line=>'<li>'+line+'</li>').join('')+'</ul></section>'
  +'<section>'+heading(6)+pairs(c.checklist.map((step,i)=>[i+1,step]),t.step,t.doThis,' steps')+'<p class="note">'+t.closing+'</p></section>'
  +'<section>'+heading(7)+pairs(c.faq,t.question,t.answer)+'</section>';
 const script=`const pages=JSON.parse(document.getElementById('pages').textContent);let pending=0;
for(const frame of document.querySelectorAll('.frame')){const iframe=document.createElement('iframe');pending++;
 iframe.addEventListener('load',()=>{const fit=()=>{const box=iframe.contentDocument.body.firstElementChild;iframe.style.height=Math.ceil(box.getBoundingClientRect().height)+'px';};fit();setTimeout(fit,300);setTimeout(()=>{fit();if(!--pending)document.title='ready';},900);});
 iframe.srcdoc=pages[frame.dataset.fig];frame.appendChild(iframe);}`;
 const file=path.join(outDir,id+'-'+lang+'.html');
 fs.writeFileSync(file,'<!doctype html><html lang="'+lang+'"><head><meta charset="utf-8"><title>'+esc(content.title)+' · '+t.manual+'</title><style>'+guideCss+(hi?hindiCss:'')+'</style></head><body>'+body
  +'<script type="application/json" id="pages">'+JSON.stringify(screen?{screen}:{}).replace(/</g,'\\u003c')+'</'+'script><script>'+script+'</'+'script></body></html>');
 return {file,picture:Boolean(screen)};
}
