import React,{useState} from 'react';

// Every machine of the site needs an answer for the shift (owner, 25 Nov 2026). The batch page shows how many VLB,
// ELB and LMV machines have one. A VLB or LMV machine with no card is answered in Step 2: its breakdown read from
// Pulse-1, or an idle reason. It only warns; nothing is stopped yet.
const FIGURES=[
 {key:'total',label:'Machines at site'},
 {key:'cards',label:'Card saved'},
 {key:'pulse',label:'Breakdown (Pulse-1)'},
 {key:'idle',label:'Idle reason'},
 {key:'remaining',label:'No answer yet'},
 {key:'otherSite',label:'From another site'},
];
const inView=(row,view)=>view==='cards'?row.atSite&&row.answer==='card'
 :view==='pulse'?row.atSite&&row.answer==='pulse'
 :view==='idle'?row.atSite&&Boolean(row.answer)&&!['card','pulse'].includes(row.answer)
 :view==='remaining'?!row.answer
 :view==='otherSite'?!row.atSite
 :row.atSite;

function AnswerBox({row,book,reasons,onSave,onPulse,onClear,busy}){
 const [status,setStatus]=useState(row.saved&&reasons[row.saved.status]?row.saved.status:'');
 const [reason,setReason]=useState(row.saved&&reasons[row.saved.status]?row.saved.reason:'');
 if(row.answer==='card')return null;
 return <div className="batch-answer-box">
  <button type="button" disabled={busy} onClick={()=>onPulse(row)}>Fetch Pulse-1</button>
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
 const run=async(row,job)=>{
  setWorking(row.assetId);setSaid(null);
  try{const answer=await job();setSaid({id:row.assetId,text:row.door+': '+(answer.message||'Saved.')});onChanged?.();}
  catch(error){setSaid({id:row.assetId,text:row.door+': '+error.message,bad:true});}
  finally{setWorking('');}
 };
 const book=picked&&coverage.books?.[picked.book];
 const onPulse=row=>run(row,()=>call('POST',encodeURIComponent(row.assetId)+'/pulse',{book:picked.book}));
 const onSave=(row,body)=>run(row,()=>call('PUT',encodeURIComponent(row.assetId)+'/answer',body).then(()=>({message:'Idle reason saved.'})));
 const onClear=row=>run(row,()=>call('DELETE',encodeURIComponent(row.assetId)+'/answer').then(()=>({message:'Answer cleared.'})));
 // "Fetch Pulse-1 for all": one machine after another, so the site's Pulse-1 is not asked for every machine at once.
 const fetchAll=async rows=>{
  setSaid(null);let answered=0,failed=0;
  for(const row of rows){
   setWorking(row.assetId);
   try{const answer=await call('POST',encodeURIComponent(row.assetId)+'/pulse',{book:picked.book});if(answer.saved&&answer.status==='pulse')answered++;}
   catch{failed++;}
  }
  setWorking('');
  setSaid({id:'all',text:'Pulse-1 read for '+rows.length+' machines: '+answered+' answered with a whole-shift breakdown'+(failed?', '+failed+' could not be read':'')+'.',bad:failed>0});
  onChanged?.();
 };
 const lines=!book?[]:book.rows.filter(row=>inView(row,picked.view));
 const answerText=row=>{
  const label=labels[row.answer]||(row.note?row.note:'No answer yet');
  const saved=row.saved&&row.answer!=='card'?row.saved:null;
  return saved?label+(saved.breakdownHours!=null?' · '+saved.breakdownHours+' of '+saved.shiftHours+' h':'')+(saved.reason?' · '+saved.reason:''):label;
 };
 const lineColumns=[
  {key:'door',label:'Door',value:row=>row.door},
  {key:'name',label:'Machine',value:row=>row.name},
  {key:'answer',label:'Answer',value:answerText},
  {key:'cards',label:'Card no.',value:row=>row.cards.join(', ')},
  {key:'site',label:'Master site',value:row=>row.atSite?'This site':'Another site'},
  ...(editable&&book?.takesAnswers?[{key:'action',label:'Answer this machine',value:()=>'',render:row=>row.atSite&&<>
   <AnswerBox key={row.assetId+':'+(row.saved?.status||'')} row={row} book={picked.book} reasons={reasons} busy={Boolean(working)} onPulse={onPulse} onSave={onSave} onClear={onClear}/>
   {said?.id===row.assetId&&<small className={'cr-said'+(said.bad?' cr-said-bad':'')} role={said.bad?'alert':'status'}>{said.text}</small>}
  </>}]:[]),
 ];
 const viewLabel=picked&&FIGURES.find(one=>one.key===picked.view)?.label;
 const unanswered=book?.takesAnswers?book.rows.filter(row=>row.atSite&&!row.answer):[];
 return <section className="batch-fleet-coverage" aria-label="Machine coverage">
  <p className={'logbook-message'+(coverage.complete?'':' batch-coverage-warning')} role="status">
   {coverage.complete?'Every VLB, ELB and LMV machine of this site has an answer for this shift.':'Warning only, nothing is stopped yet: '+coverage.warnings.join(' ')}
  </p>
  <ReportSection key="coverage-books" title={'Step 1 · Machine coverage · '+(batch?.name||'')} category="batch-fleet-coverage" rows={books} columns={columns} rowKey={row=>row.book}
   rowClassName={row=>picked?.book===row.book?'report-row-picked':''} showSearch={false} recordDateFilter={false} emptyMessage="No machines in the Equipment Master for this site."/>
  {book&&<ReportSection key={'coverage-'+picked.book+picked.view} title={'Step 2 · '+book.label+' · '+viewLabel+' · '+(batch?.name||'')} category="batch-fleet-coverage-machines" rows={lines} columns={lineColumns}
   rowKey={row=>row.assetId} showSearch={false} recordDateFilter={false} emptyMessage="No machine in this list."/>}
  {book&&!book.takesAnswers&&<p className="logbook-message">An ELB machine is answered on the Equipment ELB fleet list (working, breakdown, maintenance, no operator or not in use).</p>}
  {editable&&book?.takesAnswers&&unanswered.length>0&&<div className="vlb-batch-actions">
   <button type="button" disabled={Boolean(working)} onClick={()=>fetchAll(unanswered)}>Fetch Pulse-1 for all {unanswered.length} {book.label} machines with no answer</button>
  </div>}
  {said?.id==='all'&&<p className={'logbook-message'+(said.bad?' batch-coverage-warning':'')} role="status">{said.text}</p>}
 </section>;
}
