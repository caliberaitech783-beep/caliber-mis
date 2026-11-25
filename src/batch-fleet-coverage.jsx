import React,{useState} from 'react';

// Every machine of the site needs an answer for the shift (owner, 25 Nov 2026). For now the batch page
// only shows how many VLB, ELB and LMV machines have one and which have none yet; nothing is stopped.
const FIGURES=[
 {key:'total',label:'Machines at site'},
 {key:'answered',label:'Card saved'},
 {key:'remaining',label:'No card yet'},
 {key:'otherSite',label:'From another site'},
];
const ANSWER_LABEL={card:'Card saved','':'No card yet'};

export default function BatchFleetCoverage({coverage,ReportSection,batchName}){
 const [picked,setPicked]=useState(null);// {book,view}
 if(!coverage||!ReportSection)return null;
 const books=['vlb','elb','lmv'].map(key=>coverage.books?.[key]).filter(Boolean);
 const open=(book,view)=>setPicked(now=>now?.book===book&&now?.view===view?null:{book,view});
 const figure=key=>row=>row[key]>0
  ?<button type="button" className="cr-figure" title={'Open: '+row.label+' · '+FIGURES.find(one=>one.key===key).label} onClick={event=>{event.stopPropagation();open(row.book,key);}}>{row[key]}</button>
  :row[key];
 const columns=[
  {key:'label',label:'Book',value:row=>row.label},
  ...FIGURES.map(one=>({key:one.key,label:one.label,value:row=>row[one.key],render:figure(one.key)})),
  {key:'state',label:'Status',value:row=>row.complete?'All answered':'Warning'},
 ];
 const book=picked&&coverage.books?.[picked.book];
 const lines=!book?[]:book.rows.filter(row=>picked.view==='answered'?row.atSite&&row.answer:picked.view==='remaining'?!row.answer:picked.view==='otherSite'?!row.atSite:row.atSite);
 const lineColumns=[
  {key:'door',label:'Door',value:row=>row.door},
  {key:'name',label:'Machine',value:row=>row.name},
  {key:'answer',label:'Answer',value:row=>ANSWER_LABEL[row.answer]??row.answer},
  {key:'cards',label:'Card no.',value:row=>row.cards.join(', ')},
  {key:'site',label:'Master site',value:row=>row.atSite?'This site':'Another site'},
 ];
 const viewLabel=picked&&FIGURES.find(one=>one.key===picked.view)?.label;
 return <section className="batch-fleet-coverage" aria-label="Machine coverage">
  <p className={'logbook-message'+(coverage.complete?'':' batch-coverage-warning')} role="status">
   {coverage.complete?'Every VLB, ELB and LMV machine of this site has a card for this shift.':'Warning only, nothing is stopped yet: '+coverage.warnings.join(' ')}
  </p>
  <ReportSection key="coverage-books" title={'Step 1 · Machine coverage · '+batchName} category="batch-fleet-coverage" rows={books} columns={columns} rowKey={row=>row.book}
   rowClassName={row=>picked?.book===row.book?'report-row-picked':''} showSearch={false} recordDateFilter={false} emptyMessage="No machines in the Equipment Master for this site."/>
  {book&&<ReportSection key={'coverage-'+picked.book+picked.view} title={'Step 2 · '+book.label+' · '+viewLabel+' · '+batchName} category="batch-fleet-coverage-machines" rows={lines} columns={lineColumns}
   rowKey={row=>row.assetId} showSearch={false} recordDateFilter={false} emptyMessage="No machine in this list."/>}
 </section>;
}
