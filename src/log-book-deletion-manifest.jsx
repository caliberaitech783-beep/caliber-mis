import React from 'react';
const Table=({head,children})=><div className="deletion-scope-table"><table><thead><tr>{head.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
export function DeletionManifest({preview,checks,busy,sent,onChoose,onFinalize,onDownload}){
 const m=preview.manifest,folders=[...new Map(m.files.map(f=>[f.folderName,f])).values()],checked=new Map(checks.map(f=>[f.key,f]));
 return <>
  <h3>Exact deletion scope</h3><p>{m.records.length} records · {m.scans.length} scan copies · {m.cloud.length} cloud images · {m.backups.length} backup metadata rows · {m.files.length} registered SSD file paths · {m.snapshots.length} recovery snapshots · {m.batchLinks.length} saved-batch links · {m.verification.length} verification rows.</p>
  <button disabled={busy} onClick={onDownload}>Download exact approval list</button>
  <details open><summary>All source and duplicate scan copies ({m.scans.length})</summary><Table head={['Scan / batch / card','Filename','State / revision','Site / date / door / card number','Matched by','Image / checksum']}>{m.scans.map(s=><tr key={s.id}><td>{s.id}<small>Batch {s.batch_id} · Card {s.ordinal}</small></td><td>{s.filename}</td><td>{s.status} · {s.revision}</td><td>{s.site} · {s.bookDate} · {s.door} · {s.cardNumber}</td><td>{s.match}</td><td>{s.image_blob_key||'Database image'}<small>{s.image_hash}</small></td></tr>)}</Table></details>
  <details><summary>Cloud image versions ({m.cloud.length})</summary><Table head={['Exact location','Presence / bytes','Approved version']}>{m.cloud.map(s=><tr key={s.key}><td>{s.location||s.key}</td><td>{s.exists?'Present':'Already absent'} · {s.bytes??0}</td><td>{s.etag||'Absent'}</td></tr>)}</Table></details>
  <details><summary>Internal backup metadata to reduce to minimal audit ({m.backups.length})</summary><Table head={['Backup ID','Card ID','Registered destination']}>{m.backups.map(b=><tr key={b.backup_id+'/'+b.card_id}><td>{b.backup_id}</td><td>{b.card_id}</td><td>{b.destination||'Not recorded'}</td></tr>)}</Table></details>
  <details><summary>Recovery snapshots, batch links and verification rows</summary><Table head={['Location','Exact ID / position','Record / reference']}>{m.snapshots.map(s=><tr key={s.request_id+'/'+s.position}><td>Deletion recovery snapshot</td><td>{s.request_id} · Item {s.position}</td><td>{s.record_id} · {s.book_no}</td></tr>)}{m.batchLinks.map(s=><tr key={'batch/'+s.logbook_id}><td>Saved-batch link</td><td>{s.batch_id}</td><td>{s.logbook_id}</td></tr>)}{m.verification.map(s=><tr key={'verify/'+s.logbook_id}><td>Verification queue</td><td>{s.logbook_id}</td><td>{s.request_ref} · {s.status}</td></tr>)}</Table></details>
  {m.files.length>0&&<section className="deletion-backup-check"><h3>Verify the exact SSD backup files</h3><p>Open every listed backup folder before approving. This step only reads the files. Included files are removed only after successful WhatsApp OTP verification. Missing files are recorded as already absent. The folder itself and unlisted files are preserved.</p>
   {folders.map(f=><p key={f.folderName}><strong>{f.folderName}</strong> · Registered destination: {f.destination||'Not recorded'} <button disabled={busy||sent} onClick={()=>onChoose(f.folderName)}>Open and verify this backup folder</button></p>)}
   <Table head={['Exact backup / file','Registered destination','Verified state / bytes','SHA-256']}>{m.files.map(f=>{const c=checked.get(f.key);return <tr key={f.key}><td>{f.folderName}/{f.filename}</td><td>{f.destination||'Not recorded'}</td><td>{c?(c.exists?'Present':'Already absent'):'Folder not verified'} · {c?.bytes??'—'}</td><td>{c?.sha256||'—'}</td></tr>;})}</Table>
   <button disabled={busy||sent||checks.length!==m.files.length} onClick={onFinalize}>Use these verified files in the approval list</button>
  </section>}
  <p>Approval list fingerprint: <code>{preview.scopeHash}</code></p>
 </>;
}

export function DeletionCleanup({state,busy,onChoose,onResume,onRefresh,onClose}){
 const folders=[...new Set(state.pendingFiles.map(p=>state.files.find(f=>f.key===p.key)?.folderName).filter(Boolean))];
 return <section className="deletion-review" aria-label="Deletion cleanup status"><h2>{state.complete?'Permanent deletion completed':'Approved cleanup pending'}</h2>
  <p>Request: {state.id}. WhatsApp OTP verified: {state.otpVerified?'Yes':'No'}. Database cleanup: {state.databaseDeleted?'Done':'Not started'}. Cloud images pending: {state.pendingCloud}. SSD files pending: {state.pendingFiles.length}.</p>
  <p>{state.cleanupError||(!state.complete?'Keep the approved backup folders available. You can resume this same approved cleanup after reopening this page.':'All approved cleanup steps are complete. There is no application restore.')}</p>
  {folders.map(name=><p key={name}>{name} <button disabled={busy} onClick={()=>onChoose(name)}>Open this backup folder to resume</button></p>)}
  {state.pendingFiles.length>0&&<button disabled={busy||!state.otpVerified} onClick={onResume}>Resume approved SSD file cleanup</button>}
  <button disabled={busy} onClick={onRefresh}>Refresh cleanup status</button><button disabled={busy} onClick={onClose}>Back to entries</button>
 </section>;
}
