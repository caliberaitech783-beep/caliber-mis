// Owner, 28 Nov 2026: 16 of the 18 attendance approvers had not connected the MIS Telegram bot, so the approval
// summaries never reached them ("Text + pop-up in MIS"). An approver with no Telegram sees a pop-up after sign-in
// with Connect my Telegram; it closes once connected, "Later" hides it until the next sign-in, and a login that
// approves nothing never sees it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {approverRoles} from '../shared/attendance-approval.mjs';
import {createAttendanceApproval} from '../server/routes/attendance-approval.mjs';
import {misRequestAllowed} from '../shared/mis-application-access.mjs';
import {rolesText,laterKey} from '../src/approver-telegram.mjs';

const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const LIST=[
 {level:1,scope:'Gauri Pauni OC (2nd)',login:'dhananjayjaiswal'},
 {level:3,scope:'Sasti OC',login:'viratsingh'},{level:3,scope:'Dhoptala OC (2nd)',login:'ViratSingh'},
 {level:4,scope:'*',login:'director'},{level:2,scope:'WCL',login:'office'},
 ...['Sasti OC','Majri OC','Jayant OC','Dudhichua OC'].map(scope=>({level:4,scope,login:'manishchadda'})),
];

test('the levels and sites one login approves, grouped by level',()=>{
 assert.deepEqual(approverRoles(LIST,'DhananjayJaiswal'),[{level:1,label:'Site HR',sites:['Gauri Pauni OC (2nd)']}]);
 assert.deepEqual(approverRoles(LIST,'viratsingh'),[{level:3,label:'RHR',sites:['Sasti OC','Dhoptala OC (2nd)']}]);
 assert.deepEqual(approverRoles(LIST,'director'),[{level:4,label:'Directors',sites:['All sites']}]);
 assert.deepEqual(approverRoles(LIST,'office'),[{level:2,label:'Office HR',sites:['Region WCL']}]);
 assert.deepEqual(approverRoles(LIST,'nobody'),[]);assert.deepEqual(approverRoles(LIST,''),[]);
 assert.deepEqual(rolesText(approverRoles(LIST,'viratsingh')),['RHR · Sasti OC, Dhoptala OC (2nd)']);
 assert.deepEqual(rolesText(approverRoles(LIST,'manishchadda')),['Directors · 4 sites'],'more than 3 sites are counted');
 assert.equal(laterKey('MohitChadda'),'approverTelegramLater:mohitchadda');
});

test('GET /api/attendance-approval/mine answers for the signed-in login only, and every MIS login may ask',async()=>{
 const db=new PGlite();
 const query=(sql,params)=>!params?.length?db.exec(sql).then(results=>results.at(-1)||{rows:[]}):db.query(sql,params);
 const approval=createAttendanceApproval({pool:{query,connect:async()=>({query,release(){}})},env:{},log:()=>{}});
 await approval.ensure();
 for(const a of LIST.slice(0,3))await db.query('INSERT INTO mis_attendance_approvers(level,scope,login) VALUES($1,$2,$3)',[a.level,a.scope,a.login.toLowerCase()]);
 assert.deepEqual(await approval.myRoles({login:'ViratSingh'}),[{level:3,label:'RHR',sites:['Dhoptala OC (2nd)','Sasti OC']}]);
 assert.deepEqual(await approval.myRoles({login:'maker1'}),[]);
 const session={permissions:{separateMisCredentials:true,misDesktopAccess:[]}};
 assert.equal(misRequestAllowed(session,{path:'/api/attendance-approval/mine',method:'GET'}),true);
 assert.equal(misRequestAllowed(session,{path:'/api/attendance-approval/mine',method:'POST'}),false);
 assert.equal(misRequestAllowed(session,{path:'/api/mis-telegram/me',method:'GET'}),true);
 assert.equal(misRequestAllowed(session,{path:'/api/mis-telegram/link',method:'POST'}),true);
 assert.match(source('server/routes/attendance-approval.mjs'),/app\.get\('\/api\/attendance-approval\/mine',requireSession,/);
 await db.close();
});

test('the pop-up is mounted for every signed-in login and shows only to an approver with no Telegram',()=>{
 const main=source('src/main.jsx'),notice=source('src/approver-telegram-notice.jsx');
 assert.match(main,/<ApproverTelegramNotice key=\{'approver-telegram-'\+token\} session=\{session\} \/>/);
 assert.match(notice,/if \(!approver \|\| later \|\| !me \|\| me\.linked \|\| !me\.enabled\) return null;/);
 assert.match(notice,/call\("\/api\/mis-telegram\/link", "POST"\)/,'the same connection link as Telegram Integration');
 assert.match(notice,/sessionStorage\.setItem\(laterKey\(login\), "1"\)/,'Later lasts until the next sign-in in this tab');
 assert.match(notice,/startVisiblePoll\(check, 4000\)/,'closes by itself after Start');
 assert.match(notice,/Until then, approve from Masters › Attendance approval\./);
});
