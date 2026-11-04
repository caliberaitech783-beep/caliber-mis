// Clearing a filtered selection must also clear its revision identity. Otherwise
// returning to the same card/revision can incorrectly reuse an empty draft.
export function scanDraftSelection(card,previousKey,dirty=false){
 if(!card)return {key:null,restore:true};
 const key=card.id+':'+card.revision;
 return {key,restore:key!==previousKey&&!(dirty&&previousKey?.startsWith(card.id+':'))};
}
