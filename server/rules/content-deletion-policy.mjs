// Allow only deletion routes with their own authorization and scope checks.
export const CONTENT_DELETION_POLICY={recipient:'+91 9925565281',automaticPurges:false,
 message:'Deletion is blocked here. Exact-item preview, reason, impact, recovery information, approval and WhatsApp OTP verification are required. Use Deletion for VLB/ELB; other deletion workflows are unavailable until they support these safeguards.'};
export function contentDeletionBlocked(method,path){
 const verb=String(method).toUpperCase();let url=String(path).split('?')[0];
 try{url=decodeURIComponent(url).toLowerCase().replace(/\/+$/,'');}catch{return true;}
 if(!url.startsWith('/api/'))return false;
 if(verb==='POST'&&/^\/api\/vlb-batch-deletions\/(?:preview|[a-f0-9-]+\/(?:otp|confirm))$/.test(url))return false;
 // The user authorized direct deletion of one unsaved scan card. The handler
 // retains session/site permissions, current-revision and saved-card checks.
 if(verb==='POST'&&/^\/api\/scan-cards\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/delete$/.test(url))return false;
 // The log-book handler rechecks the open stage and record revision under lock.
 if(verb==='DELETE'&&/^\/api\/log-books\/(?:vehicle|equipment|lmv)\/\d+$/.test(url))return false;
 // Alias revocation records a status change and audit history. The alias route
 // still requires administrator access and enforces its OTP setting.
 if(verb==='DELETE'&&/^\/api\/equipment-aliases\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(url))return false;
 if(verb==='DELETE')return true;
 if(!['POST','PUT','PATCH'].includes(verb))return false;
 // This existing workflow verifies request ownership, exact approval, expiry,
 // current record revisions and delivered OTP before its atomic soft deletion.
 if(/^\/api\/log-book-deletions\/[a-f0-9-]+\/(?:otp|confirm)$/i.test(url))return false;
 return /(?:^|\/)(?:purge|bulk-delete|clear)(?:\/|$)/i.test(url)||
  /^\/api\/log-retention(?:\/|$)/i.test(url)||
  /^\/api\/backups\/import\/restore$/i.test(url)||
  /^\/api\/cdir\/deletion-requests\/[^/]+\/approve$/i.test(url)||
  /(?:^|\/)[^/]*(?:delete|deletion-confirm)[^/]*(?:\/|$)/i.test(url)&&!/^\/api\/(?:log-book-deletions|cdir\/deletion-requests)(?:\/|$)/i.test(url);
}
export function enforceContentDeletionPolicy(req,res,next){
 if(contentDeletionBlocked(req.method,req.path))return res.status(403).json({error:CONTENT_DELETION_POLICY.message,code:'DELETION_APPROVAL_REQUIRED',recipient:CONTENT_DELETION_POLICY.recipient});
 next();
}
