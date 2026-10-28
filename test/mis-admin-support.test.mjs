import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isMisAdministrator,MIS_ADMIN_PAGES} from '../mis-admin-access.mjs';
import {misPageAllowed,misRequestAllowed} from '../mis-application-access.mjs';
import {canViewUserSessions} from '../user-session-access.mjs';
import {userSiteScope} from '../region-scope.mjs';
import {siteAllowed} from '../log-book-access.mjs';
const user={role:'super',login:'site-user',permissions:{separateMisCredentials:true,adminLevel:'Admin',misDesktopAccess:['Vehicle Log Book']}};
const admin={...user,login:'admin',permissions:{...user.permissions,misDesktopAccess:['Users & employees']}};
test('generic MIS Admin labels do not grant administrative authority',()=>{
 assert.equal(isMisAdministrator(user),false);assert.equal(isMisAdministrator(admin),true);
 assert.deepEqual(MIS_ADMIN_PAGES,['User Sessions','Print helper','Full Backup','Audit Trail','Database']);
 for(const page of MIS_ADMIN_PAGES){assert.equal(misPageAllowed(user,page),false);assert.equal(misPageAllowed(admin,page),true);}
 assert.equal(canViewUserSessions(user),false);assert.equal(canViewUserSessions(admin),true);
 for(const page of ['Tickets','Telegram Integration'])assert.equal(misPageAllowed(user,page),true);
});
test('MIS administration APIs fail closed for users and retain only bounded admin operations',()=>{
 const allowed=(session,path,method='GET')=>misRequestAllowed(session,{path,method});
 for(const path of ['/api/user-sessions','/api/audit-events','/api/backups','/api/mis-admin/status','/api/mis-telegram/settings']){assert.equal(allowed(user,path),false,path);assert.equal(allowed(admin,path),true,path);}
 assert.equal(allowed(user,'/api/mis-admin/backup','POST'),false);assert.equal(allowed(admin,'/api/mis-admin/backup','POST'),true);
 for(const path of ['/api/backups/import/restore','/api/mis-admin/new-feature','/api/print-helper/setup/unassigned'])assert.equal(allowed(user,path,'POST'),false);
 assert.equal(allowed(admin,'/api/audit-events','DELETE'),false);assert.equal(allowed(admin,'/api/user-login-history','DELETE'),false);
 assert.equal(allowed(user,'/api/mis-telegram/link','POST'),true);assert.equal(allowed(user,'/api/mis-telegram/settings','PUT'),false);
 assert.equal(allowed(user,'/api/mis-ticket-sites'),true);assert.equal(allowed(user,'/api/mis-ticket-sites','POST'),false);
});
test('MIS ticket access checks ownership for entries, media and notifications despite super session role',async()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const start=server.indexOf('async function ticketVisibleToSession('),end=server.indexOf('\n}',start)+2;
 const visible=new Function('isMisAdministrator',server.slice(start,end)+';return ticketVisibleToSession')(isMisAdministrator);
 assert.equal(await visible({creatorLogin:'site-user'},user),true);
 assert.equal(await visible({creatorLogin:'another-user'},user),false);
 assert.equal(await visible({creatorLogin:''},{...user,login:''}),false);
 assert.equal(await visible({creatorLogin:'another-user'},admin),true);
 const a=server.indexOf("app.patch('/api/tickets/resolve',"),b=server.indexOf('\n});',a)+4;
 let handler;
 new Function('app','requireSession','isTicketAdmin',server.slice(a,b))({patch:(path,...handlers)=>handler=handlers.at(-1)},()=>{},isMisAdministrator);
 let status;await handler({session:user},{status:value=>{status=value;return {json(){}}}},error=>{throw error});assert.equal(status,403);
 const list=server.slice(server.indexOf("app.get('/api/tickets',"),server.indexOf('const ticketMediaFields='));
 assert.match(list,/separateMisCredentials&&!isMisAdministrator\(req.session\)/);
 assert.match(list,/lower\(creator_login\)=\$/);
});
test('MIS ticket creation enforces the assigned site and uses MIS notifications without Pulse fan-out',async()=>{
 const source=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const start=source.indexOf("app.post('/api/tickets',"),end=source.indexOf("app.get('/api/tickets/resolution-notices'",start);
 let handler;const inserts=[],queries=[],notifications=[];
 const ticket={reference:'TEST',creatorLogin:user.login,site:'Assigned',category:'MIS',message:'Help'};
 const client={query:async(sql,values)=>{queries.push(sql);if(sql.startsWith('INSERT INTO crm_tickets')){inserts.push(values);return {rows:[{id:1,created_at:'2026-10-29'}]}}return {rows:sql.startsWith('UPDATE crm_tickets')?[ticket]:[]}},release(){}};
 const scope={app:{post:(path,...handlers)=>handler=handlers.at(-1)},requireSession(){},pool:{connect:async()=>client},managerRoleSelection:()=>[],managerUserRole:()=>'',TICKET_CATEGORIES:['MIS'],validTicketMediaDataUrl:()=>true,currentUserRecord:async()=>({site:'Assigned'}),userSiteSelection:()=>['Assigned'],displaySiteName:value=>value,siteAllowed,logBookScope:async()=>userSiteScope({site:'Assigned'}),ticketReference:()=>ticket.reference,ticketProjection:()=>'*',misTicketRecipients:async()=>({adminLogins:['admin'],managerLogins:[]}),addTicketNotifications:async()=>{},publicBaseUrl:()=> 'https://pulse-ll.cmll.in',normalizeOperationalSiteFields:value=>value,misTelegram:{notify:async(...args)=>notifications.push(args)},sendGenericWhatsAppAlertBestEffort:()=>{throw Error('Unexpected Pulse fan-out')},sendTicketRaisedEmail:()=>{throw Error('Unexpected Pulse email')}};
 new Function(...Object.keys(scope),source.slice(start,end))(...Object.values(scope));
 const call=async site=>{let status,body;const res={status:n=>{status=n;return res},json:value=>{body=value;return res}};await handler({session:user,body:{site,priority:'Medium',message:'Help'}},res,error=>{throw error});return {status,body}};
 assert.equal((await call('Other')).status,403);assert.equal(inserts.length,0);
 assert.equal((await call('Assigned')).status,201);assert.equal(inserts[0][2],'MIS User');assert.equal(inserts[0][4],'MIS');assert.deepEqual(notifications,[['created',ticket]]);assert.ok(queries.includes('COMMIT'));
});
