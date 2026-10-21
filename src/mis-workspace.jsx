import React from 'react';

export default function MisWorkspace({onSignOut}){
  return <div className="mis-workspace">
    <header className="mis-workspace-header">
      <h1>Caliber MIS</h1>
      <button type="button" onClick={onSignOut}>Sign out</button>
    </header>
    <main aria-label="MIS workspace" />
  </div>;
}
