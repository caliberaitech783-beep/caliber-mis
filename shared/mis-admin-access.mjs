// Separate MIS identities are issued with a generic Admin label. Administrative
// authority comes from the issuer's Login Details capability, never that label.
export function isMisAdministrator(session){
 const p=session?.permissions||{};
 const pages=[...(Array.isArray(p.misDesktopAccess)?p.misDesktopAccess:String(p.misDesktopAccess||'').split(/\s*\|\s*/)),...(Array.isArray(p.misMobileAccess)?p.misMobileAccess:String(p.misMobileAccess||'').split(/\s*\|\s*/))];
 return session?.role==='super'&&(p.separateMisCredentials?pages.includes('Users & employees'):['admin','super admin'].includes(String(p.adminLevel||'').toLowerCase()));
}
export const MIS_ADMIN_PAGES=['User Sessions','Print helper','Full Backup','Audit Trail','Database'];
export function requireMisAdministrator(req,res,next){
 if(isMisAdministrator(req.session))return next();
 return res.status(403).json({error:'Only an authorized MIS administrator can use this feature.'});
}
