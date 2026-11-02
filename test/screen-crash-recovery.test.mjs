// 2 November 2026, 17:29: a VLB scan screen crashed in the operator's browser
// on the live site, the only record of why was that browser's console, and
// after the refresh the 40-card entry could not be reopened because the VLB
// workspace strips the entry from the address and the scan page listed no
// entries. These checks keep every part of that chain closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildClientErrorReport,shouldReport,resetClientErrorReporting,installGlobalErrorReporting} from '../src/client-error-report.mjs';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('a browser error report carries the message, stacks, screen, address and UI version',()=>{
 const error=new TypeError("Cannot read properties of undefined (reading 'length')");
 const report=buildClientErrorReport(error,{componentStack:'\n at ScanPage',uiVersion:'abc1234',location:{pathname:'/',search:'?batch=b1',hash:''},document:{title:'VLB Scan'}});
 assert.equal(report.kind,'render');
 assert.match(report.message,/reading 'length'/);
 assert.match(report.stack,/TypeError/);
 assert.equal(report.componentStack,'\n at ScanPage');
 assert.equal(report.uiVersion,'abc1234');
 assert.equal(report.screen,'VLB Scan');
 assert.equal(report.url,'/?batch=b1');
 const rejection=buildClientErrorReport({reason:new Error('promise failed')},{kind:'promise',location:null,document:null});
 assert.equal(rejection.message,'promise failed');
 assert.equal(buildClientErrorReport('plain text',{location:null,document:null}).message,'plain text');
});

test('the same failure is reported once a minute and a page sends at most 25 reports',()=>{
 resetClientErrorReporting();
 const report={kind:'render',screen:'VLB Scan',message:'boom'};
 assert.ok(shouldReport(report,{now:100_000}));
 assert.equal(shouldReport(report,{now:101_000}),false,'repeat within a minute is dropped');
 assert.ok(shouldReport(report,{now:161_000}));
 assert.ok(shouldReport({...report,message:'other'},{now:101_000}));
 assert.equal(shouldReport({...report,message:'late'},{now:102_000,budget:0}),false);
 resetClientErrorReporting();
});

test('window errors and unhandled rejections are captured once per window',()=>{
 const listeners={};
 const target={addEventListener:(name,fn)=>{listeners[name]=fn}};
 assert.ok(installGlobalErrorReporting(target));
 assert.equal(installGlobalErrorReporting(target),false);
 assert.deepEqual(Object.keys(listeners).sort(),['error','unhandledrejection']);
 assert.equal(installGlobalErrorReporting(null),false);
});

test('the application error boundary reports every render failure and panels recover on their own',()=>{
 const boundary=read('src/lazy-feature.jsx');
 assert.match(boundary,/componentDidCatch\(error, info\)[\s\S]*reportClientError\(error, \{ kind: isLazyChunkFailure\(error\) \? "chunk" : "render", componentStack: info\?\.componentStack/);
 assert.match(boundary,/componentDidUpdate\(previousProps\)[\s\S]*previousProps\.resetKey !== this\.props\.resetKey/);
 assert.match(boundary,/this\.props\.onDismiss &&/);
 const main=read('src/main.jsx');
 assert.match(main,/configureClientErrorReporting\(\{ getToken: \(\) => authToken \}\)/);
 assert.match(main,/installGlobalErrorReporting\(/);
});

test('the scan page reopens the entry after a refresh, lists the entries of the VLB batch, retries card uploads through a restart and fences each panel',()=>{
 const page=read('src/bulk-card-scanning.jsx');
 assert.match(page,/chooseScanEntry\(rows,\{remembered:recallScanEntry\(localStorage,kind,vlbBatch\.id\)\}\);if\(entry\)void selectBatch\(entry\.id\)/);
 assert.match(page,/rememberScanEntry\(localStorage,kind,vlbBatch\.id,d\.batch\.id\)/);
 assert.match(page,/className="scan-entry-list" aria-label="Scan entries for this batch"/);
 assert.match(page,/if\(Array\.isArray\(d\.duplicates\)\)setDuplicates\(d\.duplicates\);if\(!Array\.isArray\(d\.cards\)\)d\.cards=\[\]/);
 assert.match(page,/uploadWithRetry\(\(\)=>api\('\/api\/scan-batches\/'\+entryId\+'\/cards'/);
 for(const panel of ['ScanEquipmentReviewDialog','ScanDuplicateList','ScanBatchReport'])assert.match(page,new RegExp('<ApplicationErrorBoundary compact[\\s\\S]{0,400}?><'+panel),panel+' is fenced');
 const workspace=read('src/vlb-entry-workspace.jsx');
 assert.match(workspace,/if\(batch\?\.id&&batch\.id===previous\)return;/,'re-selecting the same VLB batch keeps the scan entry in the address');
 const css=read('src/bulk-card-scanning.css');
 assert.match(css,/\.scan-entry-list button\[aria-pressed="true"\]/);
});
