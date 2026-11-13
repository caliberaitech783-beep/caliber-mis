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

/** Writes the file where the user chose, or downloads it when no place was chosen. Says which happened. */
export async function saveToTarget(target,blob,fileName,download){
  if(!target){download(blob,fileName);return {saved:false,name:fileName};}
  const writable=await target.createWritable();
  try{await writable.write(blob);await writable.close();}
  catch(error){try{await writable.abort?.();}catch{/* the write already failed */}throw error;}
  return {saved:true,name:target.name||fileName};
}
