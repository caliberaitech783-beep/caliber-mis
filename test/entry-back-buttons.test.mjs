import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=file=>readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/\r\n/g,'\n');

test('VLB, ELB and LMV entry: the batch picker shows Back, and every entry page passes where it goes',()=>{
  const batch=read('vlb-create-batch.jsx'),main=read('main.jsx');
  assert.match(batch,/if\(entryMode\)return <section className="logbook-page vlb-create-batch vlb-entry-batch-picker">\{onExit&&<StepBackButton onBack=\{onExit\} label=\{entryKind==="lmv"\?"Back to LMV":entryKind==="equipment"\?"Back to ELB":"Back to VLB"\}\/>\}/,'picker returns before the header, so it carries its own Back');
  assert.match(batch,/\{!entryMode&&<StepBackButton onBack=\{clearView\} label="Back to batch list"\/>\}/,'an opened batch goes back to the list');
  assert.match(main,/key="lmv-manual" kind="lmv" mode="manual" session=\{session\} ReportSection=\{ReportSection\} onExit=\{\(\)=>selectMenu\('LMV Log Book'\)\}/);
  assert.match(main,/key="lmv-scan" kind="lmv" mode="scan" session=\{session\} ReportSection=\{ReportSection\} onExit=\{\(\)=>selectMenu\('LMV Log Book'\)\}/);
  assert.match(main,/<VlbCreateBatch onExit=\{canGoBack\?goBack:undefined\}/);
  assert.match(read('elb-batch-manual.jsx'),/<StepBackButton onBack=\{onExit\} label="Change batch"\/>/);
});

test('screens that open a sub-view show Back or let the top-bar arrow take the same step',()=>{
  const main=read('main.jsx');
  assert.match(main,/startsWith\('operations-'\)\) return <><StepBackButton onBack=\{\(\)=>props\.setActiveReportCategory\?\.\('general'\)\} label="Back to reports"/);
  assert.match(main,/<StepBackButton onBack=\{\(\)=>\{setBreakdownFleetFilter\(""\);setBreakdownFleetSites\(\[\]\);\}\} label="Back to all breakdowns"/);
  assert.match(read('log-book-deletion.jsx'),/aria-label="Exact deletion approval"><StepBackButton onBack=\{busy\?null:reset\} disabled=\{busy\} label="Back to selection"\/>/,'Back at the top of the review, not only at the bottom');
  assert.match(read('employee-master.jsx'),/<StepBackButton onBack=\{\(\)=>\{setSelected\(null\);setDraft\(null\)\}\} label="Back to list"\/>/);
  assert.match(read('bulk-card-scanning.jsx'),/useStepBackTarget\(reviewPage&&!busy\?backFromReview:null\);/);
  assert.match(read('hourly-breakdown-view.jsx'),/useStepBackTarget\(onBack\);/);
  const accounts=read('iboss-accounts.jsx');
  assert.ok(accounts.indexOf("useStepBackTarget(view?")<accounts.indexOf('if(!visibleSections.length)return'),'hook runs before the early return');
});

test('the step registry is a plain module and the innermost step is taken first',async()=>{
  const registry=read('step-back-registry.mjs');
  assert.doesNotMatch(registry,/<[A-Za-z]/,'no JSX, so Node tests can import screens that use it');
  assert.match(registry,/const latest=\(\)=>steps\.at\(-1\)\|\|null;/);
  assert.match(registry,/if\(!active\)return undefined;/,'a screen with no step registers nothing');
});
