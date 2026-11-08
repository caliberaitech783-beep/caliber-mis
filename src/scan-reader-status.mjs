export function scanProgressNeedsValidation(rows=[],previousRows=[]){
 const previousById=new Map((previousRows||[]).map(card=>[card.id,card]));
 return rows.some(row=>{
  if(!['review','approved','error'].includes(row.status))return false;
  const previous=previousById.get(row.id);
  return !previous||previous.revision!==row.revision||previous.status!==row.status
   ||previous.raw_fields?.fleetReview?.checkedAt!==row.raw_fields?.fleetReview?.checkedAt
   ||(!previous.checks&&!previous.validationPending);
 });
}
// A progress poll carries only identity, status, revision and the fleet check
// time of each card. Any difference from the cards on screen, or a different
// card list, means the full entry must be read again; otherwise nothing changes.
export function scanProgressChanged(rows=[],previousRows=[]){
 const previous=previousRows||[];
 if(!Array.isArray(rows)||rows.length!==previous.length)return true;
 const previousById=new Map(previous.map(card=>[card.id,card]));
 return rows.some(row=>{
  const prior=previousById.get(row.id);
  if(!prior||prior.status!==row.status)return true;
  // A reading card changes revision with every extraction stage; the stage is merged on its own.
  if(row.status==='reading')return false;
  return prior.revision!==row.revision||prior.raw_fields?.fleetReview?.checkedAt!==row.raw_fields?.fleetReview?.checkedAt;
 });
}
// Reading cards report their extraction stage without a revision change; the
// label on screen follows it without reloading the whole entry.
export function mergeScanProgressStages(cards,rows=[]){
 const stages=new Map((rows||[]).filter(row=>row.status==='reading').map(row=>[row.id,row.raw_fields?.scanProgress]));
 let changed=false;
 const next=cards.map(card=>{
  if(card.status!=='reading'||!stages.has(card.id))return card;
  const stage=stages.get(card.id);
  if(JSON.stringify(stage??null)===JSON.stringify(card.raw_fields?.scanProgress??null))return card;
  changed=true;return {...card,raw_fields:{...card.raw_fields,scanProgress:stage}};
 });
 return changed?next:cards;
}
export function chooseScanCard(cards,current,requested,{dirty=false}={}){const existing=cards.find(c=>c.id===current);if(existing&&(dirty||!['queued','reading'].includes(existing.status)))return current;if(!existing&&requested&&cards.some(c=>c.id===requested))return requested;return cards.find(c=>c.status==='review')?.id||existing?.id||cards[0]?.id||'';}
export function scanStatusLabels(provider){return {queued:['gemini','gemini-hybrid'].includes(provider)?'Waiting for Gemini':'Waiting for OCR',reading:['gemini','gemini-hybrid'].includes(provider)?'Gemini extraction':'Reading handwriting',review:'Needs checking',approved:'Approved',rejected:'Rejected',posted:'Saved to log book',error:['gemini','gemini-hybrid'].includes(provider)?'Gemini extraction failed':'OCR failed'};}
export function scanCardStatus(card,provider){const progress=card.raw_fields?.scanProgress;if(provider==='gemini'&&card.status==='reading'&&progress?.stage==='retrying')return `Gemini retry ${progress.attempt||2}/${progress.maxAttempts||2} · ${progress.reason||'temporary error'}`;return provider==='gemini-hybrid'&&card.status==='reading'&&['A','B'].includes(progress?.stage)?'Gemini Priority '+progress.stage:scanStatusLabels(provider)[card.status];}
