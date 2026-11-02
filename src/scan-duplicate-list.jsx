import {useEffect,useState} from 'react';

// Upload summary: how many cards were scanned, how many were the same paper as
// a card already in another entry (skipped before reading), how many are new.
export function scanUploadNotice({addon=false,count=0,duplicateCount=0,duplicateEntries=[],entryTotal=1,timeTaken=''}){
 const fresh=count-duplicateCount,plural=(n,word)=>n+' '+word+(n===1?'':'s');
 const parts=[plural(count,'card')+' scanned.'];
 if(duplicateCount)parts.push(plural(duplicateCount,'duplicate')+(duplicateEntries.length?' of '+(duplicateEntries.length===1?'entry ':'entries ')+duplicateEntries.join(', '):'')+' skipped.');
 parts.push(fresh?plural(fresh,'new card')+' queued for reading'+(entryTotal>1?' across '+entryTotal+' scan entries':'')+'.':'No new cards.');
 parts.push((addon?'Addon complete. ':'')+'Create Batch collects all saved entries for the same date, location and shift.'+(timeTaken?' '+timeTaken:''));
 return parts.join(' ');
}

export function scanDuplicateLine(row){
 const o=row.original||{};
 const where=o.missing?'a card that was since removed':'card '+(o.ordinal??'?')+' in entry '+(o.entryName||'—')+(o.bookNo?' (saved as '+o.bookNo+')':'');
 const how=row.reason==='exact'?'identical file':row.reason==='content'?'same card number, door and date':'same paper, rescanned';
 return 'Card '+row.ordinal+' · duplicate of '+where+' · '+how+(row.distance?.max!==undefined&&row.distance.max!==null?' · '+row.distance.max+'% different':'');
}

function ScanThumb({cardId,token,label}){
 const [url,setUrl]=useState('');
 useEffect(()=>{let live=true,object='';if(!cardId)return;fetch('/api/scan-cards/'+cardId+'/image',{headers:{Authorization:`Bearer ${token}`}}).then(r=>{if(!r.ok)throw new Error('unavailable');return r.blob()}).then(blob=>{if(!live)return;object=URL.createObjectURL(blob);setUrl(object)}).catch(()=>{if(live)setUrl('')});return()=>{live=false;if(object)URL.revokeObjectURL(object)}},[cardId,token]);
 return <figure className="scan-duplicate-thumb"><figcaption>{label}</figcaption>{url?<img src={url} alt={label}/>:<div className="scan-duplicate-thumb-empty">Image not available</div>}</figure>;
}

// Duplicates tile detail: every skipped card beside its original, with the one
// way to overrule the system: read this card after all.
export default function ScanDuplicateList({duplicates,token,disabled,onRestore,onOpenOriginal}){
 const [open,setOpen]=useState('');
 if(!duplicates.length)return <p className="scan-duplicate-empty">No duplicate cards were skipped in this entry.</p>;
 return <section className="scan-duplicate-list" aria-label="Duplicate cards skipped">
  <p>These scans match a card that already exists for this date, site and shift. They were not read and do not count in this entry. Open one to compare both scans; use <strong>Not a duplicate</strong> only when the two cards are genuinely different.</p>
  {duplicates.map(row=><article key={row.id} className="scan-duplicate-row">
   <button type="button" className="scan-duplicate-summary" aria-expanded={open===row.id} onClick={()=>setOpen(open===row.id?'':row.id)}>{scanDuplicateLine(row)}</button>
   {open===row.id&&<div className="scan-duplicate-compare">
    <ScanThumb cardId={row.id} token={token} label={'This scan · card '+row.ordinal}/>
    <ScanThumb cardId={row.original?.cardId} token={token} label={row.original?.missing?'Original (removed)':'Original · card '+row.original?.ordinal+' in '+(row.original?.entryName||'entry')}/>
    <div className="scan-duplicate-actions">
     {row.original?.cardId&&!row.original.missing&&onOpenOriginal&&<button type="button" disabled={disabled} onClick={()=>onOpenOriginal(row.original)}>Open original entry</button>}
     <button type="button" disabled={disabled} onClick={()=>{if(window.confirm('Read this card as a new card? Do this only if it is a different card from the original shown.'))onRestore(row)}}>Not a duplicate, read this card</button>
    </div>
   </div>}
  </article>)}
 </section>;
}
