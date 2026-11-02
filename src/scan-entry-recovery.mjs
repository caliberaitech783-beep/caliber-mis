// Which scan entry to reopen for a VLB batch when the page has no entry in its
// address (after a refresh, a crash recovery or a server update). The cards of
// an entry live on the server, so reopening is only a matter of choosing the
// right entry: the one this browser last worked in, otherwise the newest entry
// that still has unsaved cards.
const STORAGE_PREFIX='scan-entry:';

export const scanEntryStorageKey=(kind,vlbBatchId)=>STORAGE_PREFIX+String(kind||'vehicle')+':'+String(vlbBatchId||'');

export function rememberScanEntry(storage,kind,vlbBatchId,entryId){
 if(!storage||!vlbBatchId)return false;
 try{if(entryId)storage.setItem(scanEntryStorageKey(kind,vlbBatchId),String(entryId));else storage.removeItem(scanEntryStorageKey(kind,vlbBatchId));return true;}catch{return false;}
}

export function recallScanEntry(storage,kind,vlbBatchId){
 if(!storage||!vlbBatchId)return '';
 try{return String(storage.getItem(scanEntryStorageKey(kind,vlbBatchId))||'');}catch{return '';}
}

export const entryCancelled=entry=>Boolean(entry?.expected_context?.cancelled||entry?.expected_context?.deletedVlbBatch);
export const entryHasUnsavedCards=entry=>Number(entry?.cards||0)>Number(entry?.posted||0);

// `entries` are the scan entries already filtered to the VLB batch's date, site
// and shift, newest first as the server lists them.
export function chooseScanEntry(entries,{remembered=''}={}){
 const open=(entries||[]).filter(entry=>entry?.id&&!entryCancelled(entry));
 if(remembered){const match=open.find(entry=>entry.id===remembered);if(match)return match;}
 return open.find(entryHasUnsavedCards)||null;
}

export function describeScanEntry(entry){
 const cards=Number(entry?.cards||0),posted=Number(entry?.posted||0),duplicates=Number(entry?.duplicates||0);
 const parts=[cards+' card'+(cards===1?'':'s')];
 if(posted)parts.push(posted+' saved');
 if(cards>posted)parts.push((cards-posted)+' unsaved');
 if(duplicates)parts.push(duplicates+' duplicate'+(duplicates===1?'':'s')+' skipped');
 return parts.join(' · ');
}
