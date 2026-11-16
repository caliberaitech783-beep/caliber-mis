import assert from 'node:assert/strict';
import test from 'node:test';
import {XLSX_MIME,chooseSaveTarget,saveAsAvailable,saveCancelled,saveOutcomeMessage,saveToTarget} from '../src/save-as.mjs';

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

test('a failed write is abandoned and the file goes to Downloads instead, with the reason',async()=>{
  const steps=[],heard=[];
  const target={name:'x.xlsx',createWritable:async()=>({write:async()=>{throw new Error('Disk full');},close:async()=>steps.push('closed'),abort:async()=>steps.push('aborted')})};
  const outcome=await saveToTarget(target,{},'suggested.xlsx',(blob,name)=>steps.push('downloaded '+name),{onWriteError:error=>heard.push(error.message)});
  assert.deepEqual(steps,['aborted','downloaded suggested.xlsx']);
  assert.deepEqual(heard,['Disk full']);
  assert.deepEqual(outcome,{saved:false,name:'suggested.xlsx',fallback:true,chosenName:'x.xlsx',reason:'Disk full'});
  assert.match(saveOutcomeMessage(outcome),/could not be saved as x\.xlsx in the folder you chose \(Disk full\), so it was downloaded to your Downloads folder as suggested\.xlsx/);
});

test('a chosen file that is open in Excel cannot be opened for writing: it is downloaded, and the notice says why',async()=>{
  const steps=[];
  const locked=Object.assign(new Error('The request is not allowed'),{name:'NoModificationAllowedError'});
  const outcome=await saveToTarget({name:'trip.xlsx',createWritable:async()=>{throw locked;}},{},'trip.xlsx',()=>steps.push('downloaded'),{onWriteError:()=>{throw new Error('reporting broke');}});
  assert.deepEqual(steps,['downloaded']);
  assert.equal(outcome.reason,'the file is open in another program, such as Excel');
});

test('the notice says where the file went: the chosen folder (not in Downloads), or Downloads',()=>{
  assert.match(saveOutcomeMessage({saved:true,name:'Step 1.xlsx'}),/^Excel saved as Step 1\.xlsx in the folder you chose\. A file saved with Save As does not show in the browser's Downloads list/);
  assert.equal(saveOutcomeMessage({saved:false,name:'a.xlsx'}),'Excel download started. Check your browser downloads.');
  assert.match(saveOutcomeMessage({saved:true,name:'a.pdf'},'PDF'),/^PDF saved as a\.pdf/);
});
