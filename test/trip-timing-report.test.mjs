import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {minutesBetween,bandOf,tripEntries,summarise,delayedEntries,entryRemark,BANDS} from '../shared/trip-timing-report.mjs';
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
