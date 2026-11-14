import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SCAN_CARD_SIDEBAR_EVENT,announceScanCardReview,sidebarAutoHide} from '../src/scan-card-sidebar.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('an open scan card forces the sidebar into auto-hide; closing it restores the user setting',()=>{
 assert.equal(sidebarAutoHide(false,true),true);
 assert.equal(sidebarAutoHide(true,true),true);
 assert.equal(sidebarAutoHide(false,false),false);
 assert.equal(sidebarAutoHide(true,false),true);
});

test('the scan page announces an open card and its close',()=>{
 const target=new EventTarget(),seen=[];
 target.addEventListener(SCAN_CARD_SIDEBAR_EVENT,event=>seen.push(event.detail.open));
 announceScanCardReview(true,target);
 announceScanCardReview(false,target);
 assert.deepEqual(seen,[true,false]);
 assert.doesNotThrow(()=>announceScanCardReview(true,{}));
});

test('VLB, LMV and ELB card review hides the sidebar through auto-hide',()=>{
 const scan=read('../src/bulk-card-scanning.jsx');
 assert.match(scan,/const scanCardReviewOpen=Boolean\(showDetails&&card&&filtered\.some\(c=>c\.id===card\.id\)\);/);
 assert.match(scan,/announceScanCardReview\(true\);return\(\)=>announceScanCardReview\(false\);/);
 const shell=read('../src/main.jsx');
 assert.match(shell,/const sidebarAuto=sidebarAutoHide\(sidebarAutoSaved,scanCardOpen\);/);
 assert.match(shell,/window\.addEventListener\(SCAN_CARD_SIDEBAR_EVENT,onCard\)/);
});
