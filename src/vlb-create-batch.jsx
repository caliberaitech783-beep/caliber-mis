import VlbBatchDeletion,{DeletedVlbBatches} from './vlb-batch-deletion.jsx';
import VlbBatchCardDetails from './vlb-batch-card-details.jsx';
import LogBookForm from './log-book-form.jsx';
import SmartSelect from './smart-select.jsx';
import LogBookDeletion from './log-book-deletion.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {displaySiteName} from '../shared/region-scope.mjs';
import {bookShiftCode,systemBookDate} from '../shared/trip-card-rules.mjs';
import {vlbRecordSource,vlbRecordEntryType} from '../shared/vlb-batch-format.mjs';
import VlbBatchReport from './vlb-batch-report.jsx';
import VlbBatchGovernance from './vlb-batch-governance.jsx';
import VlbReopenDialog from './vlb-reopen-dialog.jsx';
import {VlbUnlockOtpDialog} from './vlb-approval-otp.jsx';
import VlbBatchHolds,{NewEquipmentRequest} from './vlb-batch-holds.jsx';
import './log-book-form.css';
import './vlb-create-batch.css';

export default function VlbCreateBatch({session,onExit,ReportSection,onManual,onScan,onLmvManual,onLmvScan,onApprovals,onSelected,entryMode,entryKind='vehicle',onElbEntry,onEquipmentElb,canDeleteManualElb}){
 const [options,setOptions]=useState(null),[selection,setSelection]=useState({site:'',date:systemBookDate(),shift:''});
 const [preview,setPreview]=useState(null),[batches,setBatches]=useState([]),[openBatch,setOpenBatch]=useState(null),[viewed,setViewed]=useState(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const requestKey=useRef(crypto.randomUUID()),detailRequest=useRef(0),[detailLoading,setDetailLoading]=useState(false);
 const [batchStatusReady,setBatchStatusReady]=useState(false);
 const [actor,setActor]=useState(null);
 const [showApproval,setShowApproval]=useState(false);
 const [batchSearch,setBatchSearch]=useState('');
 const [batchTab,setBatchTab]=useState('open');
 const [pmApprovalTrial,setPmApprovalTrial]=useState(null);
 const [recovery,setRecovery]=useState(null),[showDeleted,setShowDeleted]=useState(false);
 const [selectedCard,setSelectedCard]=useState(null);
 useEffect(()=>setSelectedCard(null),[viewed?.id]);
 const viewCard=(record,kind)=>setSelectedCard({id:record.id,kind,viewKey:crypto.randomUUID()});


 const autoOpenedEntryBatch=useRef('');
 // Two-stage (VLB -> ELB) state. Declared after the existing hooks so hook order stays unchanged.
 const [twoStageList,setTwoStageList]=useState(false),[newEquipment,setNewEquipment]=useState(false),[unlockOtp,setUnlockOtp]=useState(false);
 const [equipmentElbHidden,setEquipmentElbHidden]=useState(false);
 const [entryFilter,setEntryFilter]=useState('');
 useEffect(()=>setEntryFilter(''),[viewed?.id,viewed?.stage]);
 useEffect(()=>setEquipmentElbHidden(false),[viewed?.id,viewed?.stage]);
 useEffect(()=>setEntryFilter(''),[viewed?.id]);
 const twoStage=Boolean(viewed?.twoStage),stage=twoStage?viewed.stage||'vlb_open':'';
 const [inlineCard,setInlineCard]=useState(null);
 useEffect(()=>setInlineCard(null),[viewed?.id]);
 const vlbLocked=viewed?.closed_at||viewed?.trialExpired||(twoStage&&stage!=='vlb_open');
 const elbLocked=viewed?.closed_at||stage!=='elb_open'||viewed?.trialExpired;
 const canEditCard=(record,kind)=>kind==='equipment'
  ? !elbLocked&&viewed.canEditSavedFleet===true&&!record.data?.operatorSplit
  : !vlbLocked&&(actor?.mis||actor?.admin)&&(!viewed.amendment_by||viewed.amendment_by.toLowerCase()===actor.login?.toLowerCase());
 const editingCard=(record,kind)=>inlineCard?.batchId===viewed.id&&inlineCard?.id===record.id&&inlineCard?.kind===kind;
 const editCard=(record,kind,field)=>{
  if(inlineCard&&!editingCard(record,kind)&&!window.confirm('Discard unsaved changes and edit this card?'))return;
  setInlineCard({batchId:viewed.id,id:record.id,kind,field});
 };
 const canDeleteCard=(record,kind)=>!(kind==='equipment'?elbLocked:vlbLocked)&&
  (actor?.mis||actor?.admin)&&Number.isInteger(record.revision)&&
  (!viewed.amendment_by||viewed.amendment_by.toLowerCase()===actor.login?.toLowerCase());
 const action=(record,kind)=><div className="vlb-batch-actions">
  {canEditCard(record,kind)? <button type="button" aria-label={'Edit '+record.book_no} aria-expanded={editingCard(record,kind)} onClick={()=>editCard(record,kind)}>Edit</button>
  : <span>{(kind==='equipment'?elbLocked:vlbLocked)?'Locked':kind==='equipment'&&record.data?.operatorSplit?'ELB Manual':'View only'}</span>}
  {canDeleteCard(record,kind)&&<button type="button" className="danger" aria-label={'Delete '+record.book_no} disabled={busy||Boolean(inlineCard)} onClick={()=>deleteCard(record,kind)}>Delete</button>}
 </div>;
 const fieldCell=(record,kind,field,value)=>canEditCard(record,kind)
  ? <button type="button" className="batch-edit-field" aria-label={'Edit '+(field==='trips'?'trips':field)+' for '+record.book_no} onClick={()=>editCard(record,kind,field)}>{shown(value)}</button>
  : shown(value);
 const editor=(record,kind,colSpan)=>editingCard(record,kind)&&canEditCard(record,kind)&&<tr className="batch-inline-editor-row"><td colSpan={colSpan}>
  <div className="batch-inline-editor">
   <LogBookForm key={kind+':'+record.id} kind={kind} session={session} vlbBatch={viewed} initialRecord={record} inlineEdit focusField={inlineCard.field} onExit={()=>setInlineCard(null)} onSaved={()=>{setInlineCard(null);setRefresh(n=>n+1)}}/>
  </div>
 </td></tr>;
 const lockedSite=!entryMode&&!actor?.admin&&openBatch&&!openBatch.restricted?openBatch.site:'';
 useEffect(()=>{if(lockedSite)setSelection(current=>({...current,site:options?.sites?.find(site=>canonicalSiteName(site)===canonicalSiteName(lockedSite))||displaySiteName(lockedSite)}));},[lockedSite,options]);
 const read=async(url,{signal,method='GET',body}={})=>{
  if(entryMode==='scan')url+=(url.includes('?')?'&':'?')+'scan=1';
  const response=await fetch(url,{method,signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Could not read VLB batches.');return data;
 };
 useEffect(()=>{const controller=new AbortController();
  read(entryMode?'/api/log-books/options':'/api/log-books/options?siteSource=region-master',{signal:controller.signal}).then(data=>{
   setOptions(data);
   const accountSite=entryMode?data.accountLocation:data.sites?.find(site=>canonicalSiteName(site)===canonicalSiteName(data.accountLocation));
   const site=accountSite||(data.sites?.length===1?data.sites[0]:'');
   setSelection(current=>({...current,site,shift:''}));
  }).catch(e=>{if(!controller.signal.aborted){setError(e.message);setLoading(false)}});
  return()=>controller.abort();
 },[session.token,entryMode]);
 useEffect(()=>{const controller=new AbortController();let pending=false;
  const load=()=>{if(pending)return;pending=true;
   return read('/api/vlb-batches',{signal:controller.signal}).then(data=>{if(controller.signal.aborted)return;setBatches(data.batches);setOpenBatch(data.openBatch);setTwoStageList(Boolean(data.twoStage));setActor(data.actor);setPmApprovalTrial(data.pmApprovalTrial);setBatchStatusReady(true)}).catch(e=>{if(!controller.signal.aborted){setBatchStatusReady(false);setError(e.message)}}).finally(()=>{pending=false});
  };
  void load();const timer=setInterval(load,4000);
  return()=>{controller.abort();clearInterval(timer)};
 },[session.token,refresh]);
 // A report entry action already chose a batch. Restore its site only after
 // both authorized lists arrive, then let the normal picker fetch its details.
 useEffect(()=>{
  if(!entryMode||!options||!batchStatusReady)return;
  const key='vlb-entry-handoff:'+String(session.login||session.name||'');let id='';
  try{id=sessionStorage.getItem(key)||'';if(id)sessionStorage.removeItem(key)}catch{}
  if(!id)return;
  const batch=batches.find(row=>row.id===id),site=batch&&options.sites?.find(value=>canonicalSiteName(value)===canonicalSiteName(batch.site));
  if(!batch||!site){setError('The selected batch is no longer available for your account. Select an available site and batch.');return}
  setSelection({site,date:batch.report_date,shift:batch.shift});
 },[entryMode,options,batchStatusReady,batches,session.login,session.name]);
 useEffect(()=>{const timer=setInterval(()=>setRefresh(n=>n+1),10000);return()=>clearInterval(timer)},[]);
 // The board re-reads the open batch every 10 s. It sends the last ETag it saw, and a
 // 304 keeps the batch on screen as it is instead of downloading every record again.
 const detailCache=useRef({id:'',etag:'',data:null});
 const [deleteBatchId,setDeleteBatchId]=useState(null);
 const readDetail=async(id,signal)=>{
  const cached=detailCache.current.id===id?detailCache.current:null;
  const response=await fetch('/api/vlb-batches/'+id,{signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token,...(cached?.etag?{'If-None-Match':cached.etag}:{})}});
  if(response.status===304&&cached?.data)return cached.data;
  const data=await response.json();if(!response.ok)throw Error(data.error||'Could not read VLB batches.');
  detailCache.current={id,etag:response.headers.get('etag')||'',data};return data;
 };
 useEffect(()=>{if(!viewed?.id)return;const controller=new AbortController();const generation=detailRequest.current;readDetail(viewed.id,controller.signal).then(data=>{if(!controller.signal.aborted&&generation===detailRequest.current)setViewed(data)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[viewed?.id,refresh,session.token]);
 useEffect(()=>{const controller=new AbortController();setPreview(null);
  if(!selection.site||!selection.date||!selection.shift){setLoading(false);return()=>controller.abort()}
  setLoading(!viewed);setError('');
  read('/api/vlb-batches/preview?'+new URLSearchParams(selection),{signal:controller.signal}).then(data=>setPreview(data)).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[selection.site,selection.date,selection.shift,session.token,refresh]);
 useEffect(()=>{if(!options||!selection.site)return;
  const shifts=availableShifts(options,selection);
  if(!shifts.some(s=>s.code===selection.shift))setSelection(current=>({...current,shift:shifts[0]?.code||''}));
 },[options,selection.site,selection.date,selection.shift]);
 const change=(key,value)=>{requestKey.current=crypto.randomUUID();setPreview(null);setViewed(null);setShowApproval(false);++detailRequest.current;setDetailLoading(false);setSelection(current=>({...current,[key]:value}));if(entryMode&&key==='site'){try{sessionStorage.removeItem('vlb-entry-handoff:'+String(session.login||session.name||''))}catch{}autoOpenedEntryBatch.current='';onSelected?.(null)}};
 const clearView=()=>{++detailRequest.current;setDetailLoading(false);setViewed(null);setShowApproval(false)};
 const view=async(batch,open=false)=>{const id=++detailRequest.current;setDetailLoading(true);setError('');try{const result=await read('/api/vlb-batches/'+batch.id);if(id===detailRequest.current){setViewed(result);setShowApproval(Boolean(open&&!entryMode&&result.closed_at&&actor?.mis));if(open&&(entryMode||!result.closed_at))onSelected?.(result)}}catch(e){if(id===detailRequest.current){if(entryMode&&autoOpenedEntryBatch.current===batch.id)autoOpenedEntryBatch.current='';setError(e.message)}}finally{if(id===detailRequest.current)setDetailLoading(false)}};
 const entryMatching=entryMode?openVlbEntryBatches(batches,selection.site,entryKind):[];
 useEffect(()=>{
  if(!entryMode||!selection.site||!batchStatusReady)return;
  let remembered='';try{remembered=sessionStorage.getItem('vlb-entry-batch:'+String(session.login||session.name||''))||''}catch{}
  const batch=preferredVlbEntryBatch(entryMatching,remembered);
  if(!batch){
   if(autoOpenedEntryBatch.current){autoOpenedEntryBatch.current='';++detailRequest.current;setDetailLoading(false);setViewed(null);onSelected?.(null)}
   return;
  }
  if(autoOpenedEntryBatch.current===batch.id)return;
  autoOpenedEntryBatch.current=batch.id;view(batch,true);
 },[entryMode,selection.site,batchStatusReady,batches]);
 const deleteCard=async(record,kind)=>{
  if(busy||inlineCard||!canDeleteCard(record,kind))return;
  if(!window.confirm('Delete '+record.book_no+' from '+viewed.name+'? Only this saved card will be removed.'))return;
  setBusy(true);setError('');
  try{
   await read('/api/log-books/'+kind+'/'+record.id,{method:'DELETE',body:{revision:record.revision}});
   setSelectedCard(current=>current?.kind===kind&&String(current.id)===String(record.id)?null:current);
  }catch(error){setError(error.message)}
  finally{setRefresh(n=>n+1);setBusy(false)}
 };
 const create=async()=>{setBusy(true);setError('');try{
  const batch=await read('/api/vlb-batches',{method:'POST',body:{...selection,requestKey:requestKey.current}});
  ++detailRequest.current;setDetailLoading(false);setViewed(batch);requestKey.current=crypto.randomUUID();setOpenBatch(batch.closed_at?null:batch);setRefresh(n=>n+1);if(!batch.closed_at)onSelected?.(batch);
 }catch(e){setError(e.message);setRefresh(n=>n+1)}finally{setBusy(false)}};
 const close=async(target)=>{const closing=target?.id?target:openBatch;if(!closing)return;setBusy(true);setError('');try{
  const batch=await read('/api/vlb-batches/'+closing.id+'/close',{method:'POST'});
  ++detailRequest.current;setDetailLoading(false);setViewed(batch);setOpenBatch(current=>current?.id===batch.id?null:current);setRefresh(n=>n+1);
 }catch(e){setError(e.message);setRefresh(n=>n+1)}finally{setBusy(false)}};
 const lockStage=async kind=>{if(!viewed)return;setBusy(true);setError('');try{
  const batch=await read('/api/vlb-batches/'+viewed.id+'/lock-'+kind,{method:'POST'});
  ++detailRequest.current;setDetailLoading(false);setViewed(batch);setOpenBatch(current=>current?.id===batch.id?{...current,...batch}:current);setRefresh(n=>n+1);
 }catch(e){setError(e.message);setRefresh(n=>n+1)}finally{setBusy(false)}};
 const unlockVlb=async()=>{if(!viewed)return;const reason=window.prompt('Reason for unlocking VLB. The machine snapshot is cleared and recorded in the batch audit.','');if(reason==null||!reason.trim())return;setBusy(true);setError('');try{
  const batch=await read('/api/vlb-batches/'+viewed.id+'/unlock-vlb',{method:'POST',body:{reason:reason.trim()}});
  ++detailRequest.current;setDetailLoading(false);setViewed(batch);setOpenBatch(batch.closed_at?null:batch);setRefresh(n=>n+1);
 }catch(e){setError(e.message);setRefresh(n=>n+1)}finally{setBusy(false)}};
 const remove=batch=>setRecovery({batch,operation:'delete'});
 const erase=batch=>setRecovery({batch,operation:'erase'});
 const changed=async batch=>{if(batch){++detailRequest.current;setViewed(batch);setOpenBatch(batch.closed_at?null:batch);if(!batch.closed_at)onSelected?.(batch)}setRefresh(n=>n+1)};
 const records=viewed?.records||preview?.records||[],manual=records.filter(r=>vlbRecordSource(r)==='VLB Manual').length;
 const lmvOpen=stage==='lmv_open';
 const entryCounts=(lmvOpen?viewed.lmvRecords||[]:records).reduce((counts,record)=>({...counts,[vlbRecordEntryType(record)]:counts[vlbRecordEntryType(record)]+1}),{manual:0,scan:0,upload:0});
 const shifts=options?availableShifts(options,selection):[];
 const visibleBatches=batches.filter(b=>(!selection.site||canonicalSiteName(b.site)===canonicalSiteName(selection.site))&&(!batchSearch.trim()||[b.name,b.site,b.report_date,b.shift,b.closed_at?'locked':'open'].join(' ').toLowerCase().includes(batchSearch.trim().toLowerCase()))&&(batchTab==='edit'||(batchTab==='close'?Boolean(b.closed_at):!b.closed_at)));
 if(entryMode)return <section className="logbook-page vlb-create-batch vlb-entry-batch-picker">{error&&<p className="logbook-message error" role="alert">{error}</p>}<section className="logbook-section vlb-batch-setup"><div className="vlb-batch-fields"><label>Site name<select value={selection.site} disabled={busy||!options} onChange={event=>change('site',event.target.value)}><option value="">Select site</option>{(options?.sites||[]).map(site=><option key={site}>{site}</option>)}</select></label></div>{selection.site&&entryMatching.length>0&&<div className="vlb-batch-notice" role="dialog" aria-label="Select batch"><strong>Batch{entryMatching.length===1?'':'es'} for {selection.site}</strong><div className="vlb-batch-actions">{entryMatching.map(batch=><button key={batch.id} type="button" disabled={busy||detailLoading} onClick={()=>view(batch,true)}>Add cards · {batch.name}{' · '+stageLabel(batch.stage,batch)}</button>)}</div></div>}{selection.site&&batchStatusReady&&!entryMatching.length&&<p>{entryKind==='lmv'?'No existing Vehicle Log Book batch is open for LMV entry at this site.':'No batch is available for this site. Create the batch from Create Batch first.'}</p>}</section></section>
 return <section className="logbook-page vlb-create-batch"><header className="logbook-page-header"><div><h1>{entryMode?"Select VLB batch":"Create Batch"}</h1><p>Combine all saved VLB Manual and VLB Scan cards for one site, date and shift.</p></div><button type="button" onClick={onExit}>Back to VLB</button></header>
  <section className="logbook-section vlb-batch-setup"><div className="vlb-batch-fields"><label>Site name<SmartSelect value={selection.site} disabled={busy||!options||Boolean(lockedSite)} onChange={e=>change('site',e.target.value)}><option value="">Select site</option>{(options?.sites||[]).map(site=><option key={site}>{site}</option>)}</SmartSelect></label><label>Report date<input type="date" min="2026-11-01" value={selection.date} disabled={busy} onChange={e=>change('date',e.target.value)}/></label><label>Shift<SmartSelect value={selection.shift} disabled={busy||!selection.site} onChange={e=>change('shift',e.target.value)}><option value="">Select shift</option>{shifts.map(s=><option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}</SmartSelect></label></div>
   <div className="vlb-batch-actions"><button type="button" disabled={busy||loading||detailLoading||!batchStatusReady||actor?.canCreate===false||!selection.site||!selection.date||!selection.shift||!preview||Boolean(preview?.siteOpenBatch)||Boolean(openBatch&&!actor?.admin)||Boolean(preview?.existingBatch)} onClick={create}>Create Batch</button><button type="button" disabled={busy||loading} onClick={()=>{clearView();setRefresh(n=>n+1)}}>Refresh saved entries</button></div>
  </section>
  {pmApprovalTrial?.active&&<p role="status" className="vlb-batch-notice">VLB trial: PM approval is paused until {new Date(pmApprovalTrial.endsAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST. Authorized MIS users can reopen batches directly.</p>}
  {error&&<p className="logbook-message error" role="alert">{error}</p>}
 {openBatch&&<div className="vlb-batch-notice vlb-open-batch-notice" role="status"><strong>Open batch: {openBatch.restricted?'Site access changed':openBatch.name}</strong><p>{twoStageList?(openBatch.stage==='elb_open'?'VLB is locked. Save ELBs for equipment with trips, then close and lock ELB. Equipment with zero trips is optional.':openBatch.stage==='lmv_open'?'Enter LMV cards, then lock LMV to open ELB.':'Enter VLB and LMV cards in this batch. Lock VLB before locking LMV.'):'Continue Manual, Scan or Upload in this batch. Use Save & lock batch when finished.'}</p>{openBatch.restricted?<p>Your site assignment has changed. Contact an administrator to restore access before saving this batch.</p>:<div className="vlb-batch-actions"><button type="button" disabled={busy||detailLoading} onClick={()=>view(openBatch,true)}>Continue open batch</button>{twoStageList?(openBatch.stage==='elb_open'&&<button type="button" disabled={busy||openBatch.canClose===false} onClick={close}>Close &amp; lock ELB</button>):openBatch.canClose!==false&&<button type="button" disabled={busy} onClick={close}>Save &amp; lock batch</button>}</div>}</div>}

  <button type="button" onClick={()=>setShowDeleted(v=>!v)}>{showDeleted?'Hide deleted batches':'Deleted batches'}</button>
  {showDeleted&&<DeletedVlbBatches read={read} refresh={refresh} canManage={actor?.canCreate} onRestore={batch=>setRecovery({batch,operation:'restore'})} onPurge={batch=>setRecovery({batch,operation:'purge'})} onPurgeAll={()=>setRecovery({batch:{id:'all',name:'All deleted batches'},operation:'purge-all'})}/>}
  {recovery&&<VlbBatchDeletion key={recovery.batch.id+recovery.operation} {...recovery} read={read} onDismiss={()=>setRecovery(null)} onChanged={()=>{clearView();setOpenBatch(null);setRefresh(n=>n+1);setShowDeleted(true)}}/>}
  <section className="logbook-section vlb-batch-list"><div className="vlb-batch-heading"><h2>Site batches</h2><div className="vlb-batch-tabs" role="tablist" aria-label="Batch management">{[['open','Open'],['close','Closed'],['edit','Edit']].map(([id,label])=><button key={id} type="button" role="tab" id={'vlb-batch-tab-'+id} aria-selected={batchTab===id} aria-controls="vlb-batch-panel" tabIndex={batchTab===id?0:-1} disabled={busy||detailLoading} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const ids=['open','close','edit'],index=ids.indexOf(batchTab),next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;setBatchTab(ids[next]);event.currentTarget.parentElement.querySelectorAll('[role=tab]')[next]?.focus();}} onClick={()=>setBatchTab(id)}>{label}</button>)}</div></div><div role="tabpanel" id="vlb-batch-panel" aria-labelledby={'vlb-batch-tab-'+batchTab}><p>{batchTab==='open'?'Open a batch to continue Manual, Scan or Upload.':batchTab==='close'?'View saved VLB details in closed batches. Reopen through Edit when corrections are required.':(pmApprovalTrial?.active?'Select a batch to edit its cards. Reopen locked batches directly during the VLB trial.':'Select a batch to edit its cards. Locked batches require site PM approval before editing.')}</p><label>Search batches<input type="search" aria-label="Search VLB batches" placeholder="Batch name, site, date or shift" value={batchSearch} onChange={e=>setBatchSearch(e.target.value)}/></label><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Batch ID</th><th>Cards</th><th>Status</th><th/></tr></thead><tbody>{visibleBatches.map(b=><tr key={b.id}><td>{b.name}</td><td>{b.entry_count}</td><td>{twoStageList?stageLabel(b.stage,b):b.closed_at?'SAVED · LOCKED':b.amendment_by?'REOPENED':'OPEN'}</td><td><div className="vlb-batch-actions"><button type="button" disabled={busy||detailLoading} onClick={()=>view(b)}>View report</button>{(actor?.mis||actor?.admin)&&<>{batchTab==='open'?(twoStageList&&b.stage!=='elb_open'?<button type="button" disabled={busy||detailLoading} onClick={()=>view(b,true)}>Open batch</button>:<button type="button" disabled={busy||detailLoading||!(b.canClose??(String(b.amendment_by||b.created_by||'').toLowerCase()===actor?.login))} onClick={()=>close(b)}>{twoStageList?'Close batch':'Save & lock batch'}</button>):<button type="button" disabled={busy||detailLoading} onClick={()=>view(b,true)}>{batchTab==='edit'?(b.closed_at?(pmApprovalTrial?.active?'Reopen batch':'Request PM approval'):'Edit batch'):'Open batch'}</button>}<button type="button" disabled={busy||detailLoading} onClick={()=>remove(b)}>Delete</button><button type="button" className="danger" disabled={busy||detailLoading} onClick={()=>erase(b)}>Delete permanently</button></>}</div></td></tr>)}{!visibleBatches.length&&<tr><td colSpan={4}>{batchTab==='edit'?'No batches match this site and search.':batchTab==='close'?'No closed batches match this site and search.':'No open batches match this site and search.'}</td></tr>}</tbody></table></div></div></section>
  {viewed&&<section className="logbook-section vlb-active-batch-panel"><h2>{viewed.name}</h2><div className="vlb-batch-stage-toolbar">{twoStage&&<StageSteps stage={stage}/>}<button type="button" disabled={busy||detailLoading} onClick={clearView}>Show unbatched entries</button></div>
    {(lmvOpen||stage==='vlb_open')&&(onManual||onScan)&&<div className="vlb-batch-actions" role="group" aria-label="Batch entry options">
     <button type="button" aria-pressed={entryFilter==='manual'} disabled={busy||detailLoading} onClick={()=>setEntryFilter(value=>value==='manual'?'':'manual')}>Manual ({entryCounts.manual})</button>
     <button type="button" aria-pressed={entryFilter==='scan'} disabled={busy||detailLoading} onClick={()=>setEntryFilter(value=>value==='scan'?'':'scan')}>Scan ({entryCounts.scan})</button>
     <button type="button" aria-pressed={entryFilter==='upload'} disabled={busy||detailLoading} onClick={()=>setEntryFilter(value=>value==='upload'?'':'upload')}>PDF ({entryCounts.upload})</button>
   </div>}
   {viewed&&twoStage&&<div className="vlb-two-stage">
    {stage==='vlb_open'&&<><div className="vlb-batch-actions"><button type="button" className="vlb-approval-primary" disabled={busy||detailLoading||!viewed.canLockVlb} onClick={()=>lockStage('vlb')}>Lock VLB</button>{onLmvManual&&<button type="button" onClick={()=>onLmvManual(viewed)}>Add LMV manually</button>}{onLmvScan&&<button type="button" onClick={()=>onLmvScan(viewed)}>Scan or upload LMV PDF</button>}<button type="button" disabled={busy} onClick={()=>setNewEquipment(v=>!v)}>{newEquipment?'Hide new equipment form':'Create new equipment'}</button></div>{viewed.lockBlockers?.length>0&&<p className="logbook-message" role="status">Lock VLB is blocked: {viewed.lockBlockers.join(' ')}</p>}</>}
    {lmvOpen&&<div className="vlb-batch-actions">
     {onLmvManual&&<button type="button" onClick={()=>onLmvManual(viewed)}>Add LMV manually</button>}
     {onLmvScan&&<button type="button" onClick={()=>onLmvScan(viewed)}>Scan or upload LMV PDF</button>}
     <button type="button" className="vlb-approval-primary" disabled={busy||detailLoading||!viewed.canLockLmv} onClick={()=>lockStage('lmv')}>Lock LMV</button>
     <button type="button" disabled>ELB entry · Lock LMV first</button>
     {viewed.canUnlockVlb&&<button type="button" disabled={busy} onClick={unlockVlb}>Unlock VLB</button>}
     {viewed.canRequestUnlockOtp&&<button type="button" disabled={busy} onClick={()=>setUnlockOtp(true)}>Unlock VLB (PM OTP)</button>}
    </div>}
    {stage==='elb_open'&&<><div className="vlb-batch-actions">{onEquipmentElb&&!equipmentElbHidden&&<button type="button" className="vlb-approval-primary vlb-open-elb-button" disabled={busy||viewed.canEnterFleet===false} onClick={()=>onEquipmentElb(viewed)}>Process Equipment ELB</button>}<button type="button" aria-expanded={!equipmentElbHidden} aria-controls="vlb-equipment-elb-details" onClick={()=>setEquipmentElbHidden(v=>!v)}>{equipmentElbHidden?'Show Equipment ELB':'Hide Equipment ELB'}</button>{viewed.canUnlockVlb&&<button type="button" disabled={busy} onClick={unlockVlb}>Unlock VLB</button>}{viewed.canRequestUnlockOtp&&<button type="button" disabled={busy} onClick={()=>setUnlockOtp(true)}>Unlock VLB (PM OTP)</button>}<button type="button" disabled={busy||detailLoading||!viewed.canClose} onClick={()=>close(viewed)}>Close &amp; lock ELB</button>{canDeleteManualElb&&<button type="button" disabled={busy||detailLoading} aria-expanded={deleteBatchId===viewed.id} onClick={()=>setDeleteBatchId(id=>id===viewed.id?null:viewed.id)}>Delete manual ELBs</button>}</div>
    {canDeleteManualElb&&deleteBatchId===viewed.id&&<LogBookDeletion key={viewed.id} session={session} context={{manualElbScope:{site:viewed.site,date:viewed.report_date,shift:viewed.shift}}}/>}
     {viewed.canClose===false&&<p role="status">The batch owner or an MIS administrator can close and lock this ELB.</p>}
     <div id="vlb-equipment-elb-details" hidden={equipmentElbHidden}>
     {viewed.fleetProgress&&<p role="status">ELBs saved: {viewed.fleetProgress.saved} · Required remaining: {viewed.fleetProgress.remaining}{viewed.fleetProgress.optionalUnsaved?' · '+viewed.fleetProgress.optionalUnsaved+' optional with no saved ELB':''}{viewed.fleetProgress.skipped?' · '+viewed.fleetProgress.skipped+' skipped':''}{viewed.fleetProgress.drafts?' · '+viewed.fleetProgress.drafts+' draft'+(viewed.fleetProgress.drafts===1?'':'s'):''}{viewed.fleetProgress.loaders?' · '+viewed.fleetProgress.loaders+' loading machine'+(viewed.fleetProgress.loaders===1?'':'s'):''}</p>}
     <div className="logbook-table-wrap"><table className="logbook-table vlb-fleet-table"><thead><tr><th>Door</th><th>Equipment</th><th>Trips</th><th>Status</th><th>Operator</th><th>Caliber ID</th><th>Opening HMR</th><th>Closing HMR</th><th>Working HMR</th><th>BD hours</th><th>Idle hours</th><th>Availability hours</th><th>Job card</th><th>Remarks</th><th>Date</th><th>Site</th><th>Shift</th><th>ELB entry</th></tr></thead><tbody>{(viewed.fleet||[]).map(row=>{const entry=fleetFrontEntry(row,viewed);return <tr key={row.assetId}><td>{row.door}</td><td>{row.equipmentName||'—'}</td><td>{row.trips}</td><td>{entry.status}</td><td>{entry.operator}</td><td>{entry.caliberId}</td><td>{entry.openingHmr}</td><td>{entry.closingHmr}</td><td>{entry.workingHmr}</td><td>{entry.breakdownHours}</td><td>{entry.idleHours}</td><td>{entry.availabilityHours}</td><td>{entry.jobCardNo}</td><td>{entry.remark}</td><td>{entry.bookDate}</td><td>{entry.location}</td><td>{entry.shift}</td><td>{entry.bookNo}</td></tr>})}{!(viewed.fleet||[]).length&&<tr><td colSpan={18}>No machines in the fleet list for this site.</td></tr>}</tbody></table></div>
     </div>
     </>}
    {stage==='closed'&&viewed.canUnlockVlb&&<div className="vlb-batch-actions"><button type="button" disabled={busy} onClick={unlockVlb}>Unlock VLB</button></div>}
    {newEquipment&&stage==='vlb_open'&&<NewEquipmentRequest key={viewed.id} session={session} batch={viewed} onDismiss={()=>setNewEquipment(false)} onCreated={()=>setRefresh(n=>n+1)}/>}
    {viewed.elbRecords?.length>0&&<section aria-label="Saved ELB cards">
     <h3>Saved ELB cards</h3>
     <div className="logbook-table-wrap"><table className="logbook-table">
      <thead><tr><th className="batch-edit-action" scope="col">Action</th><th>Book number</th><th>Equipment / Door</th><th>Operator</th><th>Opening HMR</th><th>Closing HMR</th><th>Job card</th><th>Details</th></tr></thead>
      <tbody>{viewed.elbRecords.map(record=><React.Fragment key={record.id}>
       <tr><td className="batch-edit-action">{action(record,'equipment')}</td><td>{record.book_no}</td>
        <td>{fieldCell(record,'equipment','Equipment',record.data?.door||record.data?.assetName)}</td>
        <td>{fieldCell(record,'equipment','Operator name',record.data?.employeeName)}</td>
        <td>{fieldCell(record,'equipment','Opening HMR',record.data?.openingHmr)}</td>
        <td>{fieldCell(record,'equipment','Closing HMR',record.data?.closingHmr)}</td>
        <td>{fieldCell(record,'equipment','Job Card no.',record.data?.jobCardNo)}</td>
        <td><button type="button" onClick={()=>viewCard(record,'equipment')}>View ELB</button></td>
       </tr>
       {editor(record,'equipment',8)}
      </React.Fragment>)}</tbody>
     </table></div>
    </section>}
    <VlbBatchHolds session={session} batch={viewed} onChanged={()=>setRefresh(n=>n+1)}/>
   </div>}
   {loading||detailLoading?<p role="status">Loading entries…</p>:viewed?<VlbBatchReport key={viewed.id} batch={lmvOpen?{...viewed,records:viewed.lmvRecords||[]}:viewed} bookLabel={lmvOpen?'LMV':'VLB'} ReportSection={ReportSection} onView={record=>viewCard(record,lmvOpen?'lmv':'vehicle')} rowAction={lmvOpen?undefined:record=>action(record,'vehicle')} renderField={lmvOpen?undefined:(record,field,value)=>fieldCell(record,'vehicle',field,value)} rowEditor={lmvOpen?undefined:(record,colSpan)=>editor(record,'vehicle',colSpan)} entryType={entryFilter}/>:<><p>{records.length} cards · {manual} Manual + {records.length-manual} Scan · All included automatically. Each scan entry holds up to 40 cards; this final batch includes all matching saved entries and can exceed 40 cards.</p><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Book number</th><th>Trip card</th><th>Vehicle</th><th>Driver</th><th>Source</th></tr></thead><tbody>{records.map(r=><tr key={r.id}><td>{r.book_no}</td><td>{r.data.aFormNo||'—'}</td><td>{r.data.door||'—'}</td><td>{r.data.employeeName||'—'}</td><td>{vlbRecordSource(r)}</td></tr>)}{!records.length&&<tr><td colSpan={5}>{selection.site&&selection.date&&selection.shift?'No saved, unbatched entries match this selection.':'Select site, date and shift to load saved entries.'}</td></tr>}</tbody></table></div></>}
  </section>}

  {viewed&&selectedCard&&<VlbBatchCardDetails key={viewed.id+":"+selectedCard.viewKey} kind={selectedCard.kind} onClose={()=>{setSelectedCard(null);document.querySelector(".vlb-active-batch-panel")?.scrollIntoView({block:"start"})}} session={session} batch={viewed} record={selectedCard} ReportSection={ReportSection}/> }
  <VlbBatchGovernance session={session} batch={viewed} actor={actor} refresh={refresh} onChanged={changed} onManual={twoStage&&stage!=='vlb_open'?undefined:onManual} onScan={twoStage&&stage!=='vlb_open'?undefined:onScan} onRequestReopen={()=>setShowApproval(true)} onApprovals={onApprovals}/>
  {unlockOtp&&viewed&&['lmv_open','elb_open'].includes(stage)&&<VlbUnlockOtpDialog key={viewed.id} session={session} batch={viewed} onChanged={async batch=>{++detailRequest.current;setDetailLoading(false);setViewed(batch);setOpenBatch(batch.closed_at?null:batch);setRefresh(n=>n+1)}} onDismiss={()=>setUnlockOtp(false)}/>}
  {showApproval&&viewed?.closed_at&&<VlbReopenDialog key={viewed.id+':'+viewed.closure_revision} session={session} batch={viewed} actor={actor} onChanged={changed} onDismiss={()=>setShowApproval(false)}/>}
 </section>;
}
export function availableShifts(options,selection){
 const found=new Map();
 for(const shift of options.shifts||[]){
  if(canonicalSiteName(shift.site)!==canonicalSiteName(selection.site)||shift.sourceMissing||String(shift.status).toLowerCase()==='inactive'||(shift.effectiveFrom&&shift.effectiveFrom>selection.date)||(shift.effectiveTo&&shift.effectiveTo<selection.date))continue;
  const code=bookShiftCode(shift.shiftCode)||bookShiftCode(shift.name);if(code&&!found.has(code))found.set(code,{code,name:shift.name});
 }
 return [...found.values()];
}
export function stageLabel(stage,batch){
 if(stage==='lmv_open')return 'LMV open';
 if(stage==='elb_open')return 'ELB open';
 if(stage==='closed'||batch?.closed_at)return 'ELB locked · Batch closed';
 if(stage==='vlb_open')return 'VLB open';
 return batch?.amendment_by?'Reopened':'Open';
}
export function StageSteps({stage}){
 return <ol className="vlb-stage-steps" aria-label="Batch stage">{[['vlb_open','1 VLB open'],['lmv_open','2 LMV open'],['elb_open','3 ELB open'],['closed','4 ELB locked · Batch closed']].map(([key,label])=><li key={key} aria-current={stage===key?'step':undefined} className={stage===key?'current':undefined}>{label}</li>)}</ol>;
}
const shown=value=>value===0||String(value??'').trim()?String(value):'—';
export function fleetFrontEntry(row={},batch={}){
 const data=row.logbook||{},opening=Number(data.openingHmr),closing=Number(data.closingHmr);
 const calculated=Number.isFinite(opening)&&Number.isFinite(closing)?Math.round((closing-opening)*1000)/1000:null;
 return {status:row.saved_at&&row.shift_status?(batch.statuses?.[row.shift_status]?.label||row.shift_status):row.tripExempt?'Trip-exempt':row.skipped?'Skipped':'Not saved',operator:shown(row.shiftSummary?.operator||data.employeeName),caliberId:shown(data.caliberId),openingHmr:shown(row.shiftSummary?.openingHmr??data.openingHmr),closingHmr:shown(row.shiftSummary?.closingHmr??data.closingHmr),workingHmr:shown(row.shiftSummary?.hours??data.totalWorkingHmr??calculated),breakdownHours:shown(data.breakdownHours),idleHours:shown(data.idleHours),availabilityHours:shown(data.availabilityHours),jobCardNo:shown(data.jobCardNo),remark:shown(data.remark||data.statusReason),bookDate:shown(data.bookDate||batch.report_date),location:shown(data.location||displaySiteName(batch.site)),shift:shown(data.shiftName||batch.shift),bookNo:row.saved_at?shown(row.shiftSummary?.bookNo||row.book_no):'—'};
}
export function openVlbEntryBatches(batches,site,kind='vehicle'){
 if(!site)return [];
 return batches.filter(batch=>!batch.archived_at&&!batch.deleted_at&&canonicalSiteName(batch.site)===canonicalSiteName(site)&&(kind!=='lmv'||(!batch.closed_at&&(['vlb_open','lmv_open','open'].includes(batch.stage))))&&(kind!=='vehicle'||(!batch.closed_at&&(batch.twoStage!==true||batch.stage==='vlb_open'))));
}

export function preferredVlbEntryBatch(batches,remembered){
 const open=batches.filter(batch=>!batch.closed_at);
 if(open.length===1)return open[0];
 return open.find(batch=>batch.id===remembered)||null;
}
