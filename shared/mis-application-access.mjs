import {managerRoleSelection} from './admin-access.mjs';
import {isMisAdministrator,MIS_ADMIN_PAGES} from './mis-admin-access.mjs';
import {normalizedMisSelection,MIS_PERMISSION_OPTIONS} from './mis-permissions.mjs';
export function misPageAllowed(session,page,view){
 if(!session?.permissions?.separateMisCredentials)return false;
 if(['Fleet Capacity','Equipment Deployment'].includes(page))return misPageAllowed(session,'Reports',view);
 if(page==='Capacity master')return isMisAdministrator(session)&&misPageAllowed(session,'Equipment master',view);
 if(page==='Batch reopening approvals')return session.role==='super'&&session.permissions.adminLevel==='Manager'&&managerRoleSelection(session.permissions.managerRoles?.length?session.permissions.managerRoles:session.permissions.managerRole).includes('Project Manager');
 if(['Tickets','Telegram Integration'].includes(page))return true;
 if(MIS_ADMIN_PAGES.includes(page))return isMisAdministrator(session);
 if(page==='Create VLB Batch')return ['Vehicle Log Book','Equipment Log Book'].some(name=>misPageAllowed(session,name,view));
 if(['LMV Log Book','LMV Manual','LMV Scan'].includes(page))return misPageAllowed(session,page==='LMV Scan'?'Trip Card Bulk Scan':'Vehicle Log Book',view);
 page=page==='VLB Reports'?'Trip Card Bulk Scan':page==='ELB Reports'?'Job Card Bulk Scan':page==='Saved VLB'?'Vehicle Log Book':page==='Saved ELB'?'Equipment Log Book':page;
 if(page==='Scan Backup'||page==='Deletion'){const selection=view==='desktop'?normalizedMisSelection(session.permissions.misDesktopAccess):view==='mobile'?normalizedMisSelection(session.permissions.misMobileAccess):[...normalizedMisSelection(session.permissions.misDesktopAccess),...normalizedMisSelection(session.permissions.misMobileAccess)];return selection.includes(page)||['Vehicle Log Book','Equipment Log Book'].every(name=>selection.includes(name));}
 return (view==='desktop'?normalizedMisSelection(session.permissions.misDesktopAccess):view==='mobile'?normalizedMisSelection(session.permissions.misMobileAccess):[...normalizedMisSelection(session.permissions.misDesktopAccess),...normalizedMisSelection(session.permissions.misMobileAccess)]).includes(page);
}
export function misRequestAllowed(session,req){
 if(!session?.permissions?.separateMisCredentials)return true;
 const route=req.path||'',read=['GET','HEAD'].includes(req.method);
 if(route==='/api/security/account')return read;
 if(['/api/security/session/migrate','/api/security/mfa/enroll','/api/security/mfa/confirm','/api/security/mfa/verify'].includes(route))return req.method==='POST';
 const allowed=page=>misPageAllowed(session,page);
 if(route==='/api/capacity-master/fleet')return allowed('Capacity master')&&(read||req.method==='PUT');
 if(route==='/api/reports/fleet-population')return read&&allowed('Reports');
 if(route==='/api/capacity-master')return allowed('Capacity master')&&(read||req.method==='POST');
 if(route==='/api/mis-ticket-sites')return read;
 if(route==='/api/mis-admin/backup')return isMisAdministrator(session)&&req.method==='POST';
 if(route==='/api/mis-admin/status')return isMisAdministrator(session)&&read;
 if(route==='/api/mis-telegram/me'||route==='/api/mis-telegram/link')return read&&route.endsWith('/me')||req.method==='POST'&&route.endsWith('/link');
 if(route.startsWith('/api/mis-telegram/'))return isMisAdministrator(session)&&((read&&route==='/api/mis-telegram/settings')||(req.method==='PUT'&&route==='/api/mis-telegram/settings')||(req.method==='POST'&&route==='/api/mis-telegram/test'));
 if(route==='/api/print-helper/certificate')return read;
 if(route==='/api/print-helper/sign')return req.method==='POST';
 if(['/api/print-helper/setup','/api/print-helper/setup/override.crt'].includes(route))return isMisAdministrator(session)&&(read||req.method==='POST'&&route==='/api/print-helper/setup');
 if(route==='/api/user-sessions'||route==='/api/user-login-history'||route==='/api/audit-events'||route==='/api/log-retention'||route==='/api/storage-overview'||route==='/api/diagnostics'||route==='/api/diagnostics/performance')return read&&isMisAdministrator(session);
 if(route==='/api/backups'||/^\/api\/backups\/[a-f0-9-]{36}\/download$/.test(route))return read&&isMisAdministrator(session);
 // Only session maintenance and menu discovery are unconditional. New routes fail closed.
 if(['/api/logout','/api/session-heartbeat','/api/session-messages','/api/preferred-language','/api/navigation-settings','/api/request-shifts','/api/announcements','/api/notifications'].includes(route))return read||['/api/logout','/api/session-heartbeat','/api/preferred-language'].includes(route);
 if(route==='/api/masters')return read;
 // Report controls use the same menu grant as their source tables. The server
 // still validates export payloads and scopes saved views to the signed-in user.
 if(route==='/api/exports/pdf')return req.method==='POST'&&['Reports','Trip Card Bulk Scan','Job Card Bulk Scan','Vehicle Log Book','Equipment Log Book','Dashboard'].some(allowed);
 if(route==='/api/saved-reports')return (read||req.method==='POST')&&['Reports','Trip Card Bulk Scan','Job Card Bulk Scan','Vehicle Log Book','Equipment Log Book','Dashboard'].some(allowed);
 if(/^\/api\/saved-reports\/[^/]+$/.test(route))return req.method==='DELETE'&&['Reports','Trip Card Bulk Scan','Job Card Bulk Scan','Vehicle Log Book','Equipment Log Book','Dashboard'].some(allowed);
 // Equipment aliases (written card label -> Pulse record) are learned in scan review and manual
 // book entry and listed under Equipment master. Changing the approver and direct revoke stay
 // administrator actions; the route itself also requires an administrator for those.
 if(route==='/api/equipment-aliases'||route.startsWith('/api/equipment-aliases/')){
  const menu=['Trip Card Bulk Scan','Job Card Bulk Scan','Vehicle Log Book','Equipment Log Book','Equipment master'].some(allowed);
  if(route==='/api/equipment-aliases/settings')return menu&&(read||req.method==='PUT'&&isMisAdministrator(session));
  if(route==='/api/equipment-aliases')return menu&&(read||req.method==='POST');
  if(/^\/api\/equipment-aliases\/[0-9a-f-]{36}\/otp(?:\/[0-9a-f-]{36}\/verify)?$/i.test(route))return menu&&req.method==='POST';
  if(/^\/api\/equipment-aliases\/[0-9a-f-]{36}$/i.test(route))return menu&&req.method==='DELETE'&&isMisAdministrator(session);
  return false;
 }
 if(route.startsWith('/api/masters/'))return allowed(decodeURIComponent(req.params?.master||route.split('/')[3]||''));
 if(/^\/api\/equipment-master\/changes(?:\/[^/]+\/verify)?\/?$/i.test(route))return req.method==='POST'&&allowed('Equipment master');
 if(route==='/api/employee-master/location')return req.method==='GET';
 if(/^\/api\/employee-master\/location\/\d{1,18}$/.test(route))return req.method==='PUT';
 if(route.startsWith('/api/employee-master')||route.startsWith('/api/erp-employees'))return allowed('Employee master');
 if(route==='/api/erp-masters/status')return read&&['Work Order master','Financial Year master','Company master','Pulse Master Sync'].some(allowed);
 if(route==='/api/erp-masters/sync')return allowed('Pulse Master Sync');
 if(route.startsWith('/api/erp-masters/attachments'))return allowed('Work Order master');
 if(route.startsWith('/api/erp-masters/'))return allowed(decodeURIComponent(route.split('/')[3]||''));
 if(/^\/api\/(?:pulse-master-sync|master-sync)(?:\/|$)/.test(route))return allowed('Pulse Master Sync');
 if(route==='/api/pulse-trip-verification'&&read||/^\/api\/pulse-trip-verification\/\d+\/retry$/.test(route)&&req.method==='POST')return ['Pulse Master Sync','Vehicle Log Book','Trip Card Bulk Scan'].some(allowed);
 if(route.startsWith('/api/log-book-deletions'))return allowed('Deletion');
 if(route.startsWith('/api/scan-backups'))return allowed('Scan Backup');
 if(route.startsWith('/api/log-books/options')||route==='/api/log-books/hours'||route==='/api/log-books/employee-lookup')return ['Vehicle Log Book','Equipment Log Book','Trip Card Bulk Scan','Job Card Bulk Scan'].some(allowed);
 if(route.startsWith('/api/log-books/vehicle'))return allowed('Vehicle Log Book');
 if(/^\/api\/log-books\/lmv(?:\/|$)/.test(route))return allowed('Vehicle Log Book');
 if(route==='/api/shift-attendance'){
  const kind=read?req.query?.kind:req.body?.kind;
  return (read||req.method==='POST')&&(kind==='vehicle'?allowed('Vehicle Log Book'):kind==='equipment'&&allowed('Equipment Log Book'));
 }
 if(/^\/api\/vlb-batch-deletions(?:\/|$)/.test(route))return allowed('Vehicle Log Book');
 if(/^\/api\/vlb-batches(?:\/|$)/.test(route)){
  if(allowed('Batch reopening approvals')&&(read&&route==='/api/vlb-batches/approvals'||req.method==='POST'&&/^\/api\/vlb-batches\/[0-9a-f-]{36}\/reopen-decision$/i.test(route)))return true;
  if(read)return allowed('Vehicle Log Book')||allowed('Equipment Log Book');
  if(/^\/api\/vlb-batches\/[0-9a-f-]{36}\/(?:fleet(?:\/|$)|close$)/i.test(route))return allowed('Equipment Log Book')||allowed('Vehicle Log Book');
  return allowed('Vehicle Log Book');
 }
 if(route.startsWith('/api/log-books/equipment'))return allowed('Equipment Log Book');
 if(route.startsWith('/api/scan')||route.startsWith('/api/bulk-card')){const kind=req.misResourceKind||req.params?.kind||req.query?.kind||req.body?.kind;return kind==='vehicle'?allowed('Trip Card Bulk Scan'):kind==='equipment'?allowed('Job Card Bulk Scan'):allowed('Trip Card Bulk Scan')||allowed('Job Card Bulk Scan');}
 if(route==='/api/tickets/resolve')return req.method==='PATCH'&&isMisAdministrator(session);
 if(route.startsWith('/api/tickets'))return allowed('Tickets');
 if(route.startsWith('/api/dashboard'))return allowed('Dashboard');
 if(route.startsWith('/api/reports/fleet-reconciliation'))return ['Vehicle Log Book','Equipment Log Book','Trip Card Bulk Scan','Job Card Bulk Scan'].some(allowed);
 if(route.startsWith('/api/report'))return allowed('Reports');
 if(route==='/api/requests'&&read)return req.query?.scope==='reports'?allowed('Reports'):allowed('Dashboard');
 if(route==='/api/fleet-equipment')return read&&['Dashboard','Vehicle Log Book','Equipment Log Book','Trip Card Bulk Scan','Job Card Bulk Scan'].some(allowed);
 return false;
}

export async function authorizeMisRequest(session,req,pool){
 if(session?.permissions?.separateMisCredentials){
  req.misAllowedScanKinds=[...(misPageAllowed(session,'Trip Card Bulk Scan')?['vehicle']:[]),...(misPageAllowed(session,'Job Card Bulk Scan')?['equipment']:[])];
  const match=/^\/api\/(scan-batches|scan-cards)\/([0-9a-f-]{36})(?:\/|$)/i.exec(req.path||'');
  if(match){
   const sql=match[1]==='scan-batches'?'SELECT kind FROM mis_scan_batches WHERE id=$1':'SELECT b.kind FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id WHERE c.id=$1';
   const {rows}=await pool.query(sql,[match[2]]);if(!rows[0])return false;req.misResourceKind=rows[0].kind;
  }
 }
 return misRequestAllowed(session,req);
}

