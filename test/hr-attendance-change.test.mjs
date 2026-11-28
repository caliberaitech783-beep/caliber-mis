// Owner, 27 Nov 2026: Pulse-II is the master of trip card attendance; HR Pulse shows it and keeps none of its own.
//   "if HR makes any changes, it has to be through OTP. If HR makes absent as present or present as absent, then the same
//    has to be re-updated in MIS also."  and, for present → absent on a card that is right: "Yes, keep the card".
//   - a change is asked for in Pulse-II, the RHR of the region gets the OTP, and only the right OTP makes it;
//   - absent keeps the card (trips, hours, OT, machines) and stops only the attendance of that shift, with a review item;
//   - present is a Present entry in Pulse-II; "as the trip card says" takes an HR change back;
//   - a day the Directors locked is not changed;
//   - the HR feed signs every site-day it sends, so HR Pulse can never show an old saved copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {HR_PRESENT_REASON,HR_PRESENT_KIND,hrChangeInput,dutyToken,hrAbsences,hrDaySignatures,hrChangeOtpMessage} from '../shared/hr-attendance-change.mjs';
import {buildManpowerReport,manpowerFilters} from '../server/rules/manpower-report.mjs';
import {buildAttendanceWeek,trimAttendanceWeek,attendanceAnswer} from '../server/rules/attendance-read.mjs';
import {createHrAttendanceChange,readHrAbsences,readHrTimes,HR_ATTENDANCE_CHANGE_SCHEMA} from '../server/routes/hr-attendance-change.mjs';
import {SHIFT_ATTENDANCE_SCHEMA} from '../server/routes/shift-attendance.mjs';

const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const site='Sasti OC',date='2026-11-10';
const shifts=[['A','05:00','13:00'],['B','13:00','21:00'],['C','21:00','05:00']].map(([shiftCode,startTime,endTime],i)=>({id:String(31+i),site,shiftCode,shiftName:'Shift '+shiftCode,startTime,endTime,status:'Active'}));
const employees=[{id:'21',caliberId:'CMPL101',caliberCode:'CMLL101',name:'Driver One'},{id:'22',caliberId:'CMPL102',caliberCode:'CMLL102',name:'Driver Two'}];
const assets=[{id:'1',door:'V1',site,category:'Vehicle',group:'Tipper',make:'Volvo',model:'FMX'},{id:'2',door:'V2',site,category:'Vehicle',group:'Tipper',make:'Volvo',model:'FMX'}];
const batches=['S1','S2','S3'].map(code=>({id:'b'+code,name:'BATCH-'+code,site,report_date:date,shift:code,closed_at:'2026-11-11T00:00:00Z'}));
function card(id=1,shift=1,patch={}){
 const data={bookDate:date,location:site,assetId:1,employeeId:21,caliberId:'CMPL101',employeeName:'Driver One',shiftId:30+shift,shiftName:'Shift '+['A','B','C'][shift-1],bookShiftCode:'S'+shift,masterShiftStart:shifts[shift-1].startTime,door:'V1',openingHmr:100,closingHmr:108,openingKmr:1000,closingKmr:1100,totalTrips:5,trips:[],...patch};
 return {id,book_no:'CARD-'+id,book_type:'vehicle',book_date:data.bookDate,site:data.location,asset_id:data.assetId,data,batches:[{id:'bS'+shift,name:'BATCH-S'+shift,closed_at:'2026-11-11'}]};
}
const build=(records,extra={})=>buildManpowerReport({records,assets,employees,shifts,batches,filters:{from:date,to:date},...extra});
const absent={id:'c1',siteKey:'sasti ob',date,shift:'S1',person:'101',by:'Meena (HR)',reason:'Card filled for the wrong day',at:'2026-11-27T06:00:00.000Z'};

test('what HR Pulse sends is checked: mark, date, site, shift, employee and a written reason',()=>{
 const ok={site:'Sasti OB',date,shift:'s1',employeeId:'CMLL101',mark:'absent',reason:'Card filled for the wrong day'};
 const change=hrChangeInput(ok,{today:'2026-11-27'});
 assert.deepEqual([change.mark,change.siteKey,change.shift,change.person],['absent','sasti ob','S1','101']);
 for(const [patch,message] of [[{mark:'delete'},/Present, Absent/],[{date:'2026-10-31'},/1 November 2026/],[{date:'2026-11-28'},/later date/],[{site:''},/site/],[{shift:'Shift 9'},/shift/],[{employeeId:''},/employee/],[{reason:'wrong'},/at least 10/]])
  assert.throws(()=>hrChangeInput({...ok,...patch},{today:'2026-11-27'}),error=>error.status===400&&message.test(error.message));
});

test('one person whatever the prefix: CMPL101, CMLL101 and 101 are the same duty',()=>{
 const tokens=['CMPL101','CMLL101','101','cmll 101'].map(employeeKey=>dutyToken({employeeKey,site:'Sasti OC',date,shift:'S1'}));
 assert.equal(new Set(tokens).size,1);
 assert.equal(tokens[0],'101|sasti ob|'+date+'|S1');
 assert.equal(hrAbsences([absent]).get(tokens[0]),absent);
});

test('absent keeps the card: OT and machines still read it, attendance does not count it, the card says why',()=>{
 const records=[card(1,1),card(2,2,{assetId:2,door:'V2',employeeId:22,caliberId:'CMPL102',employeeName:'Driver Two'})];
 const before=build(records,{parts:'attendance'});
 assert.deepEqual(before.otDuties.map(d=>d.employeeKey).sort(),['CMLL101','CMLL102']);
 assert.deepEqual(before.hrChanges,[]);

 const register=build(records,{parts:'attendance',hrChanges:[absent]});
 assert.deepEqual(register.otDuties.map(d=>d.employeeKey),['CMLL102'],'the register no longer holds the duty');
 assert.deepEqual(register.attendanceEquipment.map(r=>r.employeeKey),['CMLL102']);
 const item=register.exceptions.find(e=>/marked absent in HR Pulse with OTP/.test(e.reason));
 assert.ok(item,'the card carries a review item');
 assert.match(item.reason,/Meena \(HR\).*Card filled for the wrong day.*card and its trips are kept/);
 assert.equal(item.book,'CARD-1');
 assert.deepEqual(register.hrChanges.map(c=>[c.id,c.mark,c.employeeKey,c.siteKey,c.shift,c.by]),[['c1','absent','CMLL101','sasti ob','S1','Meena (HR)']]);

 const feed=build(records,{parts:'hr-attendance',hrChanges:[absent]});
 assert.deepEqual(feed.otDuties.map(d=>d.employeeKey),['CMLL102'],'HR Pulse is sent no duty for that shift');

 const full=build(records,{hrChanges:[absent]});
 assert.equal(full.totals.savedRecords,2,'both cards stay in the totals');
 assert.equal(full.otDuties.length,2,'the OT view keeps the duty: the card stands');
 assert.equal(full.performance.length,2);
 assert.deepEqual(full.shiftAttendance.map(r=>r.employeeName),['Driver Two'],'Shift Attendance does not count it');
});

test('an absence of another shift, site or person changes nothing',()=>{
 for(const other of [{...absent,shift:'S2'},{...absent,siteKey:'majri ob'},{...absent,person:'999'},{...absent,date:'2026-11-11'}]){
  const r=build([card(1,1)],{parts:'attendance',hrChanges:[other]});
  assert.equal(r.otDuties.length,1);assert.deepEqual(r.hrChanges,[]);
 }
});

test('present from HR Pulse is a Present entry of Pulse-II and is listed as HR\'s change',()=>{
 const entry={date,site:'sasti ob',shift:'S2',employee_id:22,asset_id:null,reason:HR_PRESENT_REASON,remarks:'HR Pulse · Meena · OTP from rhr.wcl · Punch seen, card missing'};
 const r=build([card(1,1)],{parts:'attendance',attendance:[entry]});
 const line=r.attendanceEquipment.find(l=>l.employeeKey==='CMLL102');
 assert.equal(line.status,'Present — 0 trips');assert.equal(line.reason,HR_PRESENT_REASON);assert.equal(line.shift,'S2');
 assert.deepEqual(r.hrChanges.map(c=>[c.mark,c.employeeKey,c.shift]),[['present','CMLL102','S2']]);
 // Marked absent afterwards: the entry is not counted either.
 const gone=build([card(1,1)],{parts:'attendance',attendance:[entry],hrChanges:[{...absent,id:'c2',shift:'S2',person:'102'}]});
 assert.equal(gone.attendanceEquipment.some(l=>l.employeeKey==='CMLL102'),false);
 assert.deepEqual(gone.hrChanges.map(c=>[c.id,c.mark]),[['c2','absent']]);
});

test('the HR feed signs every locked site-day, and the signature moves with what is sent',()=>{
 const week=(records,hrChanges=[])=>({window:{from:date,to:date},report:trimAttendanceWeek(buildAttendanceWeek({cards:records,masters:{assets,employees,shifts},batches,filters:manpowerFilters({from:date,to:date}),hr:true,scope:{sites:null},hrChanges}))});
 const answer=(records,hrChanges,only='')=>attendanceAnswer({parts:[week(records,hrChanges)],filters:manpowerFilters({from:date,to:date}),hr:true,scope:{sites:null},locked:['sasti ob|'+date],only,generatedAt:'now'});
 const one=answer([card(1,1)]),same=answer([card(1,1)]),two=answer([card(1,1),card(2,2,{assetId:2,door:'V2',employeeId:22,caliberId:'CMPL102',employeeName:'Driver Two'})]),marked=answer([card(1,1)],[absent]);
 assert.deepEqual(one.days.map(d=>[d.siteKey,d.date]),[['sasti ob',date]]);
 assert.ok(one.days[0].lines>0);
 assert.equal(one.days[0].signature,same.days[0].signature,'the same day gives the same signature');
 assert.notEqual(one.days[0].signature,two.days[0].signature,'a card saved later');
 assert.notEqual(one.days[0].signature,marked.days[0].signature,'a change from HR Pulse');
 assert.equal(marked.days[0].lines,0);assert.equal(marked.otDuties.length,0);
 assert.deepEqual(marked.hrChanges.map(c=>c.mark),['absent']);
 assert.deepEqual(Object.keys(answer([card(1,1)],[],'days')).sort(),['days','generatedAt','pendingDays','supports'],'only=days sends just the signatures and what the feed can do');
 // A locked day with nobody is signed too, so "nobody" is a checked answer.
 assert.deepEqual(hrDaySignatures([],['majri ob|'+date]).map(d=>[d.siteKey,d.lines]),[['majri ob',0]]);
});

const fixture=async()=>{
 const db=new PGlite();
 await db.exec(`
  CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);
  CREATE TABLE mis_telegram_links(login_name TEXT,chat_id TEXT);
  CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_type TEXT,book_date DATE,site TEXT,asset_id BIGINT,data JSONB,deleted_at TIMESTAMPTZ);
  CREATE TABLE mis_attendance_locked_sites(site TEXT NOT NULL,book_date DATE NOT NULL);
  ${SHIFT_ATTENDANCE_SCHEMA}${HR_ATTENDANCE_CHANGE_SCHEMA}`);
 await db.query(`INSERT INTO master_records VALUES(21,'Employee master',$1),(22,'Employee master',$2),(91,'ERP Employee master',$3),(41,'Employee master',$4),(42,'Employee master',$4)`,
  [{caliberId:'CMPL101',caliberCode:'CMLL101',name:'Driver One'},{caliberId:'CMPL102',caliberCode:'CMLL102',name:'Driver Two'},{caliberId:'101',name:'DRIVER ONE'},{caliberId:'CMPL300',name:'Twice Listed'}].map(JSON.stringify));
 await db.query(`INSERT INTO mis_log_books(book_type,book_date,site,asset_id,data) VALUES('vehicle',$1,'Sasti OC',1,$2)`,[date,JSON.stringify({caliberId:'CMPL101',employeeId:91})]);
 await db.query(`INSERT INTO mis_telegram_links VALUES('rhr.wcl','chat-rhr'),('sasti.hr','chat-site')`);
 const query=(sql,params)=>!params?.length?db.exec(sql).then(results=>results.at(-1)||{rows:[]}):db.query(sql,params);
 const pool={query,connect:async()=>({query,release(){}})};
 const otps=[],texts=[],clock={now:Date.parse('2026-11-27T06:00:00Z')};
 let list=[{level:1,scope:'Sasti OC',login:'sasti.hr'},{level:3,scope:'WCL',login:'rhr.wcl'}];
 const changes=createHrAttendanceChange({pool,approvers:async()=>list,now:()=>clock.now,today:()=>'2026-11-27',log:()=>{},
  deliverOtp:async request=>{otps.push(request);return {sentTo:request.logins,channels:['telegram'],failures:[]};},
  sendText:async(chatId,text)=>{texts.push({chatId,text});return true;}});
 const all={sites:null},ask=(input,extra={})=>changes.request({input:{site:'Sasti OC',date,shift:'S1',employeeId:'CMLL101',reason:'Card filled for the wrong day',...input},scope:all,actor:'Meena.HR',actorName:'Meena',...extra});
 return {db,pool,changes,otps,texts,clock,all,ask,setApprovers:value=>{list=value;}};
};
const refused=(status,message)=>error=>error.status===status&&message.test(error.message);

test('absent: the OTP goes to the RHR of the region, and only the right OTP makes the change',async()=>{
 const {db,pool,changes,otps,texts,all,ask}=await fixture();
 const asked=await ask({mark:'absent'});
 assert.equal(asked.status,'sent');assert.equal(asked.live,false);assert.deepEqual(asked.sentTo,['rhr.wcl']);
 assert.equal(asked.employeeId,'CMPL101');assert.equal(asked.employeeName,'Driver One');
 assert.deepEqual(otps[0].logins,['rhr.wcl']);
 assert.match(otps[0].message,/Meena \(HR Pulse\) asks to mark Driver One \(CMPL101\) ABSENT · Sasti OC \(WCL\) · 10-11-2026 · S1[\s\S]*trip card stays/);
 assert.match(otps[0].eventKey,/^hr-attendance-change-otp:/);
 assert.deepEqual(await readHrAbsences(pool,{from:date,to:date}),[],'nothing changes before the OTP');

 await assert.rejects(changes.verify({id:asked.id,otp:'000000',scope:all,actor:'meena.hr'}),refused(400,/Wrong OTP\. 4 attempts left/));
 assert.deepEqual(await readHrAbsences(pool,{from:date,to:date}),[]);
 const done=await changes.verify({id:asked.id,otp:otps[0].otp,scope:all,actor:'meena.hr'});
 assert.equal(done.status,'used');assert.equal(done.live,true);
 const live=await readHrAbsences(pool,{from:date,to:date});
 assert.deepEqual(live.map(c=>[c.siteKey,c.date,c.shift,c.person,c.by,c.reason]),[['sasti ob',date,'S1','101','Meena','Card filled for the wrong day']]);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_log_books WHERE deleted_at IS NULL')).rows[0].n,1,'the card is kept');
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.deepEqual(texts.map(t=>t.chatId).sort(),['chat-rhr','chat-site'],'RHR and Site HR are told');
 assert.match(texts[0].text,/Driver One \(CMPL101\) is now ABSENT/);
 await assert.rejects(changes.verify({id:asked.id,otp:otps[0].otp,scope:all,actor:'meena.hr'}),refused(400,/already used/));
 await assert.rejects(ask({mark:'absent'}),refused(409,/already marked absent/));
 await assert.rejects(ask({mark:'present'}),refused(409,/as the trip card says/));

 // "As the trip card says" takes it back.
 const back=await ask({mark:'card',reason:'Marked absent by mistake'});
 await changes.verify({id:back.id,otp:otps.at(-1).otp,scope:all,actor:'meena.hr'});
 assert.deepEqual(await readHrAbsences(pool,{from:date,to:date}),[]);
 const listed=await changes.list({from:date,to:date,scope:all});
 assert.deepEqual(listed.map(c=>[c.mark,c.status,c.live]),[['absent','used',false],['card','used',false]]);
 await assert.rejects(ask({mark:'card',reason:'Nothing left to take back'}),refused(409,/nothing to take back/));
});

test('present: a Present entry is made in Pulse-II, and "as the trip card says" removes it',async()=>{
 const {db,changes,otps,all,ask}=await fixture();
 const asked=await ask({mark:'present',employeeId:'102',shift:'S2',reason:'Punched, card not made'});
 await changes.verify({id:asked.id,otp:otps[0].otp,scope:all,actor:'meena.hr'});
 const rows=(await db.query("SELECT book_date::text AS date,site,shift,employee_id::text AS id,kind,reason,remarks,recorded_by FROM mis_shift_attendance")).rows;
 assert.deepEqual(rows.map(r=>[r.date,r.site,r.shift,r.id,r.kind,r.reason,r.recorded_by]),[[date,'sasti ob','S2','22',HR_PRESENT_KIND,HR_PRESENT_REASON,'hr-pulse:meena.hr']]);
 assert.match(rows[0].remarks,/HR Pulse · Meena · OTP from rhr\.wcl · Punched, card not made/);
 await assert.rejects(ask({mark:'present',employeeId:'102',shift:'S2',reason:'Punched, card not made'}),refused(409,/already has a Present entry/));
 const back=await ask({mark:'card',employeeId:'102',shift:'S2',reason:'Present marked by mistake'});
 await changes.verify({id:back.id,otp:otps.at(-1).otp,scope:all,actor:'meena.hr'});
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_shift_attendance')).rows[0].n,0);
});

test('refused: nothing to mark absent, an unknown or twice-listed person, another site, no RHR, a second OTP within a minute',async()=>{
 const {ask,setApprovers,clock}=await fixture();
 await assert.rejects(ask({mark:'absent',employeeId:'102'}),refused(409,/no trip card and no Present entry of Driver Two/));
 await assert.rejects(ask({mark:'absent',employeeId:'CMLL999'}),refused(404,/not|No employee/));
 await assert.rejects(ask({mark:'absent',employeeId:'CMPL300'}),refused(409,/2 lines of Employee Master/));
 await assert.rejects(ask({mark:'absent'},{scope:{sites:['majri ob']}}),refused(403,/outside your assigned access/));
 await ask({mark:'absent'});
 await assert.rejects(ask({mark:'absent'}),refused(429,/less than a minute ago/));
 clock.now+=61_000;
 setApprovers([]);
 await assert.rejects(ask({mark:'absent'}),refused(409,/No RHR is set for Sasti OC/));
});

test('a day the Directors locked is not changed, before or after the OTP',async()=>{
 const {db,pool,changes,otps,all,ask}=await fixture();
 const asked=await ask({mark:'absent'});
 await db.query(`INSERT INTO mis_attendance_locked_sites VALUES('sasti oc',$1)`,[date]);
 await assert.rejects(changes.verify({id:asked.id,otp:otps[0].otp,scope:all,actor:'meena.hr'}),refused(423,/locked after the Directors approved[\s\S]*unlock/));
 assert.deepEqual(await readHrAbsences(pool,{from:date,to:date}),[]);
 await assert.rejects(ask({mark:'absent'}),refused(423,/locked after the Directors approved/));
});

test('the OTP message names the change and what it does',()=>{
 const text=mark=>hrChangeOtpMessage({site:'Sasti OC',region:'WCL',date,shift:'S1',employeeId:'CMPL101',employeeName:'Driver One',mark,requestedBy:'Meena',reason:'Reason here',otp:'123456'});
 assert.match(text('present'),/PRESENT[\s\S]*OTP 123456, valid 10 minutes[\s\S]*Present entry is made in Pulse-II/);
 assert.match(text('absent'),/ABSENT[\s\S]*only the attendance of this shift is not counted/);
 assert.match(text('card'),/as the trip card says[\s\S]*taken back/);
});

test('the routes are HR Pulse\'s, the table is made with the log books, and every attendance read takes the changes',()=>{
 const server=source('server.mjs'),routes=source('server/routes/hr-attendance-change.mjs'),reports=source('server/routes/manpower-report-api.mjs');
 assert.match(server,/registerHrAttendanceChange\(app,\{requireHr:requireHrAttendance\(\)/);
 for(const path of ["app.post('/api/integrations/hr/attendance/change',requireHr","app.post('/api/integrations/hr/attendance/change/verify',requireHr","app.get('/api/integrations/hr/attendance/changes',requireHr"])assert.ok(routes.includes(path),path);
 assert.match(source('server/routes/log-book.mjs'),/SHIFT_ATTENDANCE_SCHEMA\+HR_ATTENDANCE_CHANGE_SCHEMA/);
 assert.equal(reports.split('readHrAbsences(client,').length-1,3,'the full report, the weekly reads and the attendance read');
 assert.match(reports,/plan\.punched,plan\.hrChanges\)/,'a change makes a new cache key');
 assert.match(source('AGENTS.md'),/# Trip card attendance has one master: Pulse-II/);
 // Duty times (28 Nov 2026): the HR feed reads them, a times change makes a new answer key, and the answer is written with them.
 assert.match(reports,/readHrTimes\(client,\{from:filters\.contextFrom,to:filters\.contextTo\}\)/);
 assert.match(reports,/only,cutSite,hrTimes\)/);
 assert.match(reports,/site:cutSite,hrTimes\}/);
});

// Owner, 28 Nov 2026, on HR Pulse correcting a duty's times only on its own side: "Yes, send to MIS".
test('duty times from HR Pulse: both times in HH:MM, kept apart from present / absent',()=>{
 const ok={site:'Sasti OB',date,shift:'S1',employeeId:'CMLL101',mark:'times',start:'06:00',end:'14:30',reason:'Driver came one hour late'};
 const change=hrChangeInput(ok,{today:'2026-11-27'});
 assert.deepEqual([change.mark,change.start,change.end],['times','06:00','14:30']);
 for(const patch of [{start:''},{end:'25:00'},{start:'6:00'},{end:'06:00',start:'06:00'}])
  assert.throws(()=>hrChangeInput({...ok,...patch},{today:'2026-11-27'}),error=>error.status===400&&/HH:MM/.test(error.message));
 assert.deepEqual([hrChangeInput({...ok,mark:'card-times'},{today:'2026-11-27'}).start,hrChangeInput({...ok,mark:'absent'},{today:'2026-11-27'}).end],['',''],'only "times" carries times');
 const text=hrChangeOtpMessage({site:'Sasti OC',region:'WCL',date,shift:'S1',employeeId:'CMPL101',employeeName:'Driver One',mark:'times',start:'06:00',end:'14:30',requestedBy:'Meena',reason:'Reason here',otp:'123456'});
 assert.match(text,/asks to set the duty times of Driver One \(CMPL101\) to 06:00–14:30 · Sasti OC \(WCL\)[\s\S]*OTP 123456[\s\S]*trip card and the attendance stay/);
 assert.match(hrChangeOtpMessage({site:'Sasti OC',date,shift:'S1',employeeId:'CMPL101',mark:'card-times',requestedBy:'Meena',reason:'Reason here',otp:'1'}),/take back the corrected duty times of CMPL101/);
});

test('the HR feed sends corrected times on the duty only, and the day\'s signature moves with them',()=>{
 const week=records=>({window:{from:date,to:date},report:trimAttendanceWeek(buildAttendanceWeek({cards:records,masters:{assets,employees,shifts},batches,filters:manpowerFilters({from:date,to:date}),hr:true,scope:{sites:null}}))});
 const answer=(hrTimes=[],only='')=>attendanceAnswer({parts:[week([card(1,1),card(2,3,{assetId:2,door:'V2',employeeId:22,caliberId:'CMPL102',employeeName:'Driver Two'})])],filters:manpowerFilters({from:date,to:date}),hr:true,scope:{sites:null},locked:['sasti ob|'+date],only,hrTimes,generatedAt:'now'});
 const times={id:'t1',siteKey:'sasti ob',date,shift:'S1',person:'101',start:'06:00',end:'14:30',by:'Meena',reason:'Driver came one hour late',at:'2026-11-27T06:00:00.000Z'};
 const before=answer(),after=answer([times]);
 // performance keeps the Shift Master times: HR Pulse reads two times in one shift there as a schedule conflict.
 assert.deepEqual(after.performance,before.performance);
 const duty=after.otDuties.find(d=>d.employeeKey==='CMLL101');
 assert.deepEqual(duty.hrTimes,{id:'t1',start:'06:00',end:'14:30',window:{start:date+' 06:00',end:date+' 14:30'},by:'Meena',reason:'Driver came one hour late',at:'2026-11-27T06:00:00.000Z'});
 assert.equal(after.otDuties.find(d=>d.employeeKey==='CMLL102').hrTimes,undefined);
 assert.notEqual(before.days[0].signature,after.days[0].signature,'a times change moves the signature');
 assert.equal(answer([times],'days').days[0].signature,after.days[0].signature,'the signature check gives the same signature');
 assert.ok(after.supports.includes('duty-times')&&after.supports.includes('site-cut'));
 // An end before the start is on the next day (Shift C).
 const night=answer([{...times,shift:'S3',person:'102',start:'22:00',end:'06:00'}]);
 assert.deepEqual(night.otDuties.find(d=>d.employeeKey==='CMLL102').hrTimes.window,{start:date+' 22:00',end:'2026-11-11 06:00'});
});

test('times: the OTP sets them in Pulse-II, they leave presence alone, and "take back" ends them',async()=>{
 const {db,pool,changes,otps,texts,all,ask}=await fixture();
 const asked=await ask({mark:'times',start:'06:00',end:'14:30',reason:'Driver came one hour late'});
 assert.deepEqual([asked.mark,asked.start,asked.end,asked.live],['times','06:00','14:30',false]);
 assert.match(otps[0].message,/set the duty times of Driver One \(CMPL101\) to 06:00–14:30/);
 assert.deepEqual(await readHrTimes(pool,{from:date,to:date}),[],'nothing before the OTP');
 const done=await changes.verify({id:asked.id,otp:otps[0].otp,scope:all,actor:'meena.hr'});
 assert.equal(done.live,true);
 const live=await readHrTimes(pool,{from:date,to:date});
 assert.deepEqual(live.map(c=>[c.siteKey,c.date,c.shift,c.person,c.start,c.end,c.by]),[['sasti ob',date,'S1','101','06:00','14:30','Meena']]);
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.match(texts.map(t=>t.text).join('\n'),/duty times of Driver One \(CMPL101\) are now 06:00–14:30/);

 // A new times change replaces the old one; an absent change does not touch the times, and the times do not stop it.
 const again=await ask({mark:'times',start:'07:00',end:'15:00',reason:'Second look at the gate register'});
 await changes.verify({id:again.id,otp:otps.at(-1).otp,scope:all,actor:'meena.hr'});
 assert.deepEqual((await readHrTimes(pool,{from:date,to:date})).map(c=>c.start),['07:00']);
 const gone=await ask({mark:'absent'});
 await changes.verify({id:gone.id,otp:otps.at(-1).otp,scope:all,actor:'meena.hr'});
 assert.equal((await readHrAbsences(pool,{from:date,to:date})).length,1);
 assert.deepEqual((await readHrTimes(pool,{from:date,to:date})).map(c=>c.start),['07:00'],'the absent change leaves the times');
 await assert.rejects(ask({mark:'times',start:'08:00',end:'16:00',reason:'Times of an absent duty'}),refused(409,/marked absent[\s\S]*only on a present duty/));

 const back=await ask({mark:'card-times',reason:'Times were right after all'});
 await changes.verify({id:back.id,otp:otps.at(-1).otp,scope:all,actor:'meena.hr'});
 assert.deepEqual(await readHrTimes(pool,{from:date,to:date}),[]);
 assert.equal((await readHrAbsences(pool,{from:date,to:date})).length,1,'taking the times back leaves the absent change');
 await assert.rejects(ask({mark:'card-times',reason:'Nothing left to take back'}),refused(409,/no duty times[\s\S]*nothing to take back/));
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_shift_attendance')).rows[0].n,0);
});

test('times are refused where nobody is present, and a present entry made by HR stays when its times change',async()=>{
 const {db,changes,otps,all,ask}=await fixture();
 await assert.rejects(ask({mark:'times',employeeId:'102',start:'06:00',end:'14:00'}),refused(409,/no trip card and no Present entry of Driver Two[\s\S]*present duty/));
 const present=await ask({mark:'present',employeeId:'102',shift:'S2',reason:'Punched, card not made'});
 await changes.verify({id:present.id,otp:otps.at(-1).otp,scope:all,actor:'meena.hr'});
 const times=await ask({mark:'times',employeeId:'102',shift:'S2',start:'13:30',end:'21:00',reason:'Late start at the gate'});
 await changes.verify({id:times.id,otp:otps.at(-1).otp,scope:all,actor:'meena.hr'});
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_shift_attendance')).rows[0].n,1,'the Present entry stays');
 const listed=await changes.list({from:date,to:date,scope:all});
 assert.deepEqual(listed.map(c=>[c.mark,c.live,c.start??null]),[['present',true,null],['times',true,'13:30']]);
});

test('a table made before duty times gets the columns and the wider mark list',async()=>{
 const db=new PGlite();
 await db.exec(`CREATE TABLE mis_hr_attendance_changes(id UUID PRIMARY KEY,site_key TEXT NOT NULL,site TEXT NOT NULL,book_date DATE NOT NULL,shift TEXT NOT NULL,
  person TEXT NOT NULL,employee_id TEXT NOT NULL,employee_name TEXT,employee_record BIGINT,mark TEXT NOT NULL CHECK(mark IN ('present','absent','card')),reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,requested_name TEXT,sent_to TEXT[] NOT NULL,channels TEXT[] NOT NULL DEFAULT '{}',otp_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'sent',requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),used_at TIMESTAMPTZ,used_by TEXT,
  replaced_at TIMESTAMPTZ,replaced_by UUID);`);
 assert.deepEqual(await readHrTimes(db,{from:date,to:date}),[],'an old table has no times');
 await db.exec(HR_ATTENDANCE_CHANGE_SCHEMA);
 await db.exec(HR_ATTENDANCE_CHANGE_SCHEMA);
 await db.query(`INSERT INTO mis_hr_attendance_changes(id,site_key,site,book_date,shift,person,employee_id,mark,reason,requested_by,sent_to,otp_hash,expires_at,status,used_at,start_time,end_time)
  VALUES('00000000-0000-4000-8000-000000000001','sasti ob','Sasti OC',$1,'S1','101','CMPL101','times','Late start','meena',ARRAY['rhr'],'x',now(),'used',now(),'06:00','14:30')`,[date]);
 assert.deepEqual((await readHrTimes(db,{from:date,to:date})).map(c=>[c.start,c.end]),[['06:00','14:30']]);
 await assert.rejects(db.query(`UPDATE mis_hr_attendance_changes SET mark='delete'`),/check/i);
});
