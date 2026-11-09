import React, { useEffect, useId, useRef } from 'react';
import './tab-selection-dialog.css';

function openDialog(dialog) {
  if (dialog.open) return;
  dialog.showModal();
  dialog.querySelector('input:not([disabled]):not([readonly]):not([type="hidden"]), select:not([disabled])')?.focus();
}

export default function TabSelectionDialog({ title, openKey = true, enabled = true, closeKey, onSubmit, children }) {
  const dialogRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (enabled && openKey) openDialog(dialogRef.current);
  }, [enabled, openKey]);

  useEffect(() => {
    if (closeKey && dialogRef.current?.open) dialogRef.current.close();
  }, [closeKey]);

  const submit = onSubmit && (event => {
    event.preventDefault();
    if (onSubmit() !== false) dialogRef.current?.close();
  });

  if (!enabled) return submit ? <div onSubmit={submit}>{children}</div> : children;

  return <>
    <button type="button" onClick={() => openDialog(dialogRef.current)}>Select options</button>
    <dialog ref={dialogRef} className="tab-selection-dialog" aria-labelledby={titleId} onSubmit={submit}>
      <header>
        <h2 id={titleId}>{title}</h2>
        <button type="button" onClick={() => dialogRef.current.close()}>Close</button>
      </header>
      {children}
    </dialog>
  </>;
}
