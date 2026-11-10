import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {minutesBetween,bandOf,tripEntries,summarise,delayedEntries,entryRemark,BANDS} from '../shared/trip-timing-report.mjs';
import {normalise} from '../src/operations-report-model.mjs';

const trip=(equipmentName,loadingTime,unloadingTime,tripCount=1)=>({equipmentName,loadingTime,unloadingTime,tripCount});
const book=(id,site,driver,door,trips,extra={})=>({id,book_no:'VLB_S'+id,book_type:'vehicle',data:{bookDate:'2026-12-14',location:site,assetId:id,door,employeeId:id,employeeName:driver,caliberId:'CMPL9000'+id,shiftId:1,shiftName:'Shift I',shiftHours:8,timeMode:'with',trips,...extra}});
const records=normalise([
 // Driver 1: trips of 8, 15, 25 and 40 minutes; gaps of 7, 12 and 31 minutes.
 book(1,'Site A','SAMPLE DRIVER 01','V9001',[trip('EX1','06:00','06:08'),trip('EX1','06:15','06:30'),trip('EX2','06:42','07:07'),trip('EX2','07:38','08:18')]),
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
 assert.deepEqual([10,10.5,20,20.5,30,30.5].map(bandOf),['ok','b1','b1','b2','b2','b3']);
 assert.equal(bandOf(null),null);assert.equal(bandOf(721),null,'longer than a shift is a wrong time, not a delay');
 assert.deepEqual(BANDS.map(b=>b.label),['10 to 20 min','20 to 30 min','30+ min']);
});

test('one entry per trip row of vehicle log books only',()=>{
 assert.equal(entries.length,9);assert.ok(entries.every(e=>e.book.startsWith('VLB_S')));
 assert.deepEqual(entries.slice(0,4).map(e=>e['load-unload'].minutes),[8,15,25,40]);
 assert.deepEqual(entries.slice(0,4).map(e=>e['unload-load'].minutes),[null,7,12,31]);
 assert.equal(entries[0]['unload-load'].counted,false,'the first trip of a card has no gap');
});

test('loading to unloading: counts per driver add up to the site line',()=>{
 const sites=summarise(entries,'load-unload','site'),a=sites.rows.find(r=>r.site==='Site A');
 assert.deepEqual([a.timed,a.ok,a.b1,a.b2,a.b3,a.over,a.notJudged,a.longest,a.driversLate],[6,2,2,1,1,4,1,40,2]);
 assert.equal(a.percent,66.7);
 const b=sites.rows.find(r=>r.site==='Site B');assert.deepEqual([b.timed,b.over,b.notJudged,b.percent,b.longest],[0,0,2,null,null]);
 assert.equal(sites.total.timed+sites.total.notJudged,9,'timed + not judged = all trip rows');
 const drivers=summarise(entries.filter(e=>e.site==='Site A'),'load-unload','driver');
 assert.deepEqual(drivers.rows.map(r=>[r.driver,r.over]),[['SAMPLE DRIVER 01',3],['SAMPLE DRIVER 02',1]],'worst first');
 for(const key of ['timed','ok','b1','b2','b3','over','notJudged'])assert.equal(drivers.rows.reduce((s,r)=>s+r[key],0),a[key],key);
});

test('unloading to next loading: first rows are left out and a missing time is not a delay',()=>{
 const drivers=summarise(entries.filter(e=>e.site==='Site A'),'unload-load','driver'),[one,two]=drivers.rows;
 assert.deepEqual([one.timed,one.ok,one.b1,one.b2,one.b3,one.notJudged],[3,1,1,0,1,0]);
 // Driver 2: 00:07 to 00:12 is 5 minutes; the next gap has no unloading time above it.
 assert.deepEqual([two.timed,two.ok,two.over,two.notJudged],[1,1,0,1]);
 const machines=summarise(entries.filter(e=>e.site==='Site A'),'unload-load','machine');
 assert.deepEqual(machines.rows.map(r=>[r.machine,r.over,r.vehicleCount]),[['EX2',2,1],['EX1',0,2]]);
});

test('delayed list is newest first, keeps one band when asked, and explains rows that are not judged',()=>{
 const one=entries.filter(e=>e.driver==='SAMPLE DRIVER 01');
 assert.deepEqual(delayedEntries(one,'load-unload').map(e=>e['load-unload'].minutes),[40,25,15]);
 assert.deepEqual(delayedEntries(one,'load-unload','b2').map(e=>e.sr),[3]);
 assert.deepEqual(delayedEntries(one,'unload-load').map(e=>[e.previousUnloadingTime,e.loadingTime,e['unload-load'].minutes]),[['07:07','07:38',31],['06:30','06:42',12]]);
 assert.match(entryRemark(entries[0]),/First trip of the card/);assert.match(entryRemark(entries[5]),/not written/);assert.equal(entryRemark(entries[1]),'');
});

test('the shared screen shows the delay views on the Trip Timing tab only',()=>{
 const screen=fs.readFileSync(new URL('../src/operations-reports.jsx',import.meta.url),'utf8');
 assert.match(screen,/id==='timing'\?<TripTimingReport records=\{selected\} loading=\{filters\.loading\}/);
 const view=fs.readFileSync(new URL('../src/trip-timing-report.jsx',import.meta.url),'utf8');
 for(const text of ['All trip rows','Step 1 · ','Step 2 · ','Step 3 · ','Step 4 · Trip card '])assert.ok(view.includes(text),text);
});
