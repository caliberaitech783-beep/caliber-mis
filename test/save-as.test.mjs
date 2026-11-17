import assert from 'node:assert/strict';
import test from 'node:test';
import {SAVE_AS_REFUSED_WITHIN_MS,XLSX_MIME,chooseSaveTarget,saveAsAvailable,saveCancelled,saveOutcomeMessage,saveToTarget} from '../src/save-as.mjs';

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
  // A person needs time to see the window and press Cancel: the clock moves 2 s between asking and the answer.
  let clock=0;const slow={now:()=>(clock+=2000)};
  await assert.rejects(chooseSaveTarget('report.xlsx',{showSaveFilePicker:async()=>{throw cancel;}},slow),error=>saveCancelled(error));
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
  assert.equal(saveOutcomeMessage({saved:false,name:'a.xlsx'}),'Excel download started: a.xlsx goes to your Downloads folder. It is also in Download History (the folder button at the top) to open again.');
  assert.equal(saveOutcomeMessage(null),'Excel download started. Check your browser downloads.');
  assert.match(saveOutcomeMessage({saved:true,name:'a.pdf'},'PDF'),/^PDF saved as a\.pdf/);
});

test('a Save As window the browser refuses at once (same AbortError as Cancel) downloads the file instead of stopping',async()=>{
  // Owner, 17 Nov 2026: in the Claude app's browser pane the window is refused in about 0.06 s and nothing was made.
  const refusedAtOnce=Object.assign(new Error("Failed to execute 'showSaveFilePicker' on 'Window': The user aborted a request."),{name:'AbortError'});
  let asked=0,clock=1000;
  const pane={showSaveFilePicker:async()=>{asked++;clock+=60;throw refusedAtOnce;}};
  assert.equal(saveAsAvailable(pane),true);
  assert.equal(await chooseSaveTarget('step-1.xlsx',pane,{now:()=>clock}),null,'no place chosen: saveToTarget downloads it');
  // This page is not asked again: the next export goes straight to Downloads and the menu drops "(Save As)".
  assert.equal(saveAsAvailable(pane),false);
  assert.equal(await chooseSaveTarget('step-2.xlsx',pane,{now:()=>clock}),null);
  assert.equal(asked,1);
  const downloads=[];
  assert.deepEqual(await saveToTarget(null,{size:5},'step-1.xlsx',(...args)=>downloads.push(args),{record:null}),{saved:false,name:'step-1.xlsx'});
  assert.equal(downloads.length,1);
  // Just under and at the limit.
  let t=0;const edge=ms=>({now:()=>{const v=t;t+=ms;return v;}});
  await assert.rejects(chooseSaveTarget('x.xlsx',{showSaveFilePicker:async()=>{throw refusedAtOnce;}},edge(SAVE_AS_REFUSED_WITHIN_MS)),error=>saveCancelled(error));
  assert.equal(await chooseSaveTarget('x.xlsx',{showSaveFilePicker:async()=>{throw refusedAtOnce;}},edge(SAVE_AS_REFUSED_WITHIN_MS-1)),null);
});

test('the Claude app pane downloads straight away, and a failed write removes only an empty file and stops asking',async()=>{
  // Owner, 17 Nov 2026 at 11:40: in the Claude app pane the Save As window opened, but the chosen file stayed at 0 bytes.
  const paneWin={showSaveFilePicker:async()=>{throw new Error('must not be asked');},navigator:{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/5.11492.5 Chrome/156.0.8078.75 Safari/537.36 MSIX'}};
  assert.equal(saveAsAvailable(paneWin),false);
  assert.equal(await chooseSaveTarget('step-1.xlsx',paneWin),null);
  const chrome={showSaveFilePicker:async()=>null,navigator:{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'}};
  assert.equal(saveAsAvailable(chrome),true);
  const denied=Object.assign(new Error('The request is not allowed'),{name:'NotAllowedError'});
  const steps=[];
  const emptyFile={name:'step-1.xlsx',createWritable:async()=>{throw denied;},getFile:async()=>({size:0}),remove:async()=>steps.push('removed empty file')};
  const outcome=await saveToTarget(emptyFile,{},'step-1.xlsx',()=>steps.push('downloaded'),{win:chrome,record:null});
  assert.deepEqual(steps,['downloaded','removed empty file']);
  assert.equal(outcome.fallback,true);
  assert.match(saveOutcomeMessage(outcome),/From now on this page downloads straight to Downloads\.$/);
  assert.equal(saveAsAvailable(chrome),false,'the next export on this page goes straight to Downloads');
  // A file that already holds data (an older report the user chose to replace) is never removed.
  const kept=[];
  const olderFile={name:'old.xlsx',createWritable:async()=>{throw denied;},getFile:async()=>({size:5120}),remove:async()=>kept.push('removed')};
  await saveToTarget(olderFile,{},'old.xlsx',()=>{},{win:{},record:null});
  assert.deepEqual(kept,[]);
});
