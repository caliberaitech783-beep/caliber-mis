import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {contentDeletionBlocked,enforceContentDeletionPolicy} from '../server/rules/content-deletion-policy.mjs';
test('legacy content deletions, purges, destructive restores and alternate C-Dir approvals fail closed',()=>{
 for(const [method,url]of [['DELETE','/api/saved-reports/1'],['DELETE','/api/masters/Equipment/1'],['DELETE','/api/backups/1'],['POST','/api/requests/bulk-delete'],['POST','/api/data-housekeeping/purge'],['POST','/api/log-retention/run'],['PUT','/api/log-retention'],['POST','/api/backups/import/restore'],['PATCH','/API/CDIR/deletion-requests/1/APPROVE/']])assert.equal(contentDeletionBlocked(method,url),true,method+' '+url);
 for(const [method,url]of [['GET','/api/scan-backups'],['POST','/api/scan-backups'],['POST','/api/log-book-deletions'],['POST','/api/log-book-deletions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/otp'],['POST','/api/log-book-deletions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/confirm'],['PATCH','/api/cdir/deletion-requests/1/reject']])assert.equal(contentDeletionBlocked(method,url),false,method+' '+url);
});
test('an actual legacy deletion handler never runs, even when approval-shaped headers are supplied',async()=>{
 const app=express();let invoked=false;app.use(enforceContentDeletionPolicy);app.delete('/api/saved-reports/:id',(_req,res)=>{invoked=true;res.sendStatus(204)});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));try{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/saved-reports/1',{method:'DELETE',headers:{'X-Deletion-Approved':'true','X-OTP':'123456'}});assert.equal(r.status,403);assert.equal(invoked,false);assert.equal((await r.json()).code,'DELETION_APPROVAL_REQUIRED');}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('only the authorized single scan-card POST delete bypasses the global OTP rule',()=>{
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',path='/api/scan-cards/'+id+'/delete';
 assert.equal(contentDeletionBlocked('POST',path),false);
 assert.equal(contentDeletionBlocked('POST',path+'?x=1'),false);
 assert.equal(contentDeletionBlocked('POST',path.toUpperCase()+'/'),false);
 for(const [method,url] of [['DELETE',path],['PUT',path],['PATCH',path],['POST','/api/scan-cards/bulk-delete'],['POST',path+'/all'],['POST','/api/scan-cards/not-an-id/delete'],['POST','/api/scan-batches/'+id+'/delete'],['POST','/api/log-books/'+id+'/delete']])assert.equal(contentDeletionBlocked(method,url),true,method+' '+url);
});

test('saved LMV deletion reaches only the guarded numeric record route',()=>{
 assert.equal(contentDeletionBlocked('DELETE','/api/log-books/lmv/42'),false);
 assert.equal(contentDeletionBlocked('DELETE','/api/log-books/lmv/all'),true);
});
