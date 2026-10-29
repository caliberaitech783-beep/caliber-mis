// Fail closed: legacy deletion handlers are not an alternative to verified OTP.
export const CONTENT_DELETION_POLICY={recipient:'+91 9925565281',automaticPurges:false,
 message:'Deletion is blocked here. Exact-item preview, reason, impact, recovery information, approval and WhatsApp OTP verification are required. Use Deletion for VLB/ELB; other deletion workflows are unavailable until they support these safeguards.'};
export function contentDeletionBlocked(method,path){
 const verb=String(method).toUpperCase();let url=String(path).split('?')[0];
 try{url=decodeURIComponent(url).toLowerCase().replace(/\/+$/,'');}catch{return true;}
 if(!url.startsWith('/api/'))return false;
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
