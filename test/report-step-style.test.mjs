// Owner's rule, 15 Nov 2026: every report is drawn like the OT Multiple Duties Step 1 / Step 2 / Step 3 tables, and a
// drill-down keeps its steps one below the other. Only the drawing changes; the rows and columns stay as they are.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('every report step uses the step look: the stylesheet is loaded and report tables carry no Sr. No. column',()=>{
 const main=read('src/main.jsx');
 assert.match(main,/import "\.\/report-step-style\.css";/);
 const section=main.slice(main.indexOf('function ReportSection('),main.indexOf('function withStageGapHighlights('));
 assert.match(section,/<ReportTable[\s\S]*serialColumn=\{false\}/,'report steps leave out the Sr. No. column, as the OT steps do');
 const table=main.slice(main.indexOf('function ReportTable('),main.indexOf('function parseCsv('));
 assert.match(table,/serialColumn = true/,'other tables keep their Sr. No.');
 assert.match(table,/report-figure-cell/,'figures sit on the right');
 const css=read('src/report-step-style.css');
 for(const rule of ['.reports-detail-table','max-height: none','report-figure-cell','border-radius: 8px','report-row-picked','.tt-total'])assert.ok(css.includes(rule),rule);
});

test('a step that opens below the screen is brought into view',()=>{
 const main=read('src/main.jsx');
 const section=main.slice(main.indexOf('function ReportSection('),main.indexOf('function withStageGapHighlights('));
 assert.match(section,/\/\^Step \(\\d\+\)\/[^\n]*> 1;/);
 assert.match(section,/ref=\{laterStep \? showOpenedStep : undefined\}/);
 const show=main.slice(main.indexOf('function showOpenedStep('),main.indexOf('function ReportSection('));
 assert.match(show,/scrollIntoView\(\{ block: "start" \}\)/,'no smooth scrolling: the app has no motion');
});

test('the drill-down reports keep every step on screen, one below the other',()=>{
 for(const file of ['src/trip-timing-report.jsx','src/loading-machine-report.jsx','src/batch-status-report.jsx']){
  const screen=read(file);
  assert.doesNotMatch(screen,/level===[1-5]&&/,file+' must not replace one step with the next');
  assert.match(screen,/level>=2&&/,file);
  assert.match(screen,/report-row-picked/,file+' marks the line that opened the step below');
 }
});
