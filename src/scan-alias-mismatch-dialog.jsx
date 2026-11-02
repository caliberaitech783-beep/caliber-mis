import React,{useEffect,useMemo,useRef,useState} from 'react';
import EquipmentAliasOtpPanel from './equipment-alias-otp-panel.jsx';
import {nextMismatchPair,mismatchPairCount} from './scan-alias-mismatch.mjs';

// Equipment mismatch · cards vs Pulse. Opens by itself when extraction finishes, before
// card 1. Works category by category (tipper headers, trip body equipment, ELB headers) and
// pair by pair: one pair on screen, pair it, OTP, it vanishes, the next appears. Left:
// Pulse equipment at this site not found on any card. Right: card machines not found in
// Pulse. Suggestions are ranked by the written number and never applied automatically.
export default function ScanAliasMismatchDialog({session,batchLabel,data,busy,error,approver,approverTelegramLinked,onPair,onApproved,onSkipPair,onSkipCategory,onClose,onRefresh,skippedPairs,skippedCategories}){
 const dialog=useRef(null),[choiceState,setChoiceState]=useState(null),[aliasOverride,setAliasOverride]=useState(null);
 useEffect(()=>{const node=dialog.current;if(node&&!node.open)node.showModal();return()=>{if(node?.open)node.close()}},[]);
 const current=useMemo(()=>nextMismatchPair(data,skippedPairs,skippedCategories),[data,skippedPairs,skippedCategories]);
 // Derived per pair so the first paint already shows the suggestion and resumes a pending pair at its OTP step.
 const pairKey=current?current.category.id+':'+current.pair.key:'';
 const choice=choiceState?.pairKey===pairKey?choiceState.value:current?.pair?.suggestions?.[0]||'';
 const setChoice=value=>setChoiceState({pairKey,value});
 const alias=aliasOverride?.pairKey===pairKey?aliasOverride.alias:current?.pair?.alias||null;
 const setAlias=value=>setAliasOverride({pairKey,alias:value});
 const categoryIndex=(data?.categories||[]).findIndex(c=>c.id===current?.category?.id);
 const total=mismatchPairCount(data,skippedPairs,skippedCategories);
 const pairing=current&&!alias;
 const chosen=current?.category.left.find(a=>a.id===choice);
 const counts=current?{rows:current.pair.rows,cards:current.pair.cards,batch:data?.batchName||'',context:data?.context?[data.context.bookDate,data.context.location,'Shift '+data.context.cardShift].filter(Boolean).join(', '):''}:null;
 return <dialog ref={dialog} className="scan-equipment-dialog scan-alias-dialog" aria-labelledby="scan-alias-title" onCancel={event=>{event.preventDefault();onClose()}}>
  <h2 id="scan-alias-title">Equipment mismatch · {data?.kind==='vehicle'?'trip cards':'job cards'} vs Pulse</h2>
  <p className="scan-alias-context">{batchLabel}{data?.extracting?' · extraction still running':''}</p>
  {!current&&<p role="status">All written machines in this batch match Pulse. Card review can start.</p>}
  {current&&<>
   <p className="scan-alias-progress">Category {categoryIndex+1} of {data.categories.length} · {current.category.label} · {current.category.right.filter(p=>!skippedPairs.has(current.category.id+':'+p.key)).length} pair(s) pending · {total} in all</p>
   <div className="scan-alias-columns">
    <section><h3>Pulse {current.category.kind==='vehicle'?'tippers':'equipment'} at this site, not found on any card</h3>
     {!current.category.left.length&&<p>None. Every Pulse record at this site is already named on a card.</p>}
     <ul className="scan-alias-list">{current.category.left.map(asset=><li key={asset.id} className={current.pair.suggestions.includes(asset.id)?'scan-alias-suggested':''}>
      <label><input type="radio" name="scan-alias-left" disabled={!pairing||busy} checked={choice===asset.id} onChange={()=>setChoice(asset.id)}/> <strong>{asset.door}</strong>{asset.name&&asset.name!==asset.door?' · '+asset.name:''}{current.category.id==='elb'&&(asset.make||asset.model)?' · '+[asset.make,asset.model].filter(Boolean).join(' '):''}{current.pair.suggestions[0]===asset.id?<em> suggested by number</em>:null}</label></li>)}</ul>
    </section>
    <section><h3>Card {current.category.kind==='vehicle'?'tippers':'machines'} not found in Pulse</h3>
     <ul className="scan-alias-list"><li className="scan-alias-current"><strong>{current.pair.written}</strong>{current.pair.machine?' read as '+current.pair.machine:''} · {current.pair.rows} row(s) on {current.pair.cards} card(s){current.pair.ambiguous?' · also matches a real door at this site':''}{alias?.status==='suspended'?' · alias suspended: '+(alias.suspendedReason||'a real door now shadows it'):''}</li>
      {current.category.right.filter(p=>p.key!==current.pair.key&&!skippedPairs.has(current.category.id+':'+p.key)).map(p=><li key={p.key} className="scan-alias-queued">{p.written} · {p.rows} row(s)</li>)}</ul>
    </section>
   </div>
   <p className="scan-alias-pair">Pair: <strong>{chosen?chosen.door:'(choose a Pulse record)'}</strong> ⇄ <strong>{current.pair.written}</strong> ({current.pair.rows} row(s)){alias?' · applied to this batch'+(alias.status==='active'?' · approved':''):''}</p>
   {pairing&&<div className="vlb-batch-actions"><button type="button" className="vlb-approval-primary" disabled={busy||!chosen} onClick={async()=>{const result=await onPair(current.category,current.pair,chosen);if(result?.alias)setAlias(result.alias);}}>{busy?'Applying…':data?.otpEnabled?'Pair and continue to OTP':'Pair and save alias'}</button></div>}
   {alias&&alias.status!=='active'&&data?.otpEnabled&&<EquipmentAliasOtpPanel session={session} alias={alias} site={data.site} counts={counts} approver={approver} approverTelegramLinked={approverTelegramLinked} onAlias={setAlias} onApproved={async result=>{await onApproved?.(result);setAlias(null);}}/>}
   {alias&&alias.status==='active'&&<p role="status" className="vlb-approval-feedback">Approved. {current.pair.written} now maps to {chosen?.door||'the Pulse record'} on every card and batch.</p>}
   {error&&<p role="alert" className="scan-error">{error}</p>}
   <footer><button type="button" disabled={busy} onClick={()=>onSkipPair(current.category.id+':'+current.pair.key)}>Skip this pair</button><button type="button" disabled={busy} onClick={()=>onSkipCategory(current.category.id)}>Skip category</button><button type="button" disabled={busy} onClick={onRefresh}>Recheck</button><button type="button" disabled={busy} onClick={onClose}>Close</button></footer>
  </>}
  {!current&&<footer><button type="button" onClick={onClose}>Start card review</button></footer>}
 </dialog>;
}
