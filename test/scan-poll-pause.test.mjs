import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SCAN_PROGRESS_ACTIVE_MS,SCAN_PROGRESS_IDLE_MS,VLB_CARD_COUNT_POLL_MS,scanProgressActive,shouldReadScanProgress} from '../shared/scan-progress-poll.mjs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/\r\n/g,'\n');

test('the entry is read every 4 s only while the server is still changing it',()=>{
 assert.equal(SCAN_PROGRESS_ACTIVE_MS,4000);
 assert.equal(SCAN_PROGRESS_IDLE_MS,15000);
 assert.equal(VLB_CARD_COUNT_POLL_MS,15000);
 assert.equal(scanProgressActive([{status:'posted'},{status:'review'}]),false);
 assert.equal(scanProgressActive([{status:'posted'},{status:'queued'}]),true);
 assert.equal(scanProgressActive([{status:'reading'}]),true);
 assert.equal(scanProgressActive([{status:'review',validationPending:true}]),true,'a pending Pulse equipment check keeps the fast read');
 assert.equal(scanProgressActive([],{uploading:true}),true);
 assert.equal(scanProgressActive(null),false);
});

test('an idle entry is read at most every 15 s',()=>{
 assert.equal(shouldReadScanProgress({active:true,lastReadAt:1000,now:1001}),true);
 assert.equal(shouldReadScanProgress({active:false,lastReadAt:0,now:1000}),false);
 assert.equal(shouldReadScanProgress({active:false,lastReadAt:1000,now:15999}),false);
 assert.equal(shouldReadScanProgress({active:false,lastReadAt:1000,now:16000}),true);
});

test('the scan screen polls through the visible-tab helper, not fixed timers',()=>{
 const screen=source('src/bulk-card-scanning.jsx');
 assert.doesNotMatch(screen,/setInterval\(/,'no poll on the scan screen runs on a fixed timer');
 assert.match(screen,/startVisiblePoll\(refresh,VLB_CARD_COUNT_POLL_MS\)/);
 assert.match(screen,/startVisiblePoll\(refresh,SCAN_PROGRESS_ACTIVE_MS\)/);
 // Automatic saving depends on seeing cards finish reading, so a hidden tab keeps reading while work is running.
 assert.match(screen,/const progressWorking=\(\)=>scanProgressActive\(cardsView\.current\.cards,\{uploading:uploadingRef\.current\}\)/);
 assert.match(screen,/SCAN_PROGRESS_ACTIVE_MS,\{keepPolling:progressWorking\}\)/);
 assert.match(screen,/return load\(activeRef\.current,false,retryPending\)\.catch\(e=>setConnectionError\(e\.message\)\)/);
});

test('the scanner panel, batch report and user sessions stop asking in a hidden tab',()=>{
 assert.match(source('src/local-scanner-panel.jsx'),/return startVisiblePoll\(refresh,5000\)\},\[token,disabled\]\)/);
 const report=source('src/scan-batch-reports.jsx');
 assert.match(report,/const stopPoll=startVisiblePoll\(load,5000\)/,'the report keeps the 5 s its manual describes');
 assert.match(report,/return\(\)=>\{controller\.abort\(\);stopPoll\(\)\}/);
 assert.doesNotMatch(report,/setInterval\(/);
 const main=source('src/main.jsx');
 assert.match(main,/return startVisiblePoll\(\(\)=>\{const quiet=!first;first=false;return load\(\{quiet\}\);\},3000\)/);
 assert.doesNotMatch(main,/setInterval\(\(\)=>load\(\{quiet:true\}\),3000\)/);
});
