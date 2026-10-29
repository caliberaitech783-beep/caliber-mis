// Advance through the visible queue without wrapping or reopening completed cards.
export function nextScanReviewCard(visible,currentId,refreshed=visible,{includeRejected=false}={}){
 const index=visible.findIndex(card=>card.id===currentId);
 if(index<0)return null;
 const latest=new Map((refreshed||visible).map(card=>[card.id,card]));
 for(const card of visible.slice(index+1)){
  const next=latest.get(card.id);
  if(next&&(['review','error'].includes(next.status)||includeRejected&&next.status==='rejected'))return next;
 }
 return null;
}
