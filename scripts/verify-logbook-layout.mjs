// Real components and production CSS, with synthetic records and no live API access.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const source=readFileSync('src/bulk-card-scanning.jsx','utf8');
const start=source.indexOf("    <div className={'scan-trip-row scan-trip-entry'");
const end=source.indexOf('\n   )}',start);
assert.ok(start>0&&end>start,'Scan trip fixture must use the current component markup');
const tripMarkup=source.slice(start,end);
const fieldDefinition=source.match(/^const fields=(.+);$/m)[1];
const fixture=`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Trash2} from 'lucide-react';
import SmartSelect from './src/smart-select.jsx';
import LogBookForm from './src/log-book-form.jsx';
import {SavedLogBookDetails} from './src/saved-log-books.jsx';
import {compactLogBookLabel,tripSerialNumber} from './log-book-labels.mjs';
const params=new URLSearchParams(location.search),mode=params.get('mode')||'scan';
const fields=${fieldDefinition};
const options={accountLocation:'Sasti OC',sites:['Sasti OC'],assets:[{id:'1',kind:'equipment',door:'TPC50',name:'TPC50-05008',site:'Sasti OC'},{id:'2',kind:'vehicle',door:'V/792',name:'Volvo',site:'Sasti OC'}],employees:[{id:'3',name:'Example driver',caliberId:'CMPL9143',site:'Sasti OC',location:'Sasti OC'}],shifts:[{id:'4',name:'Shift A',site:'Sasti OC',startTime:'05:00',endTime:'13:00'}],workOrders:[]};
const record={id:1,book_no:'VLB_S/1ST-NOV26/S1/030',book_type:'vehicle',data:{bookDate:'2026-11-01',location:'Sasti OC',door:'V/792',assetId:'2',employeeId:'3',employeeName:'Example driver',caliberId:'CMPL9143',shiftId:'4',shiftName:'Shift A',shiftHours:8,openingKmr:32577.1,closingKmr:32675.6,openingHmr:1978,closingHmr:1984,totalWorkingHmr:6,totalRunningKmr:98.5,timeMode:'with',trips:[{rowNumber:8,equipmentName:'TPC50-05008',loadingTime:'10:49',unloadingTime:'11:12',tripCount:1}],remark:'Layout verification'}};
window.fetch=async url=>new Response(JSON.stringify(String(url).includes('/options')?options:String(url).includes('/hours')?{breakdownHours:0,warnings:[]}:{records:[],nextCursor:null}),{headers:{'Content-Type':'application/json'}});
function ScanFixture(){
 const [draft,setDraft]=useState({location:'Sasti OC',timeMode:mode==='untimed'?'without':'with',trips:[record.data.trips[0],{...record.data.trips[0],rowNumber:9}]});
 const i=0,correctionView=mode==='correction',card={raw_fields:{responseRecoveryIssues:mode==='recovery'?['Check printed serial']:[]}},fieldIssues={};
 const visibleTrip=()=>true,visibleField=()=>true,fieldClass=()=>'',tripEstimateNote=()=>'',cardMachineHint=()=>'',aliasMachineHint=()=>'',handoverTimeNote=()=>'',continueScanTrip=()=>{},interTripGap=()=>34;
 const update=(key,value)=>setDraft(d=>({...d,[key]:value}));
 const tripEquipmentOptions=[{id:'TPC50-05008',name:'TPC50-05008'}],resolvedMachineName=a=>a.name,tripEquipmentSelectionValue=r=>r.equipmentName,selectTripEquipment=(r,value)=>({...r,equipmentName:value});
 return <div className="scan-page scan-review-page scan-review-compact" style={{height:'auto',display:'block',padding:0}}><div className="scan-selected-card" style={{display:'block'}}><section className="scan-draft-sheet" style={{height:'auto',position:'static',transform:'none',width:'100%'}}><fieldset id="scan-entry-fields"><div className="scan-fields scan-card-fields"><div className="scan-review-doc-meta"><strong>Book NO</strong><span>{record.book_no}</span></div><label><span>Doc type</span><input readOnly value="VLB"/></label>{fields.map(([key,label,type])=><label key={key} data-field={key}><span>{compactLogBookLabel(label)}</span>{["number","date"].includes(type)?<input readOnly type={type} value={record.data[key]??""}/>:<SmartSelect showOverflowValue aria-label={label} value="selected" onChange={()=>{}}><option value="selected">{key==="assetId"?"V792 · Volvo":key==="workOrderId"?"CMLL/SASTI/2026/WORK-ORDER-123456789":record.data[key]||label}</option></SmartSelect>}</label>)}</div><div className="scan-trips">{draft.trips.map((r,i)=>(${tripMarkup}))}</div></fieldset></section></div></div>;
}
const manual=mode.startsWith('manual-');
createRoot(document.getElementById('fixture')).render(<div className="app erp-shell" style={{display:'block',minHeight:0}}><main className="mobile-workspace" style={{padding:0,margin:0}}>{manual?<LogBookForm kind={mode==='manual-elb'?'equipment':'vehicle'} session={{token:'fixture',user:{location:'Sasti OC'}}} initialRecord={record}/>:mode==='saved'?<SavedLogBookDetails record={record} kind="vehicle"/>:<ScanFixture/>}</main></div>);
`;
const bundle=await build({stdin:{contents:fixture,loader:'jsx',resolveDir:process.cwd(),sourcefile:'logbook-layout-fixture.jsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'empty'}});
const css=readdirSync('dist/app-assets').filter(n=>n.endsWith('.css')).map(n=>readFileSync('dist/app-assets/'+n,'utf8')).join('\n');
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><style>html,body{margin:0;padding:0}#fixture{width:100%;min-width:0}.app.erp-shell{width:100%;padding:0}.mobile-workspace{width:100%;box-sizing:border-box}</style></head><body><div id="fixture"></div><script>'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>';
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html)});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
mkdirSync('layout-checks',{recursive:true});
const findings=[];
try{
 for(const width of [320,390,640,840,900,1024])for(const mode of ['scan','recovery','correction','untimed','manual-vlb','manual-elb','saved']){
  const page=await browser.newPage({viewport:{width,height:1000},locale:'en-IN'});
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(width,mode,error.message)});
  await page.goto('http://127.0.0.1:'+server.address().port+'/?mode='+mode);
  await page.waitForSelector(mode.startsWith('manual')?'#logbook-entry-form':mode==='saved'?'.saved-logbook-values':'#scan-entry-fields',{state:'attached'});
  if(mode.startsWith('manual'))await page.waitForFunction(()=>document.querySelector('.logbook-book-number')?.textContent.includes('/030'));
  await page.evaluate(()=>document.fonts.ready);
  const result=await page.evaluate(({mode,width})=>{
   const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;
   const round=v=>Math.round(v*100)/100;
   const issues=[];
   if(document.documentElement.scrollWidth>width+2)issues.push('Page overflow '+document.documentElement.scrollWidth+' > '+width);
   const labels=[...document.querySelectorAll('#scan-entry-fields label > span,#logbook-entry-form .logbook-field > span,.saved-logbook-values dt')].filter(visible);
   if(labels.length<5)issues.push('Expected visible form/detail labels, found '+labels.length);
   for(const e of labels){const s=getComputedStyle(e);if(parseFloat(s.fontSize)<16||Number(s.fontWeight)<700)issues.push('Small/nonbold label '+e.textContent+' '+s.fontSize+'/'+s.fontWeight);}
   for(const e of [...document.querySelectorAll('#scan-entry-fields input,#scan-entry-fields output,#logbook-entry-form .logbook-field input')].filter(visible)){
    const s=getComputedStyle(e),box=e.getBoundingClientRect();if(parseFloat(s.fontSize)<20)issues.push('Small value '+(e.getAttribute('aria-label')||e.value)+' '+s.fontSize);
    if(box.right>width+2||box.left< -2)issues.push('Field outside viewport');
    if(e.type==='time'&&box.width<168)issues.push('Native time too narrow: '+box.width);
    if(e.closest('.scan-trip-entry')&&e.tagName==='INPUT'&&parseFloat(s.fontSize)!==20)issues.push('Trip value must use its bounded 20px font: '+s.fontSize);
   }
   if(mode==='scan'||mode==='recovery'||mode==='correction'||mode==='untimed'){
    for(const row of document.querySelectorAll('.scan-trip-entry')){
     const fields=[...row.querySelectorAll('label')].filter(visible).map(e=>e.getBoundingClientRect());
     for(let i=0;i<fields.length;i++)for(let j=i+1;j<fields.length;j++){const a=fields[i],b=fields[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)issues.push('Trip fields overlap');}
     if(document.querySelector('.scan-draft-sheet').clientWidth>880){const tops=fields.map(r=>round(r.top));if(Math.max(...tops)-Math.min(...tops)>2)issues.push('Wide trip labels do not share a row');}
    }
   }
   for(const e of document.querySelectorAll('#logbook-entry-form .searchable-select-full-value')){const control=e.parentElement.querySelector('.searchable-select-control');if(visible(e)&&e.getBoundingClientRect().top<control.getBoundingClientRect().bottom-1)issues.push('Full selected value must appear below its control');}
   const root=document.querySelector('#logbook-entry-form')||document.querySelector('#scan-entry-fields')||document.querySelector('.saved-logbook-values');
   const layout=[];for(let e=root;e&&layout.length<5;e=e.parentElement){const r=e.getBoundingClientRect(),s=getComputedStyle(e);layout.push({tag:e.tagName,cls:e.className,display:s.display,visibility:s.visibility,width:r.width,height:r.height});}
   return {width,mode,issues,labelCount:labels.length,layout};
  },{mode,width});
  result.issues.push(...errors);
  findings.push(result);
  writeFileSync('layout-checks/results.json',JSON.stringify(findings,null,2));
  if([320,390,840,900,1024].includes(width)||result.issues.length)await page.screenshot({path:'layout-checks/'+mode+'-'+width+'.png',fullPage:true});
  if(mode==='scan'){
   await page.getByRole('button',{name:'Remove trip 1',exact:true}).click();
   assert.equal(await page.locator('.scan-trip-entry').count(),1,'Delete removes only the selected row');
   assert.equal(await page.locator('.scan-trip-serial output').textContent(),'9','Delete preserves the remaining printed serial');
  }
  await page.close();
 }
 writeFileSync('layout-checks/results.json',JSON.stringify(findings,null,2));
 const failures=findings.filter(f=>f.issues.length);
 assert.deepEqual(failures,[],'Responsive layout regressions: '+JSON.stringify(failures));
 console.log('Verified 42 layouts: scan, serial correction, issue correction, no-time, VLB, ELB and saved records at 320–1024px; delete preserves serials.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
