import React,{useState} from 'react';
import {coverageStopNote} from '../shared/batch-coverage-stop.mjs';

// Machine roster of the batch (owner, 25-26 Nov 2026). Every VLB, ELB and LMV machine of the site needs an answer for the
// shift. Each machine shows its code: T trip card, BD breakdown / maintenance (Pulse-1, the ELB list, or by hand), ID idle
// (Pulse-1 or by hand), NA no answer yet. What Pulse-1 holds is read by itself. Step 1 has one line per book; pressing a
// line or a figure opens that book's roster under it (the three books apart, each with its own tick boxes). The MIS user
// ticks machines and gives one answer to every ticked NA machine. From the stop date Lock VLB, Lock LMV and Close batch
// wait for every answer (shared/batch-coverage-stop.mjs); before it the page only warns.
const CODES=['T','BD','ID','NA'];
const CODE_LABELS={T:'T · Trip card',BD:'BD · Breakdown / maintenance',ID:'ID · Idle',NA:'NA · No answer'};
const BY_CARD_OR_PULSE=new Set(['card','pulse','pulse_idle']);
const time=value=>{const d=value?new Date(value):null;return d&&!Number.isNaN(d.getTime())?d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}):'';};

// What Pulse-1 holds for the machine in this shift.
export function pulseText(row){
 const p=row.pulse;
 if(!p)return 'Nothing in Pulse-1';
 const parts=[];
 if(p.breakdownHours>0)parts.push((p.wholeShift?'Breakdown / maintenance, whole shift':'Breakdown / maintenance')+' · '+p.breakdownHours+' of '+p.shiftHours+' h'+(p.references.length?' · '+p.references.join(', '):'')+(p.reason?' · '+p.reason:''));
 if(p.idle)parts.push('Idle: '+p.idle.reason+(p.idle.reference?' · '+p.idle.reference:'')+(p.idle.remarks?' · '+p.idle.remarks:''));
 return parts.join(' | ');
}

// A machine whose answer the MIS user may give or change: no answer yet, or an answer saved by hand.
export const takesHandAnswer=row=>Boolean(row.atSite)&&(!row.answer||Boolean(row.saved)&&!BY_CARD_OR_PULSE.has(row.answer));
const codeChip=code=><span className={'roster-code roster-code-'+code} title={CODE_LABELS[code]}>{code}</span>;

function BulkBar({book,rows,ticked,setTicked,reasons,busy,onSave,onClear,said,editable}){
 const [status,setStatus]=useState(''),[reason,setReason]=useState(''),[issue,setIssue]=useState('');
 const tickedRows=rows.filter(row=>ticked.has(row.assetId));
 const open=tickedRows.filter(takesHandAnswer),byHand=tickedRows.filter(row=>row.saved&&takesHandAnswer(row)&&row.answer);
 const tickAll=()=>setTicked(new Set(rows.map(row=>row.assetId)));
 const tickNa=()=>setTicked(new Set(rows.filter(row=>row.code==='NA').map(row=>row.assetId)));
 const save=()=>{
  if(!tickedRows.length)return setIssue('Tick at least one machine.');
  if(!open.length)return setIssue('The ticked machines have T, BD or ID from a card or Pulse-1; nothing to fill.');
  if(!status)return setIssue('Choose the answer.');
  if(reason.trim().length<3)return setIssue('Write the reason (at least 3 letters).');
  setIssue('');onSave(book,open,{status,reason:reason.trim()},()=>{setStatus('');setReason('');});
 };
 const left=tickedRows.length-open.length;
 return <div className="roster-bulk-bar">
  <button type="button" disabled={busy} onClick={tickAll}>Tick all ({rows.length})</button>
  <button type="button" disabled={busy} onClick={tickNa}>Tick all NA ({rows.filter(row=>row.code==='NA').length})</button>
  {ticked.size>0&&<button type="button" disabled={busy} onClick={()=>setTicked(new Set())}>Untick all</button>}
  <span className="roster-ticked">{tickedRows.length} ticked{left>0?' · '+left+' already answered by card or Pulse-1, left as they are':''}</span>
  {editable&&<>
   <select aria-label={'Answer for ticked '+book.label+' machines'} value={status} disabled={busy} onChange={event=>{setStatus(event.target.value);setIssue('');}}>
    <option value="">Answer for ticked…</option>
    {Object.entries(reasons).map(([key,label])=><option key={key} value={key}>{label}</option>)}
   </select>
   <input type="text" aria-label={'Reason for ticked '+book.label+' machines'} placeholder="Reason" maxLength={500} value={reason} disabled={busy} onChange={event=>{setReason(event.target.value);setIssue('');}}/>
   <button type="button" className="primary" disabled={busy} onClick={save}>Save for ticked ({open.length})</button>
   {byHand.length>0&&<button type="button" disabled={busy} onClick={()=>onClear(book,byHand)}>Clear answer ({byHand.length})</button>}
  </>}
  {issue&&<small className="cr-said cr-said-bad" role="alert">{issue}</small>}
  {said?.book===book.book&&<small className={'cr-said'+(said.bad?' cr-said-bad':'')} role={said.bad?'alert':'status'}>{said.text}</small>}
 </div>;
}

export default function BatchFleetCoverage({coverage,ReportSection,batch,session,onChanged}){
 const [opened,setOpened]=useState({});// book -> 'all' | T | BD | ID | NA
 const [ticks,setTicks]=useState({});// book -> Set of assetIds
 const [working,setWorking]=useState(false),[said,setSaid]=useState(null);
 if(!coverage||!ReportSection)return null;
 const reasons=coverage.idleReasons||{},labels=coverage.answerLabels||{};
 const books=['vlb','elb','lmv'].map(key=>coverage.books?.[key]).filter(Boolean);
 const editable=Boolean(session&&batch&&!batch.closed_at);
 const openBook=(book,view)=>setOpened(now=>{const next={...now};if(next[book]===view)delete next[book];else next[book]=view;return next;});
 const figure=view=>row=>{
  const value=view==='all'?row.total:row.codes?.[view]??0;
  return value>0?<button type="button" className="cr-figure" title={'Open: '+row.label+' · '+(CODE_LABELS[view]||'All machines')} onClick={event=>{event.stopPropagation();openBook(row.book,view);}}>{value}</button>:value;
 };
 const columns=[
  {key:'label',label:'Book',value:row=>row.label},
  {key:'total',label:'Machines at site',value:row=>row.total,render:figure('all')},
  ...CODES.map(code=>({key:'code'+code,label:CODE_LABELS[code],value:row=>row.codes?.[code]??0,render:figure(code)})),
  {key:'otherSite',label:'Card of a machine from another site',value:row=>row.otherSite??0},
  {key:'state',label:'Status',value:row=>row.complete?'Complete':'Not complete: '+row.remaining+' NA'},
 ];
 const call=async(method,path,body)=>{
  const response=await fetch('/api/vlb-batches/'+encodeURIComponent(batch.id)+'/machines/'+path,{method,cache:'no-store',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const answer=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(answer.error||'The machine answer could not be saved.');
  return answer;
 };
 const run=async(book,job,message,done)=>{
  setWorking(true);setSaid(null);
  try{const answer=await job();setSaid({book:book.book,text:message(answer)});setTicks(now=>({...now,[book.book]:new Set()}));done?.();onChanged?.();}
  catch(error){setSaid({book:book.book,text:error.message,bad:true});}
  finally{setWorking(false);}
 };
 const onSave=(book,rows,{status,reason},done)=>run(book,()=>call('PUT','answers',{book:book.book,status,reason,assetIds:rows.map(row=>row.assetId)}),
  answer=>(answer.saved||rows.length)+' '+book.label+' machine'+((answer.saved||rows.length)===1?'':'s')+': '+(reasons[status]||status)+' saved.',done);
 const onClear=(book,rows)=>run(book,()=>call('POST','answers/clear',{assetIds:rows.map(row=>row.assetId)}),answer=>(answer.cleared??rows.length)+' answer(s) cleared.');
 const answerText=row=>{
  if(row.answer==='card')return (row.cards.length?'Card '+row.cards.join(', '):'Card saved')+(row.fleetStatus&&row.code!=='T'?' · '+(labels[row.fleetStatus]||row.fleetStatus.replace(/_/g,' ')):'');
  const label=labels[row.answer]||(row.note?row.note:'No answer: fill the detail');
  const saved=row.saved&&!BY_CARD_OR_PULSE.has(row.answer)?row.saved:null;
  return saved?label+(saved.reason?' · '+saved.reason:'')+(saved.savedBy?' · by '+saved.savedBy:''):label;
 };
 const pulseRead=coverage.pulseRead;
 const lineColumns=(book,ticked,setTicked)=>[
  {key:'tick',label:'Tick',value:()=>'',render:row=><input type="checkbox" aria-label={'Tick '+row.door} checked={ticked.has(row.assetId)} disabled={working}
   onChange={event=>setTicked(now=>{const next=new Set(now);if(event.target.checked)next.add(row.assetId);else next.delete(row.assetId);return next;})}/>},
  {key:'door',label:'Door',value:row=>row.door},
  {key:'code',label:'Status',value:row=>row.code,render:row=>codeChip(row.code)},
  {key:'name',label:'Machine',value:row=>row.name},
  {key:'answer',label:'Detail',value:answerText},
  {key:'pulse',label:'Pulse-1 (this shift)',value:row=>pulseRead?.ok?pulseText(row):'Not read'},
  {key:'site',label:'Master site',value:row=>row.atSite?'This site':'Another site'},
 ];
 return <section className="batch-fleet-coverage" aria-label="Machine roster">
  <p className={'logbook-message'+(coverage.complete?'':coverage.mode==='stop'?' batch-coverage-stop':' batch-coverage-warning')} role={coverage.complete?'status':coverage.mode==='stop'?'alert':'status'}>
   {coverage.complete?'Every VLB, ELB and LMV machine of this site has an answer for this shift (T, BD or ID).':coverageStopNote(coverage.stop)+' '+coverage.warnings.join(' ')}
  </p>
  {pulseRead&&<p className={'logbook-message'+(pulseRead.ok?'':' batch-coverage-warning')} role="status">
   {pulseRead.ok?'Breakdown, maintenance and idle are read from Pulse-1 (pulse.cmll.in) for every VLB, ELB and LMV machine'+(time(pulseRead.readAt)?', copy of '+time(pulseRead.readAt):'')+'.':'Pulse-1 could not be read just now ('+pulseRead.error+'): machines in breakdown or idle there are not counted until it is read again.'}
  </p>}
  <ReportSection key="coverage-books" title={'Step 1 · Machine roster · '+(batch?.name||'')} category="batch-fleet-coverage" rows={books} columns={columns} rowKey={row=>row.book}
   rowClassName={row=>opened[row.book]?'report-row-picked':''} onRowClick={row=>openBook(row.book,opened[row.book]?opened[row.book]:'all')} showSearch={false} recordDateFilter={false} emptyMessage="No machines in the Equipment Master for this site."/>
  {books.filter(book=>opened[book.book]).map(book=>{
   const view=opened[book.book],ticked=ticks[book.book]||new Set();
   const setTicked=update=>setTicks(now=>({...now,[book.book]:typeof update==='function'?update(now[book.book]||new Set()):update}));
   const rows=book.rows.filter(row=>view==='all'?true:row.atSite&&row.code===view);
   return <ReportSection key={'roster-'+book.book+view} title={'Step 2 · '+book.label+' roster · '+(CODE_LABELS[view]||'All machines')+' · '+(batch?.name||'')} category="batch-fleet-coverage-machines"
    rows={rows} columns={lineColumns(book,ticked,setTicked)} rowKey={row=>row.assetId} rowClassName={row=>ticked.has(row.assetId)?'roster-row-ticked':''}
    controls={<BulkBar book={book} rows={rows} ticked={ticked} setTicked={setTicked} reasons={reasons} busy={working} onSave={onSave} onClear={onClear} said={said} editable={editable}/>}
    showSearch={false} recordDateFilter={false} emptyMessage="No machine in this list."/>;
  })}
 </section>;
}
