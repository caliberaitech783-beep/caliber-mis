import React,{useState} from 'react';
import {coverageStopNote} from '../shared/batch-coverage-stop.mjs';

// Every machine of the site needs an answer for the shift (owner, 25 Nov 2026). The batch page shows how many VLB,
// ELB and LMV machines have one. What Pulse-1 holds for the shift is read by itself for every VLB and LMV machine:
// a whole-shift breakdown / maintenance or an idle request answers it, and the Pulse-1 column shows it. Only the
// machines with nothing in Pulse-1 and no card take an idle reason by hand in Step 2. From the stop date Lock VLB,
// Lock LMV and Close batch wait for every answer (shared/batch-coverage-stop.mjs); before it the page only warns.
const FIGURES=[
 {key:'total',label:'Machines at site'},
 {key:'cards',label:'Card saved'},
 {key:'pulse',label:'Breakdown / maintenance (Pulse-1)'},
 {key:'idle',label:'Idle (Pulse-1 or reason)'},
 {key:'remaining',label:'No answer yet'},
 {key:'otherSite',label:'From another site'},
];
const BY_HAND=new Set(['card','pulse','pulse_idle']);
const inView=(row,view)=>view==='cards'?row.atSite&&row.answer==='card'
 :view==='pulse'?row.atSite&&row.answer==='pulse'
 :view==='idle'?row.atSite&&(row.answer==='pulse_idle'||Boolean(row.answer)&&!BY_HAND.has(row.answer))
 :view==='remaining'?!row.answer
 :view==='otherSite'?!row.atSite
 :row.atSite;
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

function AnswerBox({row,book,reasons,onSave,onClear,busy}){
 const [status,setStatus]=useState(row.saved&&reasons[row.saved.status]?row.saved.status:'');
 const [reason,setReason]=useState(row.saved&&reasons[row.saved.status]?row.saved.reason:'');
 return <div className="batch-answer-box">
  <select aria-label={'Idle reason for '+row.door} value={status} disabled={busy} onChange={e=>setStatus(e.target.value)}>
   <option value="">Idle reason…</option>
   {Object.entries(reasons).map(([key,label])=><option key={key} value={key}>{label}</option>)}
  </select>
  <input type="text" aria-label={'Reason details for '+row.door} placeholder="Reason" maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/>
  <button type="button" disabled={busy||!status||reason.trim().length<3} onClick={()=>onSave(row,{book,status,reason})}>Save</button>
  {row.saved&&<button type="button" disabled={busy} onClick={()=>onClear(row)}>Clear</button>}
 </div>;
}

export default function BatchFleetCoverage({coverage,ReportSection,batch,session,onChanged}){
 const [picked,setPicked]=useState(null);// {book,view}
 const [working,setWorking]=useState(''),[said,setSaid]=useState(null);
 if(!coverage||!ReportSection)return null;
 const reasons=coverage.idleReasons||{},labels=coverage.answerLabels||{};
 const books=['vlb','elb','lmv'].map(key=>coverage.books?.[key]).filter(Boolean);
 const open=(book,view)=>{setSaid(null);setPicked(now=>now?.book===book&&now?.view===view?null:{book,view});};
 const figure=key=>row=>row[key]>0
  ?<button type="button" className="cr-figure" title={'Open: '+row.label+' · '+FIGURES.find(one=>one.key===key).label} onClick={event=>{event.stopPropagation();open(row.book,key);}}>{row[key]}</button>
  :(row[key]??0);
 const columns=[
  {key:'label',label:'Book',value:row=>row.label},
  ...FIGURES.map(one=>({key:one.key,label:one.label,value:row=>row[one.key]??0,render:figure(one.key)})),
  {key:'state',label:'Status',value:row=>row.complete?'All answered':'Warning'},
 ];
 const editable=Boolean(session&&batch&&!batch.closed_at);
 const call=async(method,path,body)=>{
  const response=await fetch('/api/vlb-batches/'+encodeURIComponent(batch.id)+'/machines/'+path,{method,cache:'no-store',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const answer=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(answer.error||'The machine answer could not be saved.');
  return answer;
 };
 const run=async(row,job,message)=>{
  setWorking(row.assetId);setSaid(null);
  try{await job();setSaid({id:row.assetId,text:row.door+': '+message});onChanged?.();}
  catch(error){setSaid({id:row.assetId,text:row.door+': '+error.message,bad:true});}
  finally{setWorking('');}
 };
 const book=picked&&coverage.books?.[picked.book];
 const onSave=(row,body)=>run(row,()=>call('PUT',encodeURIComponent(row.assetId)+'/answer',body),'Idle reason saved.');
 const onClear=row=>run(row,()=>call('DELETE',encodeURIComponent(row.assetId)+'/answer'),'Answer cleared.');
 const lines=!book?[]:book.rows.filter(row=>inView(row,picked.view));
 const answerText=row=>{
  const label=labels[row.answer]||(row.note?row.note:'No answer yet');
  const saved=row.saved&&!BY_HAND.has(row.answer)?row.saved:null;
  return saved?label+(saved.reason?' · '+saved.reason:''):label;
 };
 // A machine answered by its card or by Pulse-1 needs nothing by hand; a reason saved by hand can be changed or cleared.
 const needsHand=row=>row.atSite&&(!row.answer||Boolean(row.saved)&&!BY_HAND.has(row.answer));
 const lineColumns=[
  {key:'door',label:'Door',value:row=>row.door},
  {key:'name',label:'Machine',value:row=>row.name},
  {key:'answer',label:'Answer',value:answerText},
  ...(book?.takesAnswers?[{key:'pulse',label:'Pulse-1 (this shift)',value:row=>coverage.pulseRead?.ok?pulseText(row):'Not read'}]:[]),
  {key:'cards',label:'Card no.',value:row=>row.cards.join(', ')},
  {key:'site',label:'Master site',value:row=>row.atSite?'This site':'Another site'},
  ...(editable&&book?.takesAnswers?[{key:'action',label:'Answer this machine',value:()=>'',render:row=>needsHand(row)&&<>
   <AnswerBox key={row.assetId+':'+(row.saved?.status||'')} row={row} book={picked.book} reasons={reasons} busy={Boolean(working)} onSave={onSave} onClear={onClear}/>
   {said?.id===row.assetId&&<small className={'cr-said'+(said.bad?' cr-said-bad':'')} role={said.bad?'alert':'status'}>{said.text}</small>}
  </>}]:[]),
 ];
 const viewLabel=picked&&FIGURES.find(one=>one.key===picked.view)?.label;
 const pulseRead=coverage.pulseRead;
 return <section className="batch-fleet-coverage" aria-label="Machine coverage">
  <p className={'logbook-message'+(coverage.complete?'':coverage.mode==='stop'?' batch-coverage-stop':' batch-coverage-warning')} role={coverage.complete?'status':coverage.mode==='stop'?'alert':'status'}>
   {coverage.complete?'Every VLB, ELB and LMV machine of this site has an answer for this shift.':coverageStopNote(coverage.stop)+' '+coverage.warnings.join(' ')}
  </p>
  {pulseRead&&<p className={'logbook-message'+(pulseRead.ok?'':' batch-coverage-warning')} role="status">
   {pulseRead.ok?'Breakdown, maintenance and idle are read from Pulse-1 (pulse.cmll.in) for every VLB and LMV machine'+(time(pulseRead.readAt)?', copy of '+time(pulseRead.readAt):'')+'.':'Pulse-1 could not be read just now ('+pulseRead.error+'): machines in breakdown or idle there are not counted until it is read again.'}
  </p>}
  <ReportSection key="coverage-books" title={'Step 1 · Machine coverage · '+(batch?.name||'')} category="batch-fleet-coverage" rows={books} columns={columns} rowKey={row=>row.book}
   rowClassName={row=>picked?.book===row.book?'report-row-picked':''} showSearch={false} recordDateFilter={false} emptyMessage="No machines in the Equipment Master for this site."/>
  {book&&<ReportSection key={'coverage-'+picked.book+picked.view} title={'Step 2 · '+book.label+' · '+viewLabel+' · '+(batch?.name||'')} category="batch-fleet-coverage-machines" rows={lines} columns={lineColumns}
   rowKey={row=>row.assetId} showSearch={false} recordDateFilter={false} emptyMessage="No machine in this list."/>}
  {book&&!book.takesAnswers&&<p className="logbook-message">An ELB machine is answered on the Equipment ELB fleet list (working, breakdown, maintenance, no operator or not in use); its breakdown hours come from Pulse-1 there.</p>}
 </section>;
}
