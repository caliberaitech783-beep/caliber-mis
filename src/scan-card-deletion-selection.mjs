export const isDeletableScanCard=card=>Boolean(card&&!card.logbook_id&&!card.raw_fields?.manualDeletion&&['review','approved','error','rejected'].includes(card.status));
export const scanDeletionSelection=cards=>cards.map(card=>({id:card.id,revision:card.revision})).sort((a,b)=>a.id.localeCompare(b.id));
export const scanDeletionApproval=cards=>'Approve deletion of cards '+scanDeletionSelection(cards).map(card=>card.id+' revision '+card.revision).join(', ');
export const isAbortableScanCard=card=>Boolean(card&&!card.logbook_id&&!card.raw_fields?.manualDeletion&&['queued','reading'].includes(card.status));
export const scanAbortApproval=cards=>'Approve abort of cards '+cards.map(card=>card.id).sort().join(', ');
