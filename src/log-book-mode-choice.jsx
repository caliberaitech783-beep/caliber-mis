import React from 'react';
import {BookOpen,Keyboard,ScanLine} from 'lucide-react';
import './log-book-mode-choice.css';
export default function LogBookModeChoice({kind,onManual,onScan,onBatches,canScan=true}){
  const lmv=kind==='lmv',vehicle=kind==='vehicle'||lmv;
  const code=lmv?'LMV':vehicle?'VLB':'ELB',title=lmv?'LMV Log Book':vehicle?'Vehicle Log Book':'Equipment Log Book';
  return <section className="logbook-mode-choice"><header><BookOpen size={32}/><div><h1>{title} ({code})</h1><p>Choose how you want to enter or check the log book.</p></div></header>
    <div className="logbook-mode-cards">
      <button type="button" onClick={onManual}><Keyboard size={34}/><strong>{code} Manual</strong><span>Enter and save log book data manually.</span></button>
      <button type="button" onClick={onScan} disabled={!canScan}><ScanLine size={34}/><strong>{code} Scan</strong><span>Scan {vehicle?'Trip Cards':'Job Cards'} from the document scanner, check extracted data and save approved cards.</span>{!canScan&&<small>Scanner access requires an administrator.</small>}</button>
      {onBatches&&<button type="button" onClick={onBatches}><BookOpen size={34}/><strong>Site batches</strong><span>{vehicle?'View VLB cards inside their operational batch.':'Open the batch after VLB lock, save ELB entries inside it, then close and lock ELB.'}</span></button>}
    </div>
  </section>;
}
