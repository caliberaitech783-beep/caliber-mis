import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BANDS} from '../shared/loading-machine-report.mjs';

// Owner, 16 Nov 2026: after Trip Timing, the reports with a scale of colours take the same solid boxes with white figures.
const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
const solid=(css,selector,fill)=>assert.match(css,new RegExp(selector.replace(/[.]/g,'\\.')+'\\{background:'+fill+';border-color:#[0-9a-f]{6};color:#fff\\}'),selector+' is solid '+fill);

test('Loading Equipment idle bands are solid blue, orange, red and dark red, with up to 5 minutes still pale green',()=>{
 const css=read('../src/loading-machine-report.css');
 solid(css,'.lm-report .lm-b1','#2f6fd0');
 solid(css,'.lm-report .lm-b2','#d46a00');
 solid(css,'.lm-report .lm-b3','#c92c2c');
 solid(css,'.lm-report .lm-b4','#8f1d1d');
 assert.match(css,/\.lm-report \.lm-ok\{background:#d6f0dd;color:#17602b\}/);
 for(const [band,fill] of [['b1','#2f6fd0'],['b2','#d46a00'],['b3','#c92c2c'],['b4','#8f1d1d']])
  assert.match(css,new RegExp('\\.tt-chips button\\.lm-'+band+'\\{background:'+fill+';color:#fff'),'the chip of '+band+' carries its box colour');
 // The heading above the boxes writes the minutes in the box colour, never white on nothing.
 assert.match(css,/\.lm-report \.dsg-ranged thead :is\(\.tt-band,\.lm-count\)\{background:none;border-color:transparent\}/);
 for(const band of ['b1','b2','b3','b4'])assert.match(css,new RegExp('\\.dsg-ranged thead \\.lm-'+band+'\\{color:#[0-9a-f]{6}\\}'));
});

test('Loading Equipment Step 2 writes the minutes of every band inside and above its box',()=>{
 const screen=read('../src/loading-machine-report.jsx');
 const bandRange=b=>b.upTo===Infinity?b.above+'+ min':b.above+'–'+b.upTo+' min';
 assert.deepEqual(BANDS.map(bandRange),['5–10 min','10–15 min','15–20 min','20+ min']);
 assert.ok(screen.includes("export const bandRange=b=>b.upTo===Infinity?b.above+'+ min':b.above+'–'+b.upTo+' min';"));
 // The four bands keep their places under the minutes; In BD and No hours follow them, named inside the box only, so a
 // shift stays narrow enough for the table to fit the screen.
 assert.ok(screen.includes("const gridBoxes=[...BANDS.map(b=>({key:b.key,label:'Idle '+b.label,range:bandRange(b),className:'tt-band lm-'+b.key})),{key:'breakdown',label:STATES.breakdown,note:'In BD',className:'lm-count lm-breakdown'},{key:'nohours',label:STATES.nohours,note:'No hours',className:'lm-count lm-nohours'}]"));
 const grid=read('../src/date-shift-grid.jsx');
 assert.ok(grid.includes('const gap=b=>ranged&&b.range?'),'a box with only a note keeps no empty place');
 assert.ok(grid.includes('{boxes.filter(b=>b.range).map(b=><span key={b.key} className={\'dsg-box dsg-range \'+b.className}'),'and no heading');
 // The chips of the loading list no longer call the bands orange and red: they are blue, orange, red and dark red now.
 assert.doesNotMatch(screen,/'Red · ':'Orange · '/);
});

test('Manpower duty colours are solid red, orange, brown and blue, and a pressed one keeps a visible ring',()=>{
 const css=read('../src/manpower-reports.css');
 solid(css,'.mp-flag-red','#c92c2c');
 solid(css,'.mp-flag-orange','#d46a00');
 solid(css,'.mp-flag-review','#6e3f14');
 solid(css,'.mp-flag-zero','#2f6fd0');
 assert.match(css,/\.mp-cat-count\[class\*="mp-flag-"\]\[aria-pressed=true\]\{border-color:#59338b;box-shadow:/,'a white ring would vanish on the page');
 assert.match(css,/\.mp-flag-normal\{background:var\(--card,#fff\)/,'normal duty stays white');
});

test('Batch Status rating is solid green, orange and red',()=>{
 const css=read('../src/batch-status-report.css');
 solid(css,'.batch-status-report .bs-rating-good','#1f7a3d');
 solid(css,'.batch-status-report .bs-rating-average','#d46a00');
 solid(css,'.batch-status-report .bs-rating-poor','#c92c2c');
});
