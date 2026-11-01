import React from 'react';
import LogBookDashboard from './log-book-dashboard.jsx';

export default function MisDashboard({title='MIS dashboard',session,goto}) {
  const canReadLogbooks=session?.role==='super'&&['admin','super admin'].includes(String(session.permissions?.adminLevel||'').toLowerCase());
  return (
    <section aria-label={title} className="erp-mis-dashboard">
      <header className="erp-front-banner">
        <span className="erp-brand-icon"><img src="/pulse-ii-icon.png" alt="Caliber Pulse-II" /></span>
        <div>
          <h1>{title==='MIS dashboard'?'Caliber Pulse-II':title}</h1>
        </div>
      </header>
      {title==='MIS dashboard'&&canReadLogbooks&&<LogBookDashboard key={session.token} session={session} goto={goto}/>}
      {title!=='MIS dashboard'&&<div className="erp-logbook-workspace" aria-label={`${title} workspace`} />}
    </section>
  );
}
