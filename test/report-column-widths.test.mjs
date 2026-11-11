import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {twoLineHeading,clampColumnWidth,cleanColumnWidths,readColumnWidths,storeColumnWidths,MIN_COLUMN_WIDTH,MAX_COLUMN_WIDTH} from '../src/report-column-widths.mjs';

const read=file=>readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/\r\n/g,'\n');

test('long headings are written on two balanced lines; short ones stay on one',()=>{
  assert.deepEqual(twoLineHeading('Drivers with a delay'),['Drivers with','a delay']);
  assert.deepEqual(twoLineHeading('Within 15 min'),['Within','15 min']);
  assert.deepEqual(twoLineHeading('Unloading → this loading (min)'),['Unloading → this','loading (min)']);
  assert.equal(twoLineHeading('Trips timed'),null,'under twelve letters');
  assert.equal(twoLineHeading('Site'),null);
  assert.equal(twoLineHeading('Availabilityhours'),null,'one word cannot break');
  assert.equal(twoLineHeading(null),null);
});

test('dragged widths are kept within limits and only for columns the table still has',()=>{
  assert.equal(clampColumnWidth(10),MIN_COLUMN_WIDTH);
  assert.equal(clampColumnWidth(5000),MAX_COLUMN_WIDTH);
  assert.equal(clampColumnWidth(140.6),141);
  assert.equal(clampColumnWidth('x'),null);
  assert.deepEqual(cleanColumnWidths({site:120,gone:200,trips:'bad'},['site','trips']),{site:120});
  assert.deepEqual(cleanColumnWidths([1,2],['site']),{});
  const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  storeColumnWidths(storage,'k',{site:150});
  assert.deepEqual(readColumnWidths(storage,'k',['site']),{site:150});
  storeColumnWidths(storage,'k',{});
  assert.equal(memory.has('k'),false,'fit again clears the saved widths');
  storage.setItem('k','not json');
  assert.deepEqual(readColumnWidths(storage,'k',['site']),{});
});

test('every report table heading fits, can be dragged, and Reset table clears the widths',()=>{
  const main=read('main.jsx');
  assert.match(main,/fitHeader\n\s+width=\{columnWidths\[column\.key\] \|\| 0\}\n\s+onResize=\{\(value\) => setColumnWidth\(column\.key, value\)\}/);
  assert.match(main,/className=\{`column-resize-handle[^`]*`\} role="separator"/);
  assert.match(main,/onDoubleClick=\{\(event\) => \{ event\.stopPropagation\(\); onResize\(null\); \}\}/);
  assert.match(main,/onReset=\{\(\) => \{ resetColumnWidths\(\);/);
});

test('drill-down reports show a Back button one step up, and the top-bar arrow takes the same step',()=>{
  const main=read('main.jsx');
  assert.match(main,/onClick=\{stepBack \|\| goBack\}/);
  assert.match(main,/label="Back to reports" className="reports-step-back" onlyWhenInnermost \/>/,'Back to reports hides while the report shows its own Back');
  assert.match(main,/\{onBack && <StepBackButton onBack=\{onBack\} label=\{backLabel\} \/>\}/);
  for(const file of ['trip-timing-report.jsx','batch-status-report.jsx']){
    const src=read(file);
    assert.match(src,/const back=level>1\?crumbs\[level-2\]\[1\]:null/,file);
    assert.match(src,/\{back&&<StepBackButton onBack=\{back\} label=\{backTo\}\/>\}/,file);
    assert.doesNotMatch(src,/onBack=\{back\} backLabel=/,'one Back per step: the step line only, not again beside Search');
  }
  assert.equal((read('manpower-reports.jsx').match(/<StepBackButton onBack=/g)||[]).length,3,'OT, manpower and reconciliation trails');
  assert.match(read('vlb-batch-card-details.jsx'),/<StepBackButton onBack=\{onClose\} label="Back to batch report"\/>/);
});
