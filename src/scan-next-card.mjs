// Skip completed cards; explicit saves may wrap to earlier cards still needing work.
export function nextScanReviewCard(visible,currentId,refreshed=visible,{includeRejected=false,wrap=false}={}){
 const index=visible.findIndex(card=>card.id===currentId);
 if(index<0)return null;
 const latest=new Map((refreshed||visible).map(card=>[card.id,card]));
 for(const card of [...visible.slice(index+1),...(wrap?visible.slice(0,index):[])]){
  const next=latest.get(card.id);
  if(next&&(['review','error'].includes(next.status)||includeRejected&&next.status==='rejected'))return next;
 }
 return null;
}

export function scanReviewNeighbours(visible,currentId){
 const index=visible.findIndex(card=>card.id===currentId);
 return {previous:index>0?visible[index-1]:null,next:index>=0?visible[index+1]||null:null};
}
