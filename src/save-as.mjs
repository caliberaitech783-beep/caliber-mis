// "Export Excel" opens the computer's own Save As window, so the user chooses the folder and the file name.
// Only Chrome and Edge on a PC have that window; everywhere else (phones, Firefox, Safari) the file goes to
// Downloads as before.
export const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FILE_TYPES={
  xlsx:{description:'Excel Workbook',accept:{[XLSX_MIME]:['.xlsx']}},
  pdf:{description:'PDF document',accept:{'application/pdf':['.pdf']}},
};
export const saveAsAvailable=(win=globalThis.window)=>typeof win?.showSaveFilePicker==='function';
export const saveCancelled=error=>error?.name==='AbortError';

/**
 * Asks where to save. Call it straight from the click, before the file is built: the browser refuses the
 * window once the click is a few seconds old.
 * Returns the chosen file, or null when there is no Save As window here. Rejects with AbortError on Cancel.
 */
export async function chooseSaveTarget(fileName,win=globalThis.window){
  if(!saveAsAvailable(win))return null;
  const type=FILE_TYPES[String(fileName).split('.').pop().toLowerCase()];
  try{return await win.showSaveFilePicker({suggestedName:fileName,...(type?{types:[type]}:{})});}
  catch(error){
    if(saveCancelled(error))throw error;
    // Not allowed here (inside a frame, or the click went stale): an ordinary download still gives the file.
    return null;
  }
}

/**
 * Writes the file where the user chose, or downloads it when no place was chosen. Says which happened.
 * When the chosen place cannot be written (the same file open in Excel, a OneDrive or network folder that refuses,
 * no space), the file is downloaded to Downloads instead, so the user never ends with nothing (16 Nov 2026: "the Excel
 * file is not downloading after selecting the download location"). onWriteError hears why, for the diagnostics log.
 * The file the Save As window made is left as it is: it may be an older file the user chose to replace.
 */
export async function saveToTarget(target,blob,fileName,download,{onWriteError}={}){
  if(!target){download(blob,fileName);return {saved:false,name:fileName};}
  let writable=null;
  try{
    writable=await target.createWritable();
    await writable.write(blob);await writable.close();
  }catch(error){
    if(writable){try{await writable.abort?.();}catch{/* the write already failed */}}
    try{onWriteError?.(error);}catch{/* reporting never stops the file */}
    download(blob,fileName);
    return {saved:false,name:fileName,fallback:true,chosenName:target.name||fileName,reason:writeErrorText(error)};
  }
  return {saved:true,name:target.name||fileName};
}

function writeErrorText(error){
  const name=String(error?.name||'');
  if(name==='NoModificationAllowedError'||name==='InvalidModificationError')return 'the file is open in another program, such as Excel';
  if(name==='NotAllowedError'||name==='SecurityError')return 'the browser was not allowed to write there';
  if(name==='QuotaExceededError')return 'there is no space left there';
  return String(error?.message||'the browser could not write there');
}

/** The words for the notice after an export: where the file went, in words a site user can act on. */
export function saveOutcomeMessage(outcome,formatName='Excel'){
  if(outcome?.saved)return `${formatName} saved as ${outcome.name} in the folder you chose. A file saved with Save As does not show in the browser's Downloads list: open that folder to find it.`;
  if(outcome?.fallback)return `${formatName} could not be saved as ${outcome.chosenName} in the folder you chose (${outcome.reason}), so it was downloaded to your Downloads folder as ${outcome.name}.`;
  return `${formatName} download started. Check your browser downloads.`;
}
