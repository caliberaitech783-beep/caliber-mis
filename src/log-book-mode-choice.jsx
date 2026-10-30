import React from 'react';
import {BookOpen,Keyboard,ScanLine,Layers} from 'lucide-react';
import './log-book-mode-choice.css';
export default function LogBookModeChoice({kind,onManual,onScan,onSaved,onCreateBatch,canCreateBatch=true,canScan=true,canSaved=true}){
  const code=kind==='vehicle'?'VLB':'ELB',title=kind==='vehicle'?'Vehicle Log Book':'Equipment Log Book';
  return <section className="logbook-mode-choice"><header><BookOpen size={32}/><div><h1>{title} ({code})</h1><p>Choose how you want to enter or check the log book.</p></div></header>
    <div className={'logbook-mode-cards'+(kind==='vehicle'?' logbook-mode-cards-vlb':'')}>
      <button type="button" onClick={onManual}><Keyboard size={34}/><strong>{code} Manual</strong><span>Enter and save log book data manually.</span></button>
      <button type="button" onClick={onScan} disabled={!canScan}><ScanLine size={34}/><strong>{code} Scan</strong><span>Scan {kind==='vehicle'?'Trip Cards':'Job Cards'} from the document scanner, check extracted data and save approved cards.</span>{!canScan&&<small>Scanner access requires an administrator.</small>}</button>
      <button type="button" onClick={onSaved} disabled={!canSaved}><BookOpen size={34}/><strong>Saved {code}</strong><span>View saved log books, check their values and open original scans.</span></button>
      {kind==='vehicle'&&<button type="button" onClick={onCreateBatch} disabled={!canCreateBatch}><Layers size={34}/><strong>Create Batch</strong><span>Combine all saved Manual and Scan trip cards for one site, date and shift. Close the current batch before creating another.</span></button>}
    </div>
  </section>;
}
