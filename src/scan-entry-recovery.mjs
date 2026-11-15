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

export function scanEntryHeading(entry,index=0,trips=0){
 const batchNumber='B'+(String(entry?.name||'').match(/B0*(\d+)$/i)?.[1]||index+1);
 return {batchNumber,text:String(entry?.name||batchNumber)+' ('+(Number(entry?.cards)||0)+' cards)\n'+batchNumber+' ('+(Number(trips)||0)+' trips)'};
}

// `entries` are the scan entries already filtered to the VLB batch's date, site
// and shift, newest first as the server lists them.
export function chooseScanEntry(entries,{remembered=''}={}){
 const open=(entries||[]).filter(entry=>entry?.id&&!entryCancelled(entry));
 if(remembered){const match=open.find(entry=>entry.id===remembered);if(match)return match;}
 return open.find(entryHasUnsavedCards)||null;
}

// The open entry describes itself with the same counts and the same words as the
// Card status tiles (Needs attention, Wrong HMR, MWS / TED mismatch, ...) and the
// reading line under them (reading, waiting to be read), so a reader can match each
// figure to a tile. Other entries only have the server counts: cards, saved, unsaved.
const LIVE_GROUP_WORDS=[
 ['brown','needs attention','need attention'],
 ['wrong-door','wrong door no.'],
 ['wrong-caliber','wrong Caliber ID'],
 ['wrong-hmr','wrong HMR'],
 ['wrong-kmr','wrong KMR'],
 ['mws-ted','MWS / TED mismatch'],
 ['red','blank / no data'],
 ['error','error','errors']
];
export function describeScanEntry(entry,live=null){
 const cards=live?Number(live.total||0):Number(entry?.cards||0),posted=live?Number(live.saved||0):Number(entry?.posted||0),duplicates=Number(entry?.duplicates||0);
 const parts=[cards+' card'+(cards===1?'':'s')];
 if(posted)parts.push(posted+' saved');
 if(live){
  if(live.waiting>0)parts.push(live.waiting+' waiting to save');
  for(const [group,one,many=one] of LIVE_GROUP_WORDS){const count=Number(live[group]||0);if(count>0)parts.push(count+' '+(count===1?one:many));}
  const pending=Number(live.pending||0),reading=Math.min(pending,Math.max(0,Number(live.reading||0)));
  if(reading>0)parts.push(reading+' reading');
  if(pending>reading)parts.push((pending-reading)+' waiting to be read');
 }else if(cards>posted)parts.push((cards-posted)+' unsaved');
 if(duplicates)parts.push(duplicates+' duplicate'+(duplicates===1?'':'s')+' skipped');
 return parts.join(' · ');
}
