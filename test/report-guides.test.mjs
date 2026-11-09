import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {existsSync,openSync,readSync,closeSync,statSync,readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {transformWithOxc} from 'vite';
import {renderToStaticMarkup} from 'react-dom/server';
import {REPORT_GUIDE_IDS,reportGuide} from '../src/report-guide-list.mjs';

const file=name=>new URL('../public/guides/'+name,import.meta.url);
test('every listed report manual is present in English and Hindi as a real PDF',()=>{
 assert.ok(REPORT_GUIDE_IDS.length>0);assert.equal(new Set(REPORT_GUIDE_IDS).size,REPORT_GUIDE_IDS.length,'no id is listed twice');
 for(const id of REPORT_GUIDE_IDS)for(const lang of ['en','hi']){
  const url=file(id+'-'+lang+'.pdf');assert.ok(existsSync(url),id+'-'+lang+'.pdf is missing; run node scripts/report-guides/build.mjs '+id);
  const head=Buffer.alloc(5),handle=openSync(url,'r');readSync(handle,head,0,5,0);closeSync(handle);
  assert.equal(head.toString('latin1'),'%PDF-',id+'-'+lang+'.pdf is not a PDF');assert.ok(statSync(url).size>20000,id+'-'+lang+'.pdf looks empty');
 }
});
// Owner's rule: a manual must change whenever its report tab changes. The build records which version of the
// tab's code and text each manual came from; this fails as soon as either has moved on without a rebuild.
test('no report manual is older than its report tab or its own text',async()=>{
 const {fingerprint,guideSources}=await import('../scripts/report-guides/sources.mjs');
 const root=fileURLToPath(new URL('..',import.meta.url)),manifest=JSON.parse(readFileSync(new URL('../scripts/report-guides/manifest.json',import.meta.url),'utf8'));
 const old=REPORT_GUIDE_IDS.filter(id=>manifest[id]!==fingerprint(root,id));
 assert.deepEqual(old,[],'The operating manual of these report tabs is out of date: '+old.join(', ')+'. A tab or its manual text changed after the PDF was built. '
  +'Update the manual text in both languages where the screen changed ('+[...new Set(old.flatMap(id=>guideSources(id).filter(file=>file.startsWith('scripts/'))))].join(', ')+'), '
  +'then run: npm run build && node scripts/report-guides/build.mjs --stale   and commit public/guides and scripts/report-guides/manifest.json. See AGENTS.md.');
 assert.deepEqual(Object.keys(manifest).filter(id=>!REPORT_GUIDE_IDS.includes(id)),[],'manifest.json lists a manual that is not in src/report-guide-list.mjs');
});
test('a report tab gets its own two manual addresses; an unknown tab gets none',()=>{
 assert.deepEqual(reportGuide('ot'),{en:'/guides/ot-en.pdf',hi:'/guides/ot-hi.pdf'});
 assert.equal(reportGuide('not-a-report'),null);assert.equal(reportGuide(undefined),null);
});
test('the manual bar offers both downloads and stays off screens without a manual',async()=>{
 const source=readFileSync(new URL('../src/report-guide.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
 const {code}=await transformWithOxc(source,'report-guide.jsx',{jsx:{runtime:'classic'}});
 const ReportGuide=new Function('React','reportGuide',code+';return ReportGuide')(React,reportGuide);
 const html=renderToStaticMarkup(React.createElement(ReportGuide,{id:'ot'}));
 assert.match(html,/href="\/guides\/ot-en\.pdf" download=""/);assert.match(html,/href="\/guides\/ot-hi\.pdf" download=""/);assert.match(html,/Operating manual/);
 assert.equal(renderToStaticMarkup(React.createElement(ReportGuide,{id:'not-a-report'})),'');
});
test('the manual bar sits above the operations report tabs and the VLB and ELB report pages',()=>{
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/import ReportGuide from '\.\/report-guide\.jsx'/);
 assert.match(main,/<ReportGuide id=\{String\(props\.activeReportCategory\)\.replace\(\/\^operations-\/, ''\)\} \/><OperationsReports /);
 assert.match(main,/<ReportGuide id="vlb-reports"\/><VlbBatchReports /);assert.match(main,/<ReportGuide id="elb-reports"\/><ElbBatchReports /);
});
test('manual content files carry the same sections in both languages',()=>{
 const dir=new URL('../scripts/report-guides/content/',import.meta.url);
 for(const name of readdirSync(dir).filter(n=>n.endsWith('.json'))){
  const content=JSON.parse(readFileSync(new URL(name,dir),'utf8'));assert.equal(content.id+'.json',name);assert.ok(content.title&&content.group&&content.menu,name);
  for(const key of ['filters','screen','columns','notes','checklist','faq']){assert.ok(Array.isArray(content.en[key])&&Array.isArray(content.hi[key]),name+' '+key);assert.equal(content.hi[key].length,content.en[key].length,name+' '+key+': Hindi and English differ in length');}
  for(const lang of ['en','hi'])assert.ok(content[lang].purpose&&content[lang].row,name+' '+lang);
 }
});
