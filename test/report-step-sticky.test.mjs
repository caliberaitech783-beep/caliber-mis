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
