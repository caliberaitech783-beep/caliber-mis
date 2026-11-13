import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {minutesBetween,bandOf,tripEntries,summarise,delayedEntries,entryRemark,BANDS,withExceptionTime,exceptionPeriodProblem,cleanExceptionRules,addExceptionRule,
 exceptionRulesFor,exceptionSiteKey,exceptionStorageKey,readExceptionView,storeExceptionView} from '../shared/trip-timing-report.mjs';
import {normalise} from '../src/operations-report-model.mjs';

const trip=(equipmentName,loadingTime,unloadingTime,tripCount=1)=>({equipmentName,loadingTime,unloadingTime,tripCount});
const book=(id,site,driver,door,trips,extra={})=>({id,book_no:'VLB_S'+id,book_type:'vehicle',data:{bookDate:'2026-12-14',location:site,assetId:id,door,employeeId:id,employeeName:driver,caliberId:'CMPL9000'+id,shiftId:1,shiftName:'Shift I',shiftHours:8,timeMode:'with',trips,...extra}});
const records=normalise([
 // Driver 1: trips of 8, 17, 25 and 40 minutes; gaps of 7, 10 and 31 minutes.
 book(1,'Site A','SAMPLE DRIVER 01','V9001',[trip('EX1','06:00','06:08'),trip('EX1','06:15','06:32'),trip('EX2','06:42','07:07'),trip('EX2','07:38','08:18')]),
 // Driver 2: one trip across midnight, one row without an unloading time, one row after it.
 book(2,'Site A','SAMPLE DRIVER 02','V9002',[trip('EX1','23:55','00:07'),trip('EX1','00:12',''),trip('EX1','00:40','00:46')]),
 // Driver 3 at another site: saved without times.
 book(3,'Site B','SAMPLE DRIVER 03','V9003',[trip('EX9','',''),trip('EX9','','')],{timeMode:'without'}),
 // An Equipment Log Book has no trips and is ignored.
 {id:4,book_no:'ELB4',book_type:'equipment',data:{bookDate:'2026-12-14',location:'Site A',assetId:4,door:'TPC901',employeeName:'SAMPLE DRIVER 04',trips:[]}}
]);
const entries=tripEntries(records);

test('minutes run forward through midnight and the bands follow the owner\'s limits',()=>{
 assert.equal(minutesBetween('23:55','00:07'),12);assert.equal(minutesBetween('06:00:30','06:10:00'),9.5);assert.equal(minutesBetween('06:00',''),null);assert.equal(minutesBetween('25:00','06:00'),null);
 assert.deepEqual([15,15.5,20,20.5,30,30.5].map(bandOf),['ok','b1','b1','b2','b2','b3']);
 assert.equal(bandOf(null),null);assert.equal(bandOf(721),null,'longer than a shift is a wrong time, not a delay');
 assert.deepEqual(BANDS.map(b=>b.label),['15 to 20 min','20 to 30 min','30+ min']);
});

test('one entry per trip row of vehicle log books only',()=>{
 assert.equal(entries.length,9);assert.ok(entries.every(e=>e.book.startsWith('VLB_S')));
 assert.deepEqual(entries.slice(0,4).map(e=>e['load-unload'].minutes),[8,17,25,40]);
 assert.deepEqual(entries.slice(0,4).map(e=>e['unload-load'].minutes),[null,7,10,31]);
 assert.equal(entries[0]['unload-load'].counted,false,'the first trip of a card has no gap');
});

test('loading to unloading: counts per driver add up to the site line',()=>{
 const sites=summarise(entries,'load-unload','site'),a=sites.rows.find(r=>r.site==='Site A');
 assert.deepEqual([a.timed,a.ok,a.b1,a.b2,a.b3,a.over,a.notJudged,a.longest,a.driversLate],[6,3,1,1,1,3,1,40,1]);
 assert.equal(a.percent,50);
 const b=sites.rows.find(r=>r.site==='Site B');assert.deepEqual([b.timed,b.over,b.notJudged,b.percent,b.longest],[0,0,2,null,null]);
 assert.equal(sites.total.timed+sites.total.notJudged,9,'timed + not judged = all trip rows');
 const drivers=summarise(entries.filter(e=>e.site==='Site A'),'load-unload','driver');
 assert.deepEqual(drivers.rows.map(r=>[r.driver,r.over]),[['SAMPLE DRIVER 01',3],['SAMPLE DRIVER 02',0]],'worst first');
 for(const key of ['timed','ok','b1','b2','b3','over','notJudged'])assert.equal(drivers.rows.reduce((s,r)=>s+r[key],0),a[key],key);
});

test('unloading to next loading: first rows are left out and a missing time is not a delay',()=>{
 const drivers=summarise(entries.filter(e=>e.site==='Site A'),'unload-load','driver'),[one,two]=drivers.rows;
 assert.deepEqual([one.timed,one.ok,one.b1,one.b2,one.b3,one.notJudged],[3,2,0,0,1,0]);
 // Driver 2: 00:07 to 00:12 is 5 minutes; the next gap has no unloading time above it.
 assert.deepEqual([two.timed,two.ok,two.over,two.notJudged],[1,1,0,1]);
 const machines=summarise(entries.filter(e=>e.site==='Site A'),'unload-load','machine');
 assert.deepEqual(machines.rows.map(r=>[r.machine,r.over,r.vehicleCount]),[['EX2',1,1],['EX1',0,2]]);
});

test('delayed list is newest first, keeps one band when asked, and explains rows that are not judged',()=>{
 const one=entries.filter(e=>e.driver==='SAMPLE DRIVER 01');
 assert.deepEqual(delayedEntries(one,'load-unload').map(e=>e['load-unload'].minutes),[40,25,17]);
 assert.deepEqual(delayedEntries(one,'load-unload','b2').map(e=>e.sr),[3]);
 assert.deepEqual(delayedEntries(one,'unload-load').map(e=>[e.previousUnloadingTime,e.loadingTime,e['unload-load'].minutes]),[['07:07','07:38',31]]);
 assert.match(entryRemark(entries[0]),/First trip of the card/);assert.match(entryRemark(entries[5]),/not written/);assert.equal(entryRemark(entries[1]),'');
});

test('one site written in several spellings on the cards is counted as one site',()=>{
 const one=[trip('EX1','06:00','06:18')];
 const mixed=tripEntries(normalise([book(11,'majri ob','SAMPLE DRIVER 11','V9011',one),book(12,'majri ob','SAMPLE DRIVER 12','V9012',one),book(13,'Majri OB','SAMPLE DRIVER 13','V9013',one),
  book(14,'Dudhicua East OB','SAMPLE DRIVER 14','V9014',one),book(15,'Dudhichua East OB','SAMPLE DRIVER 15','V9015',one),book(16,'Dudhichua East OB','SAMPLE DRIVER 16','V9016',one),book(17,'sasti ob','SAMPLE DRIVER 17','V9017',one)]));
 const sites=summarise(mixed,'load-unload','site');
 assert.deepEqual(sites.rows.map(r=>[r.site,r.timed,r.driversLate]),[['Dudhichua East OB',3,3],['Majri OB',3,3],['sasti ob',1,1]]);
});

test('a site opens date by date and shift by shift, and a driver line carries his delays from both views',()=>{
 const day=(id,date,shiftName,driver,trips)=>book(id,'Site A',driver,'V90'+id,trips,{bookDate:date,shiftName,caliberId:'CMPL9'+driver.slice(-2)});
 const set=tripEntries(normalise([
  day(21,'2026-12-14','Shift 1','SAMPLE DRIVER 21',[trip('EX1','06:00','06:18'),trip('EX1','06:40','07:05'),trip('EX1','07:10','07:50')]),
  day(22,'2026-12-14','Shift 2','SAMPLE DRIVER 21',[trip('EX1','14:00','14:08')]),
  day(23,'2026-12-15','Shift 1','SAMPLE DRIVER 23',[trip('EX1','06:00','06:10'),trip('EX1','06:15','06:22')])]));
 const shifts=summarise(set,'load-unload','shift');
 assert.deepEqual(shifts.rows.map(r=>[r.date,r.shift,r.timed,r.b1,r.b2,r.b3,r.driversLate]),[['2026-12-15','Shift 1',2,0,0,0,0],['2026-12-14','Shift 1',3,1,1,1,1],['2026-12-14','Shift 2',1,0,0,0,0]],'newest date first, then shift');
 assert.equal(shifts.total.over,3);
 const key=shifts.rows[1].key,drivers=summarise(set.filter(e=>JSON.stringify([e.date,e.shift])===key),'load-unload','driver');
 // One line for the driver: a trip in each band, and his one long gap (06:18 to 06:40) from the other view.
 assert.deepEqual(drivers.rows.map(r=>[r.driver,r.b1,r.b2,r.b3,r.over,r.otherOver]),[['SAMPLE DRIVER 21',1,1,1,3,1]]);
 assert.equal(summarise(set,'unload-load','driver').rows.find(r=>r.driver==='SAMPLE DRIVER 21').otherOver,3);
});

test('the shared screen shows the delay views on the Trip Timing tab only',()=>{
 const screen=fs.readFileSync(new URL('../src/operations-reports.jsx',import.meta.url),'utf8');
 assert.match(screen,/id==='timing'\?<TripTimingReport records=\{selected\} loading=\{filters\.loading\}/);
 const view=fs.readFileSync(new URL('../src/trip-timing-report.jsx',import.meta.url),'utf8');
 for(const text of ['All trip rows','Step 1 · ','Step 2 · ','Step 3 · ','Step 4 · ','Step 5 · Trip card ','date-wise and shift-wise'])assert.ok(view.includes(text),text);
});

// Exception time: the owner's example. Shift 05:00 to 13:00, blasting from 06:00 to 07:00.
const blast=(id,site,shiftName,driver,trips)=>book(id,site,driver,'V91'+id,trips,{shiftName,caliberId:'CMPL91'+id});
const blastEntries=tripEntries(normalise([
 // 05:50 to 06:45 is 55 min as written, 45 inside the blast: counts 10. 06:50 to 07:30 is 40, 10 inside: counts 30.
 // 08:00 to 08:40 is outside the blast and stays 40. 09:00 to 09:10 was never a delay.
 blast(31,'Site A','Shift A','SAMPLE DRIVER 31',[trip('EX1','05:50','06:45'),trip('EX1','06:50','07:30'),trip('EX1','08:00','08:40'),trip('EX1','09:00','09:10')]),
 // A short trip wholly inside the blast was never a delay, so no exception is given to it.
 blast(32,'Site A','Shift A','SAMPLE DRIVER 32',[trip('EX1','06:10','06:20')]),
 // The same clock times in another shift and at another site.
 blast(33,'Site A','Shift B','SAMPLE DRIVER 33',[trip('EX1','05:50','06:45')]),
 blast(34,'Site B','Shift A','SAMPLE DRIVER 34',[trip('EX1','05:50','06:45')])]));
const slotA=JSON.stringify(['2026-12-14','Shift A']);
const loadMinutes=list=>list.map(e=>[e['load-unload'].minutes,e['load-unload'].band]);

test('exception time: minutes inside the period are not counted and the band is judged on the rest',()=>{
 const all=[{from:'06:00',to:'07:00'}],viewed=withExceptionTime(blastEntries,all);
 assert.deepEqual(loadMinutes(viewed.slice(0,5)),[[10,'ok'],[30,'b2'],[40,'b3'],[10,'ok'],[0,'ok']]);
 assert.deepEqual(viewed.slice(0,5).map(e=>[e['load-unload'].rawMinutes,e['load-unload'].rawBand,e['load-unload'].excepted]),[[55,'b3',45],[40,'b3',10],[40,'b3',0],[10,'ok',0],[10,'ok',10]]);
 // The gap 06:45 to 06:50 lies inside the blast as well; 07:30 to 08:00 does not.
 assert.deepEqual(viewed.slice(1,3).map(e=>[e['unload-load'].minutes,e['unload-load'].band]),[[0,'ok'],[30,'b2']]);
 assert.deepEqual(loadMinutes(blastEntries.slice(0,2)),[[55,'b3'],[40,'b3']],'the standard entries are left as they are');
 assert.equal(viewed[2],blastEntries[2],'a trip no period touches is the same entry');
 const standard=summarise(blastEntries,'load-unload','site').total,personal=summarise(viewed,'load-unload','site').total;
 assert.deepEqual([standard.timed,standard.ok,standard.b2,standard.b3,standard.over,standard.given],[7,2,0,5,5,0]);
 assert.deepEqual([personal.timed,personal.ok,personal.b2,personal.b3,personal.over,personal.given],[7,5,1,1,2,4],'same trips timed; four moved to a lower band');
 assert.equal(personal.longest,40);
 assert.deepEqual(delayedEntries(viewed,'load-unload','given').map(e=>[e.driver,e.sr]),[['SAMPLE DRIVER 34',1],['SAMPLE DRIVER 33',1],['SAMPLE DRIVER 31',2],['SAMPLE DRIVER 31',1]]);
 assert.deepEqual(delayedEntries(viewed,'load-unload').map(e=>e['load-unload'].minutes),[40,30],'a trip still late after the exception stays in the delay list');
 assert.match(entryRemark(viewed[0]),/Exception time: 45 of 55 min not counted \(loading to unloading\)/);
 assert.equal(entryRemark(blastEntries[1]),'');
});

test('exception time: a period added for one site or one date and shift touches nothing else',()=>{
 const given=rules=>withExceptionTime(blastEntries,rules).filter(e=>e['load-unload'].excepted>0).map(e=>e.driver+' '+e.sr);
 const siteA=exceptionSiteKey('Site A');
 assert.deepEqual(given([{from:'06:00',to:'07:00',site:siteA}]),['SAMPLE DRIVER 31 1','SAMPLE DRIVER 31 2','SAMPLE DRIVER 32 1','SAMPLE DRIVER 33 1']);
 assert.deepEqual(given([{from:'06:00',to:'07:00',site:siteA,slot:slotA}]),['SAMPLE DRIVER 31 1','SAMPLE DRIVER 31 2','SAMPLE DRIVER 32 1']);
 assert.deepEqual(given([{from:'06:00',to:'07:00',slot:slotA}]),['SAMPLE DRIVER 31 1','SAMPLE DRIVER 31 2','SAMPLE DRIVER 32 1','SAMPLE DRIVER 34 1']);
 assert.equal(exceptionSiteKey('site a'),siteA,'a site is matched whatever its spelling');assert.equal(exceptionSiteKey(''),'');
 const rules=cleanExceptionRules([{from:'06:00',to:'07:00'},{from:'08:00',to:'08:30',site:siteA},{from:'11:00',to:'11:30',site:'site b',slot:slotA}]);
 assert.deepEqual(exceptionRulesFor(rules).map(r=>r.from),['06:00','08:00','11:00'],'all sites on screen: every saved period');
 assert.deepEqual(exceptionRulesFor(rules,siteA).map(r=>r.from),['06:00','08:00']);
 assert.deepEqual(exceptionRulesFor(rules,'site b',JSON.stringify(['2026-12-15','Shift A'])).map(r=>r.from),['06:00']);
});

test('exception time: periods through 12 at night, overlapping periods, and times longer than a shift',()=>{
 const night=tripEntries(normalise([blast(41,'Site A','Shift C','SAMPLE DRIVER 41',[trip('EX1','23:50','00:40'),trip('EX1','00:45','01:00'),trip('EX1','05:00','18:30')])]));
 for(const period of [{from:'23:30',to:'00:30'},{from:'23:50',to:'00:30'}])assert.deepEqual(loadMinutes(withExceptionTime(night,[period])).slice(0,2),[[10,'ok'],[15,'ok']],period.from);
 assert.deepEqual(loadMinutes(withExceptionTime(night,[{from:'00:00',to:'01:00'}])).slice(0,2),[[10,'ok'],[0,'ok']]);
 // 06:10 to 07:20 under 06:00 to 07:00 and 06:30 to 07:30: the half hour the two share is taken out once.
 const twice=tripEntries(normalise([blast(42,'Site A','Shift A','SAMPLE DRIVER 42',[trip('EX1','06:10','07:20'),trip('EX1','07:25','08:05')])]));
 assert.deepEqual(withExceptionTime(twice,[{from:'06:00',to:'07:00'},{from:'06:30',to:'07:30'}]).map(e=>[e['load-unload'].excepted,e['load-unload'].minutes]),[[70,0],[5,35]]);
 const long=withExceptionTime(night,[{from:'05:00',to:'13:00'}])[2]['load-unload'];
 assert.deepEqual([long.band,long.minutes,long.excepted],[null,810,0],'a time longer than a shift is a wrong clock time and stays not judged');
 assert.equal(withExceptionTime(night,[]),night);assert.equal(withExceptionTime(night,[{from:'bad',to:'07:00'}]),night);
});

test('exception time: only a sensible period is saved, once, and it is kept per login',()=>{
 assert.equal(exceptionPeriodProblem('06:00','07:00'),'');assert.equal(exceptionPeriodProblem('23:30','00:30'),'');assert.equal(exceptionPeriodProblem('05:00','13:00'),'','a whole shift is allowed');
 assert.match(exceptionPeriodProblem('','07:00'),/Enter both times/);assert.match(exceptionPeriodProblem('06:00','06:00'),/same time/);
 assert.match(exceptionPeriodProblem('07:00','06:00'),/8 hours at most/,'From and To the wrong way round would excuse 23 hours');
 const first=addExceptionRule([],{from:'06:00',to:'07:00',reason:'  Blasting  ',site:'site a',slot:slotA,where:'Site A · 14-12-26 · Shift A'});
 assert.equal(first.problem,'');assert.deepEqual(first.rules.map(r=>[r.from,r.to,r.reason,r.site,r.slot,r.where]),[['06:00','07:00','Blasting','site a',slotA,'Site A · 14-12-26 · Shift A']]);
 const again=addExceptionRule(first.rules,{from:'06:00',to:'07:00',site:'site a',slot:slotA});assert.match(again.problem,/already saved/);assert.equal(again.rules.length,1);
 const second=addExceptionRule(first.rules,{from:'06:00',to:'07:00'});assert.equal(second.problem,'');assert.equal(second.rules.length,2,'the same time for all sites is another period');
 assert.match(addExceptionRule(first.rules,{from:'07:00',to:'06:00'}).problem,/8 hours/);
 assert.deepEqual(cleanExceptionRules([null,'x',{from:'06:00'},{from:'6:00',to:'7:05:30',reason:'x'.repeat(90)}]).map(r=>[r.from,r.to,r.reason.length]),[['06:00','07:05',40]]);
 assert.equal(cleanExceptionRules('nothing').length,0);
 const kept=new Map(),storage={getItem:key=>kept.has(key)?kept.get(key):null,setItem:(key,value)=>kept.set(key,String(value)),removeItem:key=>kept.delete(key)};
 const mine=exceptionStorageKey(' Sample.User '),other=exceptionStorageKey('other.user');
 assert.notEqual(mine,other);assert.equal(mine,exceptionStorageKey('sample.user'));assert.equal(exceptionStorageKey(''),'');
 assert.deepEqual(readExceptionView(storage,mine),{on:false,rules:[]});
 assert.equal(storeExceptionView(storage,mine,{on:true,rules:second.rules}),true);
 const back=readExceptionView(storage,mine);assert.equal(back.on,true);assert.deepEqual(back.rules,second.rules);
 assert.deepEqual(readExceptionView(storage,other),{on:false,rules:[]},'another login on the same device sees the standard report');
 storeExceptionView(storage,mine,{on:true,rules:[]});assert.equal(kept.has(mine),false,'nothing is kept once the last period is removed');
 kept.set(mine,'{broken');assert.deepEqual(readExceptionView(storage,mine),{on:false,rules:[]});
 kept.set(mine,JSON.stringify({on:true,rules:[{from:'07:00',to:'06:00'}]}));assert.deepEqual(readExceptionView(storage,mine),{on:false,rules:[]},'the view cannot be on without a usable period');
});

test('the screen offers the exception time and the two views, and the standard view is the one a user starts in',()=>{
 const view=fs.readFileSync(new URL('../src/trip-timing-report.jsx',import.meta.url),'utf8');
 for(const text of ['Add exception time','Standard view','Personalised view · exception time left out','{level<5&&exceptionPanel}','In exception time (min)','Counted (min)','Band without exception'])assert.ok(view.includes(text),text);
 assert.match(view,/const entries=useMemo\(\(\)=>exception\?withExceptionTime\(rawEntries,personal\.rules\):rawEntries/,'the standard figures are untouched until the personalised view is opened');
 assert.match(view,/exceptionStorageKey\(tableLayoutAccount\(\)\)/,'kept for the signed-in login');
 const css=fs.readFileSync(new URL('../src/trip-timing-report.css',import.meta.url),'utf8');
 for(const name of ['.tt-exception','.tt-exception-form','.tt-exception-list','.tt-view','.tt-given'])assert.ok(css.includes(name),name);
});
