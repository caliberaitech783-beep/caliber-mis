import React from 'react';

// Scanned cards of this site/date/shift that are not saved yet (server rules/vlb-waiting-scans.mjs).
// The batch counts saved cards only, so without this list nobody saw them before locking.
const STAGE_BOOKS={vlb_open:['vlb'],lmv_open:['vlb','lmv'],elb_open:['vlb','lmv','elb']};
const STAGE_ACTION={vlb_open:'Lock VLB',lmv_open:'Lock LMV',elb_open:'Close & lock ELB'};

export function stageWaitingScans(entries=[],stage){
 const books=STAGE_BOOKS[stage]||[];
 return entries.filter(entry=>books.includes(entry.book));
}

export function WaitingScans({entries=[],stage}){
 const listed=stageWaitingScans(entries,stage);
 if(!listed.length)return null;
 const total=listed.reduce((sum,entry)=>sum+entry.waiting,0);
 return <div className="logbook-message vlb-waiting-scans" role="alert">
  <strong>{total} scanned card{total===1?'':'s'} not saved yet.</strong> {STAGE_ACTION[stage]} stays blocked until each card is saved, or deleted if it is wrong or scanned twice.
  <ul>{listed.map(entry=><li key={entry.id}>{entry.name}: {entry.waiting} waiting{entry.reading?` · ${entry.reading} still reading`:''}{entry.failed?` · ${entry.failed} failed`:''}</li>)}</ul>
 </div>;
}
