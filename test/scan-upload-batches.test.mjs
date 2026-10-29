import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('each file selection creates its own batch instead of appending to the previously viewed batch',async()=>{
 const src=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 const start=src.indexOf('const upload=async event=>'),end=src.indexOf('\n const update=',start);assert.ok(start>=0&&end>start);
 const memberships=new Map(),urls=[],created=[],reviewVisits=[];const activeRef={current:'earlier-batch'};const noop=()=>{};
 const scope={dirty:false,kind:'vehicle',reviewPage:true,navigateReview:open=>reviewVisits.push(open),pagesPerCard:1,activeRef,uploadingRef:{current:false},uploadController:{current:null},uploadStarted:{current:0},selectedRevision:{current:null},
  window:{location:{href:'https://pulse-ll.cmll.in/?page=trip-scan&batch=earlier-batch&card=old-card'},history:{replaceState:(a,b,url)=>urls.push(url)}},
  api:async(url,config)=>{if(url==='/api/scan-batches'){const id='new-batch-'+(created.length+1);created.push(id);memberships.set(id,[]);return {id};}const id=url.split('/')[3];memberships.get(id).push(JSON.parse(config.body));return {};},
  pages:async function*(){yield {blob:{},name:'page 1'};yield {blob:{},name:'page 2'};},png:async()=>'image',load:async()=>{},list:async()=>{},
  setWorkflowTab:noop,setBusy:noop,setUploading:noop,setUploadElapsed:noop,setUploadedCount:noop,setError:noop,setNotice:noop,setCards:noop,setSelected:noop,setBatch:noop,setGroupFilter:noop,setFilter:noop,setArchiveResult:noop,setResults:noop,setProgress:noop};
 const upload=new Function(...Object.keys(scope),src.slice(start,end)+';return upload;')(...Object.values(scope));
 for(let i=0;i<2;i++)await upload({target:{files:[{name:'Trip cards.pdf',size:1000}],value:'Trip cards.pdf'}});
 assert.deepEqual(reviewVisits,[false,false],'uploads leave the review page for the status overview');
 assert.deepEqual(created,['new-batch-1','new-batch-2']);assert.equal(memberships.get('new-batch-1').length,2);assert.equal(memberships.get('new-batch-2').length,2);assert.equal(memberships.has('earlier-batch'),false);
 assert.ok(urls[0].includes('batch=new-batch-1'));assert.ok(urls[1].includes('batch=new-batch-2'));assert.ok(urls.every(url=>!url.includes('card=')));
});
test('PDF uploads expose elapsed timing and a real abort controller',()=>{
 const src=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 assert.match(src,/className="scan-upload-timer" role="timer"/);
 assert.match(src,/Trip cards uploaded: \{uploadedCount\}/);
 assert.match(src,/\(uploading\|\|pending\.length>0\).*className="scan-abort" onClick=\{abortUpload\}>Abort/);
 assert.match(src,/signal:controller\.signal/);
 assert.match(src,/e\.name==='AbortError'/);
 const server=readFileSync(new URL('../bulk-card-scanning.mjs',import.meta.url),'utf8');
 assert.match(server,/\/api\/scan-batches\/:id\/abort/);
 assert.match(server,/status IN\('queued','reading'\)/);
});
test('MIS header clock is kept on one line',()=>{
 const css=readFileSync(new URL('../src/erp-layout.css',import.meta.url),'utf8');
 assert.match(css,/\.top>\.header-clock\{[^}]*flex-wrap:nowrap;white-space:nowrap/);
 assert.match(css,/grid-template-columns:auto minmax\(240px,1fr\) auto auto;grid-template-rows:auto/);
 assert.match(css,/\.top>\.header-clock\{[^}]*grid-column:3;grid-row:1/);
 assert.match(css,/min-height:64px;padding:8px 20px/);
});
test('MIS sidebar uses larger navigation labels',()=>{
 const css=readFileSync(new URL('../src/erp-layout.css',import.meta.url),'utf8');
 assert.match(css,/#admin-primary-navigation \.erp-group-toggle\{font-size:12px\}/);
 assert.match(css,/#admin-primary-navigation \.erp-page[^}]*font-size:14px/);
 assert.match(css,/#admin-primary-navigation \.erp-brand-copy strong\{font-size:19px\}/);
});
