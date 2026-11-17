// "Export Excel" opens the computer's own Save As window, so the user chooses the folder and the file name.
// Only Chrome and Edge on a PC have that window; everywhere else (phones, Firefox, Safari) the file goes to
// Downloads as before.
import {recordDownload} from './download-history.mjs';
export const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FILE_TYPES={
  xlsx:{description:'Excel Workbook',accept:{[XLSX_MIME]:['.xlsx']}},
  pdf:{description:'PDF document',accept:{'application/pdf':['.pdf']}},
};
// Owner, 17 Nov 2026, after PR 396 went live: "Excel still not downloading". He works in a browser (the Claude app's
// browser pane) that refuses the Save As window at once, in about 0.06 s, with the same AbortError a Cancel gives. The
// export took that as his Cancel and stopped without a word, so no file was ever made. A person cannot see the window
// and press Cancel this fast, so an AbortError this quick means "no Save As window here": the file is downloaded to
// Downloads instead, and this browser page is not asked again.
export const SAVE_AS_REFUSED_WITHIN_MS=400;
const refusingWindows=new WeakSet();
// Owner, 17 Nov 2026 at 11:40, after the fix above went live: "Excel still not downloading". The Claude app's browser pane
// now shows the Save As window, but the file chosen there cannot be written: it stays empty, 0 bytes, while the pane's
// own storage writes fine. So the person found an empty file where they saved. That pane is known by "Claude/" in its
// user agent and gets a plain download, which lands in Downloads. Any other browser whose chosen place fails is marked
// the same way after the first failure (markSaveAsRefused), so its next export goes straight to Downloads.
// Owner, 17 Nov 2026 at 15:30, after that went live: "Excel still not downloading". Proven in the pane with a test page: the
// Claude app answers every download with its own Windows Save As window, whose title is a web address ("blob:https://…")
// rather than the file name. The file waits in Downloads as an unnamed .tmp until Save is pressed there; Cancel throws it
// away. The page cannot skip or fill that window, so the notice tells the person to press Save in it.
export const claudeAppPane=(win=globalThis.window)=>/\bClaude\/\d/.test(String(win?.navigator?.userAgent||''));
export const markSaveAsRefused=(win=globalThis.window)=>{if(win&&typeof win==='object')refusingWindows.add(win);};
export const saveAsAvailable=(win=globalThis.window)=>typeof win?.showSaveFilePicker==='function'&&!refusingWindows.has(win)&&!claudeAppPane(win);
export const saveCancelled=error=>error?.name==='AbortError';

/**
 * Asks where to save. Call it straight from the click, before the file is built: the browser refuses the
 * window once the click is a few seconds old.
 * Returns the chosen file, or null when there is no Save As window here (or the browser refused to show it).
 * Rejects with AbortError only when the user pressed Cancel in the window.
 */
export async function chooseSaveTarget(fileName,win=globalThis.window,{now=()=>Date.now()}={}){
  if(!saveAsAvailable(win))return null;
  const type=FILE_TYPES[String(fileName).split('.').pop().toLowerCase()];
  const askedAt=now();
  try{return await win.showSaveFilePicker({suggestedName:fileName,...(type?{types:[type]}:{})});}
  catch(error){
    if(saveCancelled(error)&&now()-askedAt>=SAVE_AS_REFUSED_WITHIN_MS)throw error;
    if(saveCancelled(error)){refusingWindows.add(win);return null;}
    // Not allowed here (inside a frame, or the click went stale): an ordinary download still gives the file.
    return null;
  }
}

/**
 * Writes the file where the user chose, or downloads it when no place was chosen. Says which happened.
 * When the chosen place cannot be written (the same file open in Excel, a OneDrive or network folder that refuses,
 * no space), the file is downloaded to Downloads instead, so the user never ends with nothing (16 Nov 2026: "the Excel
 * file is not downloading after selecting the download location"). onWriteError hears why, for the diagnostics log.
 * The file the Save As window made is removed only while it is still empty (0 bytes); a file with data in it may be an
 * older file the user chose to replace, and is left as it is. After a failed write this page downloads from then on.
 */
// A write that has not finished in this time (a OneDrive or network folder that hangs, a virus check that never answers)
// is given up and the file is downloaded instead (owner, 16 Nov 2026 at 22:30, after the fallback above: "Excel reports are
// still not downloading in Smart Print").
export const SAVE_WRITE_LIMIT_MS=20000;
const tooSlow=()=>Object.assign(new Error('the folder you chose did not finish taking the file within '+SAVE_WRITE_LIMIT_MS/1000+' seconds'),{name:'TimeoutError'});
export async function saveToTarget(target,blob,fileName,download,{onWriteError,limitMs=SAVE_WRITE_LIMIT_MS,record=recordDownload,title='',win=globalThis.window}={}){
  if(!target){download(blob,fileName);return {saved:false,name:fileName};}
  let writable=null,timer=null;
  try{
    const write=(async()=>{writable=await target.createWritable();await writable.write(blob);await writable.close();})();
    write.catch(()=>{/* a write that ends after the limit has already been reported */});
    await Promise.race([write,new Promise((_,reject)=>{timer=setTimeout(()=>reject(tooSlow()),limitMs);})]);
  }catch(error){
    if(writable){try{await writable.abort?.();}catch{/* the write already failed */}}
    try{onWriteError?.(error);}catch{/* reporting never stops the file */}
    download(blob,fileName);
    markSaveAsRefused(win);
    await removeIfEmpty(target);
    return {saved:false,name:fileName,fallback:true,chosenName:target.name||fileName,reason:writeErrorText(error)};
  }finally{clearTimeout(timer);}
  // Download History keeps a copy, so a file saved in a folder can be opened again from the app.
  try{record?.(blob,target.name||fileName,{where:'folder',title});}catch{/* the history never stops the file */}
  return {saved:true,name:target.name||fileName};
}

// The empty file the Save As window made, so no 0-byte file is left where the person looks. Never a file with data in it.
async function removeIfEmpty(target){
  try{if(typeof target?.remove==='function'&&(await target.getFile()).size===0)await target.remove();}catch{/* leaving it is harmless */}
}

function writeErrorText(error){
  const name=String(error?.name||'');
  if(name==='NoModificationAllowedError'||name==='InvalidModificationError')return 'the file is open in another program, such as Excel';
  if(name==='NotAllowedError'||name==='SecurityError')return 'the browser was not allowed to write there';
  if(name==='QuotaExceededError')return 'there is no space left there';
  if(name==='TimeoutError')return String(error.message);
  return String(error?.message||'the browser could not write there');
}

/** The words for the notice after an export: where the file went, in words a site user can act on. */
export function saveOutcomeMessage(outcome,formatName='Excel',{win=globalThis.window}={}){
  if(outcome?.name&&!outcome.saved&&!outcome.fallback&&claudeAppPane(win))return `${formatName} is ready: a Save As window has opened (its title starts with "blob:"). Choose the folder and press Save to keep ${outcome.name}. Cancel throws the file away.`;
  if(outcome?.saved)return `${formatName} saved as ${outcome.name} in the folder you chose. A file saved with Save As does not show in the browser's Downloads list: open that folder to find it.`;
  if(outcome?.fallback)return `${formatName} could not be saved as ${outcome.chosenName} in the folder you chose (${outcome.reason}), so it was downloaded to your Downloads folder as ${outcome.name}. From now on this page downloads straight to Downloads.`;
  // Some browsers (the Claude app's browser pane) show no download bar, so the notice names the folder and the file.
  if(outcome?.name)return `${formatName} download started: ${outcome.name} goes to your Downloads folder. It is also in Download History (the folder button at the top) to open again.`;
  return `${formatName} download started. Check your browser downloads.`;
}
