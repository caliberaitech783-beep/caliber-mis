// Owner's rule, 15 Nov 2026: every report is drawn like the OT Multiple Duties Step 1 / Step 2 / Step 3 tables, and a
// drill-down keeps its steps one below the other. Only the drawing changes; the rows and columns stay as they are.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transformWithOxc} from 'vite';

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

// Owner's rule, 15 Nov 2026 (second note, with the sample of Step 1, Step 2 date by shift and Step 3 one below the other):
// every report step shows only its title and Smart Print, no search box, record count, Rows or Actions, and every line.
test('a report step has no search box, record count, Rows or Actions, and shows every line',()=>{
 const main=read('src/main.jsx');
 const section=main.slice(main.indexOf('function ReportSection('),main.indexOf('function withStageGapHighlights('));
 assert.match(section,/const stepLook = \/\^Step \\d\/\.test\(String\(title\)\);/);
 assert.match(section,/const searchShown = showSearch && !stepLook;/);
 assert.match(section,/stepLook=\{stepLook\}/);
 assert.match(section,/data-step-look=\{stepLook \? "true" : undefined\}/);
 const table=main.slice(main.indexOf('function ReportTable('),main.indexOf('function parseCsv('));
 assert.match(table,/\{stepLook \? null : toolbarTarget \? createPortal\(reportTableToolbar, toolbarTarget\)/,'no Rows, record count or Actions above a step');
 assert.match(table,/useState\(\(\) => stepLook \? 1000 : mobileTablePageSize\(\) \|\| 50\)/,'every line of a step on screen');
 assert.match(table,/\(!stepLook \|\| pageCount > 1\) && <div className="report-table-pagination">/);
 const css=read('src/report-step-style.css');
 for(const rule of ['[data-step-look] .report-filter-table thead th .sort-header { min-width: 0; }','.dsg-table','.dsg-cell','report-unbroken-cell'])assert.ok(css.includes(rule),rule);
});

test('Step 2 of every drill-down report is the date by shift table',()=>{
 for(const file of ['src/trip-timing-report.jsx','src/loading-machine-report.jsx','src/batch-status-report.jsx']){
  const screen=read(file);
  assert.match(screen,/from '\.\/date-shift-grid\.jsx'/,file);
  assert.match(screen,/<DateShiftGrid grid=\{shiftGrid\}/,file);
  assert.match(screen,/'Step 2 · [^\n]*' · date by shift · '/,file);
 }
});

test('the date by shift table puts the dates down the side, the shifts across and adds up each day, shift and every date',async()=>{
 const source=read('src/date-shift-grid.jsx');
 const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),'date-shift-grid.jsx',{jsx:{runtime:'classic'}});
 const {dateShiftGrid,dateShiftExport}=new Function('React',code+';return {dateShiftGrid,dateShiftExport};')({createElement:()=>null,Fragment:'f'});
 const rows=[{key:'a',date:'2026-11-05',shift:'Shift B',timed:10,b1:2},{key:'b',date:'2026-11-04',shift:'Shift A',timed:8,b1:1},{key:'c',date:'2026-11-05',shift:'Shift A',timed:6,b1:0}];
 const grid=dateShiftGrid(rows,{sumKeys:['timed','b1']});
 assert.deepEqual(grid.shifts,['Shift A','Shift B']);
 assert.deepEqual(grid.lines.map(l=>[l.label,l.sub,l.day.timed,l.day.b1]),[['04-11-26','WED',8,1],['05-11-26','THU',16,2]]);
 assert.equal(grid.lines[1].cells['Shift A'][0].key,'c');
 assert.deepEqual(grid.shiftTotals['Shift A'],{timed:14,b1:1});
 assert.deepEqual(grid.all,{timed:24,b1:3});
 const flat=dateShiftExport(grid,{count:r=>r.timed,countLabel:'trips timed',boxes:[{key:'b1',label:'15 to 20 min'}],dayColumns:[{key:'timed',label:'Day trips',value:t=>t.timed}]});
 assert.deepEqual(flat.columns.map(c=>c.label),['Date','Shift A trips timed','Shift A 15 to 20 min','Shift B trips timed','Shift B 15 to 20 min','Day trips']);
 assert.deepEqual(flat.columns.map(c=>c.value(flat.rows[0])),['04-11-26',8,1,0,0,8]);
 assert.deepEqual(flat.columns.map(c=>c.value(flat.rows.at(-1))),['All dates',14,1,10,2,24],'the printed table ends with the All dates line');
});

test('the drill-down reports keep every step on screen, one below the other',()=>{
 for(const file of ['src/trip-timing-report.jsx','src/loading-machine-report.jsx','src/batch-status-report.jsx']){
  const screen=read(file);
  assert.doesNotMatch(screen,/level===[1-5]&&/,file+' must not replace one step with the next');
  assert.match(screen,/level>=2&&/,file);
  assert.match(screen,/report-row-picked/,file+' marks the line that opened the step below');
 }
});
