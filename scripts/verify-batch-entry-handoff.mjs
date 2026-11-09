// Exercise real batch picker, manual form and scanner components with synthetic APIs.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {build,preview} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';

mkdirSync('layout-checks',{recursive:true});
const fixture=`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import VlbCreateBatch from '../src/vlb-create-batch.jsx';
import VlbEntryWorkspace,{rememberVlbEntryBatch} from '../src/vlb-entry-workspace.jsx';
import LogBookForm from '../src/log-book-form.jsx';
import BulkCardScanning from '../src/bulk-card-scanning.jsx';
const session={login:'handoff-test',token:'synthetic',role:'super'};
const batch={id:'selected-batch',name:'Dudhichua test batch',site:'Dudhichua OC',report_date:'2026-11-01',shift:'S1',records:[],entry_count:121,closed_at:null,twoStage:true,stage:'vlb_open',created_by:session.login};
const other={...batch,id:'different-batch',name:'Other site batch',site:'Jayant OC'};
const options={sites:['Dudhichua OC','Jayant OC'],assets:[],employees:[],shifts:[{id:'1',site:'Dudhichua OC',name:'Shift A',shiftCode:'I',startTime:'05:00',endTime:'13:00'}],workOrders:[]};
window.requests=[];
window.batchCounts={batchId:batch.id,entry_count:121,manual_count:2,scan_count:119};
const scenario=new URLSearchParams(location.search);
window.fetch=async(input,init={})=>{
 const url=new URL(String(input),location.href);window.requests.push({path:url.pathname,method:init.method||'GET'});
 if(init.method&&init.method!=='GET')throw Error('Unexpected mutation during entry navigation');
 let data={devices:[],files:[]};
 if(url.pathname==='/api/log-books/options'){
  await new Promise(resolve=>setTimeout(resolve,scenario.get('order')==='options-last'?180:10));data=options;
 }else if(url.pathname==='/api/vlb-batches'){
  await new Promise(resolve=>setTimeout(resolve,scenario.get('order')==='options-last'?10:180));
  data={batches:[other,{...batch,entry_count:window.batchCounts.entry_count}],actor:{login:session.login,mis:true,admin:true},twoStage:true};
 }else if(url.pathname==='/api/vlb-batches/preview')data={records:[],name:batch.name};
 else if(url.pathname==='/api/vlb-batches/approvals')data={requests:[]};
 else if(url.pathname==='/api/vlb-batches/selected-batch/card-counts')data=window.batchCounts;
 else if(url.pathname==='/api/vlb-batches/selected-batch')data=batch;
 else if(url.pathname==='/api/vlb-batches/different-batch')data=other;
 else if(url.pathname==='/api/scan-batches')data={batches:[]};
 else if(url.pathname==='/api/scan-settings')data={};
 return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
};
function App(){
 const [page,setPage]=useState('report');
 const go=(name,batch)=>{rememberVlbEntryBatch(session,batch);history.replaceState(null,'','?page='+name);setPage(name)};
 return page==='report'?<VlbCreateBatch session={session} ReportSection={()=>null} onExit={()=>{}} onManual={batch=>go('vlb-manual',batch)} onScan={batch=>go('trip-scan',batch)}/>:<VlbEntryWorkspace kind="vehicle" session={session} mode={page==='vlb-manual'?'manual':'scan'} onExit={()=>setPage('report')}>{page==='vlb-manual'?<LogBookForm kind="vehicle" session={session}/>:<BulkCardScanning kind="vehicle" session={session}/>}</VlbEntryWorkspace>;
}
createRoot(document.getElementById('fixture')).render(<App/>);
`;
writeFileSync('layout-checks/batch-entry-fixture.jsx',fixture);
writeFileSync('layout-checks/batch-entry.html','<!doctype html><html><body><div id="fixture"></div><script type="module" src="/layout-checks/batch-entry-fixture.jsx"></script></body></html>');
const buildOptions={outDir:'layout-checks/batch-handoff-build',rolldownOptions:{input:'layout-checks/batch-entry.html'}};
await build({configFile:false,plugins:[react()],build:buildOptions,logLevel:'error'});
const server=await preview({configFile:false,build:buildOptions,preview:{host:'127.0.0.1',port:0},logLevel:'error'});
const browser=await chromium.launch({headless:true});
try{
 for(const order of ['options-last','batches-last'])for(const action of ['Manual','Scan','Upload']){
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)});
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/layout-checks/batch-entry.html?order='+order);
  const setup=page.getByRole('dialog',{name:'Batch options'});
  await setup.getByRole('button',{name:'Close',exact:true}).click();
  const row=page.locator('tr').filter({hasText:'Dudhichua test batch'});
  assert.match(await row.innerText(),/121/);
  await row.getByRole('button',{name:'View report',exact:true}).click();
  // The simplified toolbar keeps entry navigation under Batch permissions.
  // Exercise those real controls, then choose Scan/Upload in the scanner itself.
  await page.locator('.vlb-batch-governance').getByRole('button',{name:action==='Manual'?'Manual entry':'Scan / Upload files',exact:true}).click();
  if(action!=='Manual')await page.locator('.scan-workflow-tabs').getByRole('button',{name:action==='Scan'?'Scan':'Upload files',exact:true}).click();
  const site=page.locator('.vlb-entry-batch-picker select');
  await page.waitForFunction(()=>document.querySelector('.vlb-entry-batch-picker select')?.value==='Dudhichua OC');
  assert.equal(await site.inputValue(),'Dudhichua OC');
  await page.getByRole('dialog',{name:'Select batch',exact:true}).waitFor({state:'hidden'});
  if(action==='Manual'){
   await page.locator('#logbook-entry-form').waitFor({state:'visible'});
   await page.waitForFunction(()=>[...document.querySelectorAll('#logbook-entry-form input')].some(input=>['01-11-2026','2026-11-01','01/11/2026'].includes(input.value)));
  }else{
   await page.locator(action==='Scan'?'.scan-scanner-card':'.scan-upload-panel').waitFor({state:'visible'});
   assert.equal(await page.locator('.scan-workflow-tabs').getByRole('button',{name:action==='Scan'?'Scan':'Upload files',exact:true}).getAttribute('aria-pressed'),'true');
   assert.equal(await page.getByLabel('Card date',{exact:true}).inputValue(),'2026-11-01');
   const total=page.getByRole('status',{name:'Total cards in this batch'});
   await total.getByText('121',{exact:true}).waitFor();
   assert.match(await total.innerText(),/Manual: 2.*Scan\/PDF: 119/);
   if(order==='options-last'&&action==='Scan'){
    await page.evaluate(()=>{window.batchCounts={...window.batchCounts,entry_count:119,manual_count:0}});
    await total.getByText('119',{exact:true}).waitFor({timeout:10000});
   }
  }
  const requests=await page.evaluate(()=>window.requests);
  assert.ok(requests.some(r=>r.path==='/api/vlb-batches/selected-batch'));
  assert.ok(!requests.some(r=>r.path==='/api/vlb-batches/different-batch'),'Do not open another site batch');
  assert.ok(requests.every(r=>r.method==='GET'),'Navigation must not save or mutate records');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('vlb-entry-handoff:handoff-test')),null,'Handoff is consumed once');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'layout-checks/batch-handoff-'+action.toLowerCase()+'-'+order+'.png',fullPage:true});
  await page.close();
  console.log('Verified report -> '+action+' with '+order+': selected batch and real entry UI restored.');
 }
}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve))}
