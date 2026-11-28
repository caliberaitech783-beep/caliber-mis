// Owner, 28 Nov 2026, after HR Pulse showed 781 employees for Majri OC from a copy saved on 22 Nov and 749 after a
// fresh read: "either re-read by itself, or any change made by MIS department, then upon update by them should auto
// update the hr saved days also", then "now build the MIS push and nightly check also".
//   - every two minutes the live server tells HR Pulse which site-days changed (cards, batches, Present entries, HR changes);
//   - the first run tells nothing, a day that was never sent to HR Pulse is never told, and a message HR Pulse does not
//     take waits for the next run;
//   - once a night every saved day of HR Pulse is checked against what the HR feed signs now; what is not the same, and
//     what was saved before days were signed, is marked in HR Pulse and told on Telegram (A29).
// The sites, days and signatures below are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createHrAttendanceDayWatch,dayStamps,changedDays,nightlyPlan,nightDue,nightlyMessage,signedParts,
 HR_DAY_WATCH_SCHEMA,HR_DAY_WATCH_STATE_KEY,HR_DAY_WATCH_INTERVAL_MS,HR_DAY_WATCH_SILENT_MINUTES} from '../server/services/hr-attendance-day-watch.mjs';
import {SHIFT_ATTENDANCE_SCHEMA} from '../server/routes/shift-attendance.mjs';
import {HR_ATTENDANCE_CHANGE_SCHEMA} from '../server/routes/hr-attendance-change.mjs';
import {AUTOMATIONS} from '../server/rules/automation-catalogue.mjs';
import {automationForEventKey} from '../server/services/automation-switches.mjs';

const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const D8='2026-11-08',D9='2026-11-09';

test('a stamp moves with a card, a batch, a Present entry or an HR change, and says whether the day was ever locked',()=>{
 const base={cards:[{site:'Majri OC',date:D8,n:3,ids:'60',revs:'5'}],batches:[{site:'Majri OC',date:D8,id:'7',locks:1,closed:true}]};
 const one=dayStamps(base).get('majri ob|'+D8);
 assert.ok(one.startsWith('L|'),'a closed batch: the day may have been sent to HR Pulse');
 assert.equal(dayStamps(base).get('majri ob|'+D8),one,'the same day gives the same stamp');
 const moved=[
  {...base,cards:[{...base.cards[0],revs:'6'}]},
  {...base,cards:[{...base.cards[0],n:4,ids:'99'}]},
  {...base,batches:[{...base.batches[0],locks:2}]},
  {...base,entries:[{site:'majri ob',date:D8,n:1,hash:'aa'}]},
  {...base,changes:[{site:'majri ob',date:D8,n:1,hash:'bb'}]}];
 for(const input of moved)assert.notEqual(dayStamps(input).get('majri ob|'+D8),one);
 const open=dayStamps({...base,batches:[{...base.batches[0],closed:false}]}).get('majri ob|'+D8);
 assert.ok(open.startsWith('O|'));assert.notEqual(open,one,'a batch reopened');
 // Two spellings of one site are one site-day.
 assert.deepEqual([...dayStamps({cards:[{site:'Majri OC',date:D8,n:1,ids:'1',revs:'1'},{site:'MAJRI OB',date:D8,n:1,ids:'2',revs:'1'}]}).keys()],['majri ob|'+D8]);
});

test('what is told: a day that was or is locked; never the first run, and never a day that has not been locked',()=>{
 const stored=new Map([['majri ob|'+D8,'L|a'],['sasti ob|'+D8,'O|a'],['jayant ob|'+D8,'L|a'],['dhoptala ob 2nd|'+D8,'L|a']]);
 const current=new Map([['majri ob|'+D8,'L|b'],['sasti ob|'+D8,'O|b'],['jayant ob|'+D8,'O|b'],['majri ob|'+D9,'O|new']]);
 const moved=changedDays(stored,current);
 assert.deepEqual(moved.map(d=>[d.siteKey,d.date,d.stamp,d.quiet]).sort(),[
  ['dhoptala ob 2nd',D8,'O|gone',false],['jayant ob',D8,'O|b',false],['majri ob',D8,'L|b',false],['majri ob',D9,'O|new',true],['sasti ob',D8,'O|b',true]]);
 assert.ok(changedDays(new Map(),current,{baseline:true}).every(d=>d.quiet),'the first run only writes the stamps down');
 assert.deepEqual(changedDays(current,current),[]);
});

test('the nightly check: a changed day and an unsigned day are marked, a day that is the same is left',()=>{
 const feed=[{siteKey:'majri ob',date:D8,signature:'new8'},{siteKey:'majri ob',date:D9,signature:'same9'},{siteKey:'dudhichua east ob',date:D8,signature:'e8'},{siteKey:'dudhichua ob',date:D8,signature:'w8'},{siteKey:'jayant ob',date:D9,signature:'j9'}];
 const saved=[
  {site:'Majri OC',day:D8,signature:'majri ob:old8'},
  {site:'Majri OC',day:D9,signature:'majri ob:same9'},
  {site:'Dudhichua OB East',day:D8,signature:'dudhichua east ob:e8,dudhichua ob:OLD'},
  {site:'Sasti OC',day:D8,signature:''},
  {site:'Sasti OC',day:D9,signature:'sasti ob:gone'},
  {site:'Jayant OB',day:D8,signature:'none'},
  {site:'Jayant OB',day:D9,signature:'none'},
  {site:'Dhoptala OC',day:D8,signature:'dhoptala ob 2nd:x',changedAt:'2026-11-28T00:00:00Z'}];
 const plan=nightlyPlan(saved,feed);
 assert.deepEqual(plan.differed,[{site:'Majri OC',day:D8},{site:'Dudhichua OB East',day:D8},{site:'Sasti OC',day:D9},{site:'Jayant OB',day:D9}]);
 assert.deepEqual(plan.unsigned,[{site:'Sasti OC',day:D8}]);
 assert.deepEqual([plan.checked,plan.alreadyMarked],[6,1]);
 // A signed day is named by the Pulse-II keys in its signature; an unsigned or "none" day by HR Pulse's own site name.
 assert.deepEqual(plan.mark,[{siteKey:'majri ob',date:D8},{siteKey:'dudhichua east ob',date:D8},{siteKey:'dudhichua ob',date:D8},{siteKey:'sasti oc',date:D8},{siteKey:'sasti ob',date:D9},{siteKey:'jayant ob',date:D9}]);
 assert.deepEqual(signedParts('majri ob:aa,none,sasti ob:bb'),[{siteKey:'majri ob',signature:'aa'},{siteKey:'sasti ob',signature:'bb'}]);
 const same=nightlyPlan([{site:'Majri OC',day:D9,signature:'majri ob:same9'}],feed);
 assert.deepEqual([same.differed,same.unsigned,same.mark],[[],[],[]]);
});

test('the nightly check is due once per India day, from 02:30, and waits 15 minutes after a try that failed',()=>{
 const at=text=>Date.parse(text);
 assert.equal(nightDue({},at('2026-11-28T20:59:00Z')),false,'02:29 IST');
 assert.equal(nightDue({},at('2026-11-28T21:00:00Z')),true,'02:30 IST on the 29th');
 assert.equal(nightDue({lastNight:{day:'2026-11-29'}},at('2026-11-28T23:00:00Z')),false,'done for that day');
 assert.equal(nightDue({lastNight:{day:'2026-11-28'}},at('2026-11-28T23:00:00Z')),true);
 assert.equal(nightDue({nightTriedAt:'2026-11-28T22:50:00Z'},at('2026-11-28T23:00:00Z')),false);
 assert.equal(nightDue({nightTriedAt:'2026-11-28T22:40:00Z'},at('2026-11-28T23:00:00Z')),true);
});

const fixture=async({live=true}={})=>{
 const db=new PGlite();
 await db.exec(`
  CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_type TEXT,book_date DATE,site TEXT,revision INTEGER NOT NULL DEFAULT 1,deleted_at TIMESTAMPTZ);
  CREATE TABLE mis_vlb_batches(id BIGSERIAL PRIMARY KEY,site TEXT,book_date DATE,closure_revision INTEGER,closed_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ,archived_at TIMESTAMPTZ);
  ${SHIFT_ATTENDANCE_SCHEMA}${HR_ATTENDANCE_CHANGE_SCHEMA}`);
 // Majri 8 Nov: locked. Majri 9 Nov: cards, batch still open. Sasti 8 Nov: locked.
 await db.exec(`
  INSERT INTO mis_log_books(book_type,book_date,site) VALUES('vehicle','${D8}','Majri OC'),('vehicle','${D8}','Majri OC'),('equipment','${D9}','Majri OC'),('vehicle','${D8}','Sasti OC');
  INSERT INTO mis_vlb_batches(site,book_date,closure_revision,closed_at) VALUES('Majri OC','${D8}',1,now()),('Majri OC','${D9}',0,NULL),('Sasti OC','${D8}',1,now());`);
 const query=(sql,params)=>!params?.length?db.exec(sql).then(results=>results.at(-1)||{rows:[]}):db.query(sql,params);
 const pool={query,connect:async()=>({query,release(){}})};
 const clock={now:Date.parse('2026-11-28T06:00:00Z')},told=[],alerts=[],hrState={up:true,saved:[],marked:0};
 const hr={configured:()=>true,
  tripCardDaysChanged:async change=>{if(!hrState.up)throw Object.assign(new Error('HR Pulse did not answer.'),{status:502});told.push(change);return {marked:hrState.marked,days:[]};},
  tripCardDays:async range=>{if(!hrState.up)throw Object.assign(new Error('HR did not answer. Existing data retained.'),{status:502});return {...range,days:hrState.saved,hrOnlyCorrections:3};}};
 const feed={days:[],asked:[]};
 const watch=createHrAttendanceDayWatch({pool,hr,live,now:()=>clock.now,log:{error(){}},alert:async(message,key)=>{alerts.push({key,message});},
  feedDays:async range=>{feed.asked.push(range);return feed.days.filter(d=>d.date>=range.from&&d.date<=range.to);}});
 const next=async()=>{clock.now+=HR_DAY_WATCH_INTERVAL_MS;return watch.tick();};
 const waiting=async()=>(await db.query("SELECT site_key,book_date::text AS date FROM mis_hr_day_watch WHERE told_at IS NULL ORDER BY site_key,book_date")).rows.map(r=>r.site_key+' '+r.date);
 return {db,watch,clock,told,alerts,hrState,feed,next,waiting};
};

test('the first run writes the stamps down and tells nothing; after that a change on a locked day is told once',async()=>{
 const {db,watch,told,next,waiting}=await fixture();
 const first=await watch.tick();
 assert.deepEqual([first.ok,first.baseline,first.days,first.toTell],[true,true,3,0]);
 assert.deepEqual([told.length,await waiting()],[0,[]]);
 assert.equal((await watch.tick()).skipped,'recent','not twice within the two minutes');
 assert.deepEqual([(await next()).moved,told.length],[0,0],'nothing changed, nothing told');

 // A card of the locked day is corrected: its revision rises.
 await db.exec(`UPDATE mis_log_books SET revision=revision+1 WHERE id=1`);
 const run=await next();
 assert.deepEqual([run.moved,run.toTell,run.sent],[1,1,1]);
 assert.deepEqual(told,[{reason:'Changed in Pulse-II',days:[{siteKey:'majri ob',date:D8}]}]);
 assert.deepEqual(await waiting(),[]);
 assert.deepEqual([(await next()).moved,told.length],[0,1],'told once');

 // A card saved on a day whose batch is still open: that day was never sent to HR Pulse, so nothing is told.
 await db.exec(`INSERT INTO mis_log_books(book_type,book_date,site) VALUES('vehicle','${D9}','Majri OC')`);
 const quiet=await next();
 assert.deepEqual([quiet.moved,quiet.toTell,told.length],[1,0,1]);
 // The batch is locked: from now on the day counts, and HR Pulse is told.
 await db.exec(`UPDATE mis_vlb_batches SET closed_at=now(),closure_revision=1 WHERE book_date='${D9}'`);
 await next();
 assert.deepEqual(told.at(-1).days,[{siteKey:'majri ob',date:D9}]);
 // Reopened, a Present entry, a card deleted, and an HR change: each is told.
 await db.exec(`UPDATE mis_vlb_batches SET closed_at=NULL WHERE book_date='${D9}'`);
 await next();assert.deepEqual(told.at(-1).days,[{siteKey:'majri ob',date:D9}],'a batch reopened');
 await db.exec(`INSERT INTO mis_shift_attendance(book_date,site,shift,employee_id,asset_id,kind,reason,remarks,recorded_by) VALUES('${D8}','sasti ob','S1',21,NULL,'zero','Standby','','x')`);
 await next();assert.deepEqual(told.at(-1).days,[{siteKey:'sasti ob',date:D8}],'a Present entry');
 await db.exec(`UPDATE mis_log_books SET deleted_at=now() WHERE id=2`);
 await next();assert.deepEqual(told.at(-1).days,[{siteKey:'majri ob',date:D8}],'a card deleted');
 await db.query(`INSERT INTO mis_hr_attendance_changes(id,site_key,site,book_date,shift,person,employee_id,mark,reason,requested_by,sent_to,otp_hash,expires_at,status,used_at)
  VALUES('00000000-0000-4000-8000-000000000001','sasti ob','Sasti OC',$1,'S1','101','CMPL101','absent','Wrong day','meena',ARRAY['rhr'],'x',now(),'used',now())`,[D8]);
 await next();assert.deepEqual(told.at(-1).days,[{siteKey:'sasti ob',date:D8}],'a change made from HR Pulse');
});

test('a message HR Pulse does not take waits and goes with the next run; the approvers are told once after 30 minutes',async()=>{
 const {db,watch,told,alerts,hrState,next,waiting,clock}=await fixture();
 await watch.tick();
 hrState.up=false;
 await db.exec(`UPDATE mis_log_books SET revision=revision+1 WHERE id=1`);
 const failed=await next();
 assert.deepEqual([failed.ok,failed.error],[false,'HR Pulse did not answer.']);
 assert.deepEqual([told.length,await waiting(),alerts.length],[0,['majri ob '+D8],0]);
 await db.exec(`UPDATE mis_log_books SET revision=revision+1 WHERE id=4`);
 for(let i=0;i<Math.ceil(HR_DAY_WATCH_SILENT_MINUTES*60*1000/HR_DAY_WATCH_INTERVAL_MS)+1;i++)await next();
 assert.equal(alerts.length,1,'told once, however long it lasts');
 assert.match(alerts[0].key,/^hr-trip-card-days:silent:/);
 assert.match(alerts[0].message,/has not been able to tell HR Pulse which trip card days changed[\s\S]*wait and go when HR Pulse answers/);
 assert.deepEqual(await waiting(),['majri ob '+D8,'sasti ob '+D8]);
 hrState.up=true;
 const back=await next();
 assert.deepEqual([back.ok,back.sent],[true,2]);
 assert.deepEqual(told.at(-1).days.map(d=>d.siteKey+' '+d.date).sort(),['majri ob '+D8,'sasti ob '+D8]);
 assert.deepEqual(await waiting(),[]);
 assert.equal((await watch.status()).error,'');
 assert.ok(clock.now>0);
});

test('only the live server runs it, and never without the connection to HR Pulse',async()=>{
 const {watch}=await fixture({live:false});
 assert.equal((await watch.tick()).skipped,'not the live server');
 const db=new PGlite(),query=(sql,params)=>!params?.length?db.exec(sql).then(r=>r.at(-1)||{rows:[]}):db.query(sql,params);
 const off=createHrAttendanceDayWatch({pool:{query,connect:async()=>({query,release(){}})},hr:{configured:()=>false},feedDays:async()=>[]});
 assert.equal((await off.tick()).skipped,'not connected');
 await assert.rejects(off.night(),error=>error.status===503);
});

test('the nightly check marks what is not the same in HR Pulse and tells the approvers; an equal night tells nobody',async()=>{
 const {watch,told,alerts,hrState,feed,db}=await fixture();
 feed.days=[{siteKey:'majri ob',date:D8,signature:'new8'},{siteKey:'majri ob',date:D9,signature:'same9'}];
 hrState.saved=[{site:'Majri OC',day:D8,signature:'majri ob:old8'},{site:'Majri OC',day:D9,signature:'majri ob:same9'},{site:'Sasti OC',day:D8,signature:''}];
 hrState.marked=2;
 const night=await watch.night();
 assert.deepEqual([night.ok,night.same,night.saved,night.checked,night.differed,night.unsigned,night.marked,night.hrOnlyCorrections],[true,false,3,2,1,1,2,3]);
 assert.deepEqual(told,[{reason:'Nightly check: not what Pulse-II holds',days:[{siteKey:'majri ob',date:D8},{siteKey:'sasti oc',date:D8}]}]);
 assert.equal(alerts.length,1);
 assert.equal(alerts[0].key,'hr-trip-card-days:night:2026-11-28');
 assert.match(alerts[0].message,/nightly check with HR Pulse \(2026-11-28\)[\s\S]*1 saved day was changed in Pulse-II after saving:\nMajri OC: 08-11[\s\S]*1 day was saved before days were signed[\s\S]*Sasti OC: 08-11[\s\S]*2 saved days are marked in HR Pulse[\s\S]*Old corrections kept only in HR Pulse and not applied: 3/);
 // The feed is asked in pieces of at most 31 days, from 1 November.
 assert.ok(feed.asked.length>=1&&feed.asked.every(r=>(Date.parse(r.to)-Date.parse(r.from))/86400000<=30));
 assert.equal(feed.asked[0].from,'2026-11-01');
 const state=(await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[HR_DAY_WATCH_STATE_KEY])).rows[0].setting_value;
 assert.deepEqual([state.lastNight.day,state.lastNight.list],['2026-11-28',[{site:'Majri OC',day:D8},{site:'Sasti OC',day:D8}]]);

 // The next night HR Pulse has marked them: nothing is the matter, nobody is told.
 hrState.saved=[{site:'Majri OC',day:D8,signature:'majri ob:old8',changedAt:'x'},{site:'Majri OC',day:D9,signature:'majri ob:same9'},{site:'Sasti OC',day:D8,signature:'',changedAt:'x'}];
 const calm=await watch.night();
 assert.deepEqual([calm.same,calm.alreadyMarked,told.length,alerts.length],[true,2,1,1]);
});

test('a nightly check that cannot be made marks nothing, is told once that night, and is tried again',async()=>{
 const {watch,told,alerts,hrState,next,clock}=await fixture();
 await watch.tick();
 hrState.up=false;
 await assert.rejects(watch.night(),error=>error.status===502);
 await assert.rejects(watch.night(),error=>error.status===502);
 assert.deepEqual([told.length,alerts.length],[0,1]);
 assert.match(alerts[0].message,/could not be made[\s\S]*tried again every 15 minutes/);
 assert.equal((await watch.status()).nightError,'HR did not answer. Existing data retained.');
 // The two-minute run makes the nightly check by itself once it is 02:30 in India.
 hrState.up=true;hrState.saved=[];
 clock.now=Date.parse('2026-11-28T21:10:00Z');
 const run=await next();
 assert.equal(run.ok,true);
 assert.equal((await watch.status()).lastNight.day,'2026-11-29');
 assert.equal(alerts.length,1,'a night with nothing saved is the same: nobody is told');
});

test('A29 is on the Automation tab with its own switch, and the server starts the watch with the HR schedule',()=>{
 const line=AUTOMATIONS.find(item=>item.key==='hr-trip-card-days');
 assert.equal(line.code,'A29');
 assert.equal(AUTOMATIONS.filter(item=>item.code==='A29').length,1);
 assert.equal(automationForEventKey('hr-trip-card-days:night:2026-11-29:anoop'),'hr-trip-card-days','the ON/OFF switch stops it');
 assert.match(line.trigger({hrDayWatch:{lastNight:{day:'2026-11-29',same:false,differed:2,unsigned:5,marked:7}}}),/last check 2026-11-29: 2 changed, 5 saved before signing, 7 marked/);
 assert.match(nightlyMessage({day:'2026-11-29',differed:[],unsigned:[{site:'Majri OC',day:D8}],marked:1,hrOnlyCorrections:0}),/1 saved day is marked in HR Pulse/);
 const server=source('server.mjs'),reports=source('server/routes/manpower-report-api.mjs'),client=source('server/services/hr-employee-sync.mjs');
 assert.match(server,/createHrAttendanceDayWatch\(\{pool,hr:hrEmployeeSync,feedDays:range=>logBooks\.hrFeedDays\(range\),ensureBooks:\(\)=>logBooks\.initialize\(\),live:isLiveSlot\(\)/);
 assert.match(server,/process\.env\.HR_DAY_WATCH!=='0'\)hrDayWatch\.startTimer\(\)/);
 assert.match(reports,/readAttendance\(true\)\(\{query:\{from,to,only:'days'\},logBookScope:\{sites:null\}\}/,'the nightly check reads exactly what HR Pulse is sent');
 assert.match(reports,/return \{hrFeedDays\};/);
 assert.ok(client.includes("'/api/integrations/mis/trip-card-days/changed'")&&client.includes("read('trip-card-days?'"));
 assert.match(HR_DAY_WATCH_SCHEMA,/mis_hr_day_watch/);
 assert.match(source('AGENTS.md'),/hr-attendance-day-watch\.mjs/);
});
