import assert from 'node:assert/strict';
import test from 'node:test';
import {XLSX_MIME,chooseSaveTarget,saveAsAvailable,saveCancelled,saveToTarget} from '../src/save-as.mjs';

test('Export Excel asks where to save with the Save As window, offering an Excel Workbook',async()=>{
  const asked=[];
  const handle={name:'chosen name.xlsx'};
  const win={showSaveFilePicker:async options=>{asked.push(options);return handle;}};
  assert.equal(saveAsAvailable(win),true);
  assert.equal(await chooseSaveTarget('trip-timing-13-11-26.xlsx',win),handle);
  assert.deepEqual(asked,[{suggestedName:'trip-timing-13-11-26.xlsx',types:[{description:'Excel Workbook',accept:{[XLSX_MIME]:['.xlsx']}}]}]);
});

test('Cancel in the Save As window stops the export; a browser without the window downloads as before',async()=>{
  const cancel=Object.assign(new Error('The user aborted a request.'),{name:'AbortError'});
  await assert.rejects(chooseSaveTarget('report.xlsx',{showSaveFilePicker:async()=>{throw cancel;}}),error=>saveCancelled(error));
  // Phones, Firefox and Safari have no Save As window.
  assert.equal(saveAsAvailable({}),false);
  assert.equal(await chooseSaveTarget('report.xlsx',{}),null);
  // A window the browser refuses to open (inside a frame, stale click) must not lose the file either.
  const refused=Object.assign(new Error('Must be handling a user gesture'),{name:'SecurityError'});
  assert.equal(await chooseSaveTarget('report.xlsx',{showSaveFilePicker:async()=>{throw refused;}}),null);
});

test('the file is written to the chosen place, or downloaded when no place was chosen',async()=>{
  const blob={size:10},written=[],downloads=[];
  const target={name:'My report.xlsx',createWritable:async()=>({write:async data=>written.push(data),close:async()=>written.push('closed')})};
  assert.deepEqual(await saveToTarget(target,blob,'suggested.xlsx',(...args)=>downloads.push(args)),{saved:true,name:'My report.xlsx'});
  assert.deepEqual(written,[blob,'closed']);
  assert.deepEqual(downloads,[]);
  assert.deepEqual(await saveToTarget(null,blob,'suggested.xlsx',(...args)=>downloads.push(args)),{saved:false,name:'suggested.xlsx'});
  assert.deepEqual(downloads,[[blob,'suggested.xlsx']]);
});

test('a failed write is abandoned and reported, never left half written without a word',async()=>{
  const steps=[];
  const target={name:'x.xlsx',createWritable:async()=>({write:async()=>{throw new Error('Disk full');},close:async()=>steps.push('closed'),abort:async()=>steps.push('aborted')})};
  await assert.rejects(saveToTarget(target,{},'x.xlsx',()=>steps.push('downloaded')),/Disk full/);
  assert.deepEqual(steps,['aborted']);
});
