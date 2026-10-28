import {normalizedMisSelection,MIS_PERMISSION_OPTIONS} from './mis-permissions.mjs';
export function misPageAllowed(session,page,view){
 if(!session?.permissions?.separateMisCredentials)return false;
 page=page==='VLB Reports'?'Trip Card Bulk Scan':page==='ELB Reports'?'Job Card Bulk Scan':page==='Saved VLB'?'Vehicle Log Book':page==='Saved ELB'?'Equipment Log Book':page;
 return (view==='desktop'?normalizedMisSelection(session.permissions.misDesktopAccess):view==='mobile'?normalizedMisSelection(session.permissions.misMobileAccess):[...normalizedMisSelection(session.permissions.misDesktopAccess),...normalizedMisSelection(session.permissions.misMobileAccess)]).includes(page);
}
export function misRequestAllowed(session,req){
 if(!session?.permissions?.separateMisCredentials)return true;
 const route=req.path||'',read=['GET','HEAD'].includes(req.method);
 const allowed=page=>misPageAllowed(session,page);
 // Only session maintenance and menu discovery are unconditional. New routes fail closed.
 if(['/api/logout','/api/session-heartbeat','/api/session-messages','/api/preferred-language','/api/navigation-settings','/api/request-shifts','/api/announcements','/api/notifications'].includes(route))return read||['/api/logout','/api/session-heartbeat','/api/preferred-language'].includes(route);
 if(route==='/api/masters')return read;
 if(route.startsWith('/api/masters/'))return allowed(decodeURIComponent(req.params?.master||route.split('/')[3]||''));
 if(route.startsWith('/api/employee-master')||route.startsWith('/api/erp-employees'))return allowed('Employee master');
 if(route==='/api/erp-masters/status')return read&&['Work Order master','Financial Year master','Company master','Pulse Master Sync'].some(allowed);
 if(route==='/api/erp-masters/sync')return allowed('Pulse Master Sync');
 if(route.startsWith('/api/erp-masters/attachments'))return allowed('Work Order master');
 if(route.startsWith('/api/erp-masters/'))return allowed(decodeURIComponent(route.split('/')[3]||''));
 if(/^\/api\/(?:pulse-master-sync|master-sync)(?:\/|$)/.test(route))return allowed('Pulse Master Sync');
 if(route==='/api/pulse-trip-verification'&&read||/^\/api\/pulse-trip-verification\/\d+\/retry$/.test(route)&&req.method==='POST')return ['Pulse Master Sync','Vehicle Log Book','Trip Card Bulk Scan'].some(allowed);
 if(route.startsWith('/api/log-book-deletions'))return allowed('Deletion');
 if(route.startsWith('/api/log-books/options')||route==='/api/log-books/hours'||route==='/api/log-books/employee-lookup')return ['Vehicle Log Book','Equipment Log Book','Trip Card Bulk Scan','Job Card Bulk Scan'].some(allowed);
 if(route.startsWith('/api/log-books/vehicle'))return allowed('Vehicle Log Book');
 if(route.startsWith('/api/log-books/equipment'))return allowed('Equipment Log Book');
 if(route.startsWith('/api/scan')||route.startsWith('/api/bulk-card')){const kind=req.misResourceKind||req.params?.kind||req.query?.kind||req.body?.kind;return kind==='vehicle'?allowed('Trip Card Bulk Scan'):kind==='equipment'?allowed('Job Card Bulk Scan'):allowed('Trip Card Bulk Scan')||allowed('Job Card Bulk Scan');}
 if(route.startsWith('/api/tickets'))return allowed('Tickets');
 if(route.startsWith('/api/dashboard'))return allowed('Dashboard');
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
