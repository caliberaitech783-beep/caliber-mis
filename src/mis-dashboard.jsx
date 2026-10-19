import React from 'react';

export default function MisDashboard({title='MIS dashboard'}) {
  return (
    <section aria-label={title} className="erp-mis-dashboard">
      <header className="erp-front-banner">
        <span className="erp-brand-icon"><img src="/caliber-erp-logo.jpg" alt="Caliber Pulse-II" /></span>
        <div>
          <h1>{title==='MIS dashboard'?'Caliber Pulse-II':title}</h1>
          {title==='MIS dashboard'&&<p className="erp-nexus-tagline">All Departments Linked In One Place</p>}
        </div>
      </header>
      {title!=='MIS dashboard'&&<div className="erp-logbook-workspace" aria-label={`${title} workspace`} />}
    </section>
  );
}
