import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {topBarBottom} from '../src/top-bar-stick.js';

const css=readFileSync(new URL('../src/report-step-sticky.css',import.meta.url),'utf8');
const jsx=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');

test('every report step heading stays under the top bar on a computer screen, not on a phone or a print',()=>{
 const wide=css.slice(css.indexOf('@media (min-width: 761px)'),css.indexOf('@media print'));
 assert.match(wide,/\.generated-report-section\[data-step-look\] > \.reports-section-heading \{[^}]*position: sticky;[^}]*top: var\(--mis-top-stick, 0px\);/);
 assert.match(wide,/\.generated-report-section\[data-step-look\] \{ overflow: visible; \}/);
 assert.match(css,/@media print \{[^}]*position: static;/);
 assert.doesNotMatch(css.slice(0,css.indexOf('@media (min-width: 761px)')),/position: sticky/,'outside the computer-screen rule nothing is pinned');
});

test('a step heading is bold and easy to pick out, by day and at night',()=>{
 assert.match(css,/\[data-step-look\] > \.reports-section-heading \{[^}]*border-left: 5px solid var\(--report-accent, #56309a\);/);
 assert.match(css,/\[data-step-look\] > \.reports-section-heading p \{ color: #2d3b52; font-size: 11px; font-weight: 700; \}/);
 assert.match(css,/\[data-step-look\] > \.reports-section-heading h2 \{ color: #14223b; font-weight: 800; \}/);
 assert.match(css,/:root\[data-theme="dark"\] \.generated-report-section\[data-step-look\] > \.reports-section-heading p \{ color: #d5deeb; \}/);
});

test('a dashboard Sr No tab no longer scrolls sideways on its own, so its step headings can stay in view',()=>{
 assert.match(css,/\.lb-reports > \.lb-sr:not\(\[hidden\]\) > section \{ overflow-x: visible; \}/);
 assert.match(css,/\.production-reports\.batch-status-report \{ grid-template-columns: minmax\(0, 1fr\); \}/);
 const dash=readFileSync(new URL('../src/log-book-dashboard.css',import.meta.url),'utf8');
 assert.match(dash,/\.lb-reports>\.lb-sr>section\{[^}]*overflow-x:auto\}/,'the rule it outranks is still the one written there');
});

test('the top bar is measured once for every step heading',()=>{
 assert.match(jsx,/import "\.\/report-step-sticky\.css";/);
 assert.match(jsx,/const topBarRef=useTopBarStick\(\);/);
 assert.match(jsx,/<div className="top" ref=\{topBarRef\}>/);
 const view=pos=>({getComputedStyle:()=>({position:pos,top:'0px'})});
 const bar={getBoundingClientRect:()=>({height:63.4})};
 assert.equal(topBarBottom(bar,view('sticky')),64,'a pinned bar: headings sit just under it');
 assert.equal(topBarBottom(bar,view('static')),0,'a bar that scrolls away: headings stick at the very top');
 assert.equal(topBarBottom(null,view('sticky')),0);
});

test('a step table that fits keeps its column headings under the step heading with the page; a wider one keeps every line and slides its heading row down',async()=>{
 const {placeStepTableHeads,shiftStepTableHeads,STEP_TABLE_BOXES}=await import('../src/step-table-heads.js');
 assert.ok(STEP_TABLE_BOXES.split(', ').includes('.mp-category'),'OT site summaries participate in scroll-container measurement');
 const wide=css.slice(css.indexOf('@media (min-width: 761px)'),css.indexOf('[data-printing]'));
 assert.match(wide,/:is\(\.reports-detail-table, \.ar-grid-wrap, \.report-totals-scroll, \.mp-category\)\[data-head-fits\] \{ max-height: none; overflow: visible; \}/);
 assert.match(wide,/table\[data-head="page"\] > thead th \{[^}]*position: sticky;[^}]*top: calc\(var\(--mis-top-stick, 0px\) \+ var\(--step-head, 0px\)\);/);
 assert.match(wide,/table\[data-head="shift"\] > thead th \{[^}]*transform: translateY\(var\(--head-shift, 0px\)\);/);
 assert.doesNotMatch(css,/max-height: max\(/,'no step table is put in a box of its own: every line stays on the page');
 assert.match(css,/\[data-printing\] \.generated-report-section\[data-step-look\] table\[data-head\] > thead th \{ top: 0; transform: none; \}/,'the dashboard PDF draws each heading row where it is written');

 // A small stand-in page: a step with a heading, a table that fits, a wide table and a table of a step inside it.
 const el=(props={})=>{const attrs=new Map(),style=new Map();return Object.assign({parentElement:null,getAttribute:a=>attrs.has(a)?attrs.get(a):null,hasAttribute:a=>attrs.has(a),setAttribute:(a,v)=>attrs.set(a,v),removeAttribute:a=>attrs.delete(a),style:{setProperty:(k,v)=>style.set(k,v),getPropertyValue:k=>style.get(k)||''},matches:()=>false,closest:()=>null,attrs,styles:style},props);};
 const section=el();const head=el({getBoundingClientRect:()=>({height:88.4,bottom:153})});
 section.querySelector=()=>head;
 const box=(w,cw,ow)=>el({scrollWidth:w,clientWidth:cw,offsetWidth:ow,scrollHeight:500,clientHeight:500,matches:()=>true,parentElement:section});
 const fitsBox=box(900,900,902),wideBox=box(1400,900,902),tallFitsBox=box(898,885,902);
 const table=(parent,top=0,height=0)=>el({tHead:{getBoundingClientRect:()=>({height:40})},tFoot:null,parentElement:parent,closest:()=>section,getBoundingClientRect:()=>({top,height})});
 const fitsTable=table(fitsBox),wideTable=table(wideBox,-300,1000),tallTable=table(tallFitsBox),inner=el({tHead:{},closest:()=>({})});
 for(const b of [fitsBox,wideBox,tallFitsBox])b.closest=()=>b;
 section.querySelectorAll=()=>[fitsTable,wideTable,tallTable,inner];
 globalThis.getComputedStyle=()=>({borderLeftWidth:'1px',borderRightWidth:'1px',overflowY:'auto'});
 placeStepTableHeads(section);
 assert.equal(section.styles.get('--step-head'),'89px');
 assert.equal(fitsTable.getAttribute('data-head'),'page');
 assert.equal(fitsBox.getAttribute('data-head-fits'),'');
 assert.equal(wideTable.getAttribute('data-head'),'shift');
 assert.equal(wideBox.getAttribute('data-head-fits'),null);
 assert.equal(tallTable.getAttribute('data-head'),'page','the room of an upright scroll bar counts, so a table that fits is not held in its box');
 assert.equal(inner.getAttribute('data-head'),null,'a table of a step inside this one is left to that step');
 shiftStepTableHeads(section);
 assert.equal(wideTable.styles.get('--head-shift'),'453px','the heading row of the wide table sits under the step heading (153 px from the top of the screen)');
 wideTable.getBoundingClientRect=()=>({top:-1000,height:1000});shiftStepTableHeads(section);
 assert.equal(wideTable.styles.get('--head-shift'),'960px','it stops at the last line of the table');
 wideTable.getBoundingClientRect=()=>({top:400,height:1000});shiftStepTableHeads(section);
 assert.equal(wideTable.styles.get('--head-shift'),'0px','before the table reaches the top it stays where it is written');
 delete globalThis.getComputedStyle;
});

test('every step section is measured, and an opened step still scrolls into view',()=>{
 assert.match(jsx,/import \{ useStepTableHeads \} from "\.\/step-table-heads\.js";/);
 assert.match(jsx,/const stepRef = useStepTableHeads\(stepLook, laterStep \? showOpenedStep : null\);/);
 assert.match(jsx,/<div ref=\{stepLook \? stepRef : undefined\} className="reports-section generated-report-section"/);
});
