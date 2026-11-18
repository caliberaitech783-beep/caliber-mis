import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {acronymOf, highlightRanges, searchMenu} from '../src/erp-menu-search.mjs';

const pages=[
  {label:'Dashboard',path:[]},
  {label:'Fleet reconciliation',path:[]},
  {label:'Login Details',path:['Masters']},
  {label:'Equipment master',path:['Masters']},
  {label:'Create Batch',path:['MIS']},
  {label:'Vehicle Log Book (VLB)',path:['MIS']},
  {label:'LMV Log Book (LMV)',path:['MIS']},
  {label:'Equipment Log Book (ELB)',path:['MIS']},
  {label:'VLB Reports',path:['Reports']},
  {label:'Overtime by Category',path:['Reports','Manpower & OT']},
  {label:'Breakdown Ageing',path:['Reports','Breakdown']},
  {label:'Deletion',path:[]},
];
const labels=query=>searchMenu(query,pages).map(page=>page.label);

test('menu smart search finds pages the way Pulse 1 search does: any word order, brackets and case ignored',()=>{
  assert.deepEqual(labels('book log vehicle'),['Vehicle Log Book (VLB)']);
  assert.equal(labels('LMVLOG')[0],'LMV Log Book (LMV)','joined words still match');
  assert.deepEqual(labels(''),[]);
});

test('short forms and initials reach the right page first',()=>{
  assert.equal(labels('vlb')[0],'Vehicle Log Book (VLB)');
  assert.ok(labels('vlb').includes('VLB Reports'));
  assert.equal(labels('elb')[0],'Equipment Log Book (ELB)');
  assert.equal(labels('cb')[0],'Create Batch','initials');
  assert.ok(labels('ot').includes('Overtime by Category'),'OT = overtime');
  assert.ok(labels('bd').includes('Breakdown Ageing'),'BD = breakdown');
});

test('a tab name lists the pages under it, and a page name beats a path match',()=>{
  assert.deepEqual(labels('masters'),['Equipment master','Login Details']);
  assert.equal(labels('equipment')[0],'Equipment master');
});

test('letters typed in order are the last resort for misspellings',()=>{
  const result=searchMenu('crtbtch',pages);
  assert.equal(result[0].label,'Create Batch');
  assert.equal(result[0].loose,true);
  assert.deepEqual(labels('zzzz'),[]);
});

test('typed words are highlighted in the page name',()=>{
  assert.deepEqual(highlightRanges('Vehicle Log Book (VLB)','log vlb'),[[8,11],[18,21]]);
  assert.equal(acronymOf('Vehicle Log Book (VLB)'),'vlb','bracketed short form is not part of the initials');
});

test('sidebar keeps one straight left edge with gold tabs and white pages',()=>{
  const css=readFileSync(new URL('../src/erp-sidebar.css',import.meta.url),'utf8');
  const jsx=readFileSync(new URL('../src/erp-sidebar.jsx',import.meta.url),'utf8');
  assert.match(css,/\.erp-submenus,#admin-primary-navigation \.erp-nested-menu>\.erp-submenus\{margin:0!important;padding:0!important;border:0!important/,'no indented sub-tabs');
  assert.match(css,/\.erp-group-toggle\{color:var\(--nav-tab\)!important/,'tabs use the tab colour');
  assert.match(css,/\.erp-page,\s*\.app\.erp-shell>#admin-primary-navigation nav>button\[data-nav="announcements"\]\{color:var\(--nav-sub\)!important/,'pages use the sub-tab colour');
  assert.match(jsx,/import '\.\/erp-sidebar\.css';/);
  assert.match(jsx,/aria-label="Search menu"/,'main.jsx keeps the auto-hide menu open while this box has focus');
  assert.match(jsx,/event\.ctrlKey\|\|event\.metaKey/,'Ctrl+K opens the search');
});

test('typing chart finds the Loading Equipment-wise Report (Chart)',async()=>{
  const {operationReports}=await import('../src/operations-report-model.mjs');
  const entries=operationReports.map(r=>({label:r.title,path:['Reports',r.group]}));
  const found=searchMenu('chart',entries).map(entry=>entry.label);
  assert.equal(found[0],'Loading Equipment-wise Report (Chart)');
  assert.ok(searchMenu('loading chart',entries).some(entry=>entry.label==='Loading Equipment-wise Report (Chart)'));
});
