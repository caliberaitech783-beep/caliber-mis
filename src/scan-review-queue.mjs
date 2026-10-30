// Uploaded ordinals remain unchanged for audit; review numbers follow unsaved cards.
export function remainingScanCards(cards){
 return cards.filter(card=>!['posted','rejected'].includes(card.status));
}
export function scanReviewPosition(cards,id){
 const index=cards.findIndex(card=>card.id===id);
 return index<0?'':(index+1)+'/'+cards.length;
}
