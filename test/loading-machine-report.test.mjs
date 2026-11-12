import test from 'node:test';
import assert from 'node:assert/strict';
import {bandOf,idleText,percentWorked,machineShifts,summarise,idleStops,shiftsNotWorked,BANDS,IDLE_LIMIT} from '../shared/loading-machine-report.mjs';
import {normalise} from '../src/operations-report-model.mjs';

const trip=(equipmentName,loadingTime,unloadingTime,extra={})=>({equipmentName,loadingTime,unloadingTime,tripCount:1,...extra});
const shiftI={shiftId:1,shiftName:'Shift I',shiftHours:8,masterShiftStart:'05:00',bookShiftCode:'S1'};
const shiftIII={shiftId:3,shiftName:'Shift III',shiftHours:8,masterShiftStart:'21:00',bookShiftCode:'S3'};
const vlb=(id,door,trips,extra={})=>({id,book_no:'VLB_S'+id,book_type:'vehicle',data:{bookDate:'2026-12-14',location:'Site A',assetId:id,door,employeeName:'SAMPLE DRIVER 0'+id,caliberId:'CMPL9000'+id,timeMode:'with',trips,...shiftI,...extra}});
const elb=(id,assetId,door,extra={})=>({id,book_no:'ELB'+id,book_type:'equipment',data:{bookDate:'2026-12-14',location:'Site A',assetId,door,assetName:'SAMPLE EXCAVATOR',employeeName:'SAMPLE DRIVER 1'+id,openingHmr:100,closingHmr:106,breakdownHours:0,trips:[],...shiftI,...extra}});
const assets=[
 {id:'101',door:'EX1',site:'Site A',kind:'equipment',group:'Excavator',name:'SAMPLE EXCAVATOR'},{id:'102',door:'EX2',site:'Site A',kind:'equipment',group:'Excavator',name:'SAMPLE EXCAVATOR'},
 {id:'103',door:'EX3',site:'Site A',kind:'equipment',group:'Excavator',name:'SAMPLE EXCAVATOR'},{id:'104',door:'EX4',site:'Site A',kind:'equipment',group:'Excavator',name:'SAMPLE EXCAVATOR'},
 {id:'105',door:'EX5',site:'Site A',kind:'equipment',group:'Excavator',name:'SAMPLE EXCAVATOR'},{id:'201',door:'DZ1',site:'Site A',kind:'equipment',group:'Dozer',name:'SAMPLE DOZER'},
 {id:'1',door:'V9001',site:'Site A',kind:'vehicle',group:'Tipper',name:'SAMPLE TIPPER'}];
const records=normalise([
 // EX1 loads at 05:10, 05:14, 05:22, 05:34, 05:52 and 06:20 across two tippers: gaps of 4, 8, 12, 18 and 28 minutes.
 vlb(1,'V9001',[trip('EX1','05:10','05:30'),trip('EX1','05:22','05:40'),trip('EX1','05:52','06:10')]),
 vlb(2,'V9002',[trip('EX1','05:14','05:31'),trip('EX1','05:34','05:50'),trip('EX1','06:20','06:40'),
  // An unloading-only row (the trip was loaded in the earlier shift), and a row whose loading time is not a clock time:
  // the server saves such a row with no counted trip.
  trip('EX1','','06:55'),trip('EX2','0612','06:30',{completedTrips:0})]),
 elb(11,101,'EX1'),
 // EX2: worked 4 hours with 2 hours of breakdown. EX3: breakdown for the whole shift. EX4: not in use.
 elb(12,102,'EX2',{closingHmr:104,breakdownHours:2,shiftStatus:'working_partial_breakdown'}),
 elb(13,103,'EX3',{openingHmr:0,closingHmr:0,breakdownHours:8,shiftStatus:'breakdown',statusReason:'Hydraulic hose failure',pulseBreakdowns:[{reference:'BD-9001',description:'Hose burst',start:'2026-12-14T00:30:00.000Z',end:null}]}),
 elb(14,104,'EX4',{openingHmr:0,closingHmr:0,breakdownHours:0,shiftStatus:'not_in_use'}),
 // A dozer has hours but never loads: it is not a loading machine.
 elb(15,201,'DZ1',{assetName:'SAMPLE DOZER'}),
 // Shift III runs through midnight: 23:50, 23:56, 00:10 are gaps of 6 and 14 minutes; 14:00 is a wrongly written time.
 vlb(3,'V9003',[trip('EX1','23:50','00:05'),trip('EX1','00:10','00:30'),trip('EX1','14:00','14:20')],shiftIII),
 vlb(4,'V9004',[trip('EX1','23:56','00:12')],shiftIII),
 // Another site, saved without times.
 vlb(5,'V9005',[trip('EX9','',''),trip('EX9','','')],{location:'Site B',timeMode:'without'})
]);
const fleet=[{site:'Site A',date:'2026-12-14',shift:'S1',assetId:'105',door:'EX5',name:'SAMPLE EXCAVATOR',group:'Excavator'},{site:'Site A',date:'2026-12-14',shift:'S1',assetId:'201',door:'DZ1',name:'SAMPLE DOZER',group:'Dozer'},
 // EX1 has an ELB in this shift, so its list line adds nothing.
 {site:'Site A',date:'2026-12-14',shift:'S1',assetId:'101',door:'EX1',name:'SAMPLE EXCAVATOR',group:'Excavator'}];
const batches=[{site:'Site A',date:'2026-12-14',shift:'S1',stage:'elb_open'},{site:'Site A',date:'2026-12-14',shift:'S3',stage:'vlb_open'}];
const entries=machineShifts(records,{assets,fleet,batches});
const find=(door,shiftCode='S1')=>entries.find(e=>e.door===door&&e.shiftCode===shiftCode);

test('the bands follow the owner\'s limits and the share worked is hours against the shift',()=>{
 assert.equal(IDLE_LIMIT,5);
 assert.deepEqual([4,5,5.5,10,10.5,15,15.5,20,20.5,300].map(bandOf),['ok','ok','b1','b1','b2','b2','b3','b3','b4','b4']);
 assert.equal(bandOf(null),null);
 assert.deepEqual(BANDS.map(b=>b.label),['5 to 10 min','10 to 15 min','15 to 20 min','20+ min']);
 assert.equal(percentWorked(8,8),100);assert.equal(percentWorked(6,8),75);assert.equal(percentWorked(0,8),0);assert.equal(percentWorked(6,12),50);
 assert.equal(percentWorked(null,8),null);assert.equal(percentWorked(6,null),null);
 assert.equal(idleText(0),'0 min');assert.equal(idleText(45),'45 min');assert.equal(idleText(185),'3 h 05 min');assert.equal(idleText(null),'—');
});

test('one line per loading machine and shift; machines that never load are left out',()=>{
 assert.deepEqual(entries.map(e=>e.door+' '+e.shiftCode).sort(),['EX1 S1','EX1 S3','EX2 S1','EX3 S1','EX4 S1','EX5 S1','EX9 S1']);
 assert.ok(!entries.some(e=>e.door==='DZ1'),'a dozer is not a loading machine, with an ELB or on the site list');
});

test('idle stops are the gaps between one loading and the next by the same machine, across all tippers',()=>{
 const ex1=find('EX1');
 assert.equal(ex1.state,'running');assert.equal(ex1.statusLabel,'Working');
 assert.equal(ex1.trips,6,'the unloading-only row is not a loading of this shift');
 assert.deepEqual(ex1.tippers.sort(),['V9001','V9002']);
 assert.deepEqual([ex1.b1,ex1.b2,ex1.b3,ex1.b4],[1,1,1,1]);
 assert.equal(ex1.stops,4);assert.equal(ex1.idleMinutes,66,'8 + 12 + 18 + 28; the 4-minute gap is normal working');
 assert.equal(ex1.longest,28);assert.equal(ex1.firstLoading,'05:10');assert.equal(ex1.lastLoading,'06:20');
 assert.deepEqual(ex1.stopList.map(s=>[s.from.clock,s.from.door,s.to.clock,s.to.door,s.minutes,s.band]),[['05:14','V9002','05:22','V9001',8,'b1'],['05:22','V9001','05:34','V9002',12,'b2'],['05:34','V9002','05:52','V9001',18,'b3'],['05:52','V9001','06:20','V9002',28,'b4']]);
 assert.equal(ex1.hours,6);assert.equal(ex1.shiftHours,8);assert.equal(ex1.percent,75);assert.equal(ex1.stage,'elb_open');
});

test('a night shift is ordered through midnight and a time outside the shift is not judged',()=>{
 const night=find('EX1','S3');
 assert.deepEqual(night.stopList.map(s=>[s.from.clock,s.to.clock,s.minutes,s.band]),[['23:50','23:56',6,'b1'],['23:56','00:10',14,'b2']]);
 assert.equal(night.notJudged,1);assert.equal(night.trips,4);assert.equal(night.hours,null);assert.equal(night.percent,null);
 assert.equal(night.statusLabel,'Working · ELB not entered');assert.equal(night.stage,'vlb_open');
});

test('a machine that did not run is in BD (red) or has no hours (brown)',()=>{
 const ex2=find('EX2'),ex3=find('EX3'),ex4=find('EX4'),ex5=find('EX5');
 assert.equal(ex2.state,'running');assert.equal(ex2.statusLabel,'Working, part breakdown');assert.equal(ex2.percent,50);assert.equal(ex2.bdHours,2);
 assert.equal(ex2.trips,0,'a loading time that is not a clock time is not a counted trip');assert.equal(ex2.notJudged,1);
 assert.equal(ex3.state,'breakdown');assert.equal(ex3.statusLabel,'Breakdown');assert.equal(ex3.percent,0);assert.equal(ex3.reason,'Hydraulic hose failure');
 assert.match(ex3.breakdowns,/^BD-9001 · Hose burst · 14\/12 06:00 to ongoing$/);
 assert.equal(ex4.state,'nohours');assert.equal(ex4.statusLabel,'Not in use');assert.equal(ex4.percent,0);
 assert.equal(ex5.state,'nohours');assert.equal(ex5.statusLabel,'ELB not entered');assert.equal(ex5.percent,null,'no ELB, so the hours are not known');
 const maintenance=machineShifts(normalise([elb(21,103,'EX3',{openingHmr:0,closingHmr:0,shiftStatus:'maintenance'})]),{assets})[0];
 assert.equal(maintenance.state,'breakdown');assert.equal(maintenance.statusLabel,'Maintenance');
 // An older ELB card carries no status: full-shift breakdown hours still make it red, zero hours without them brown.
 const old=machineShifts(normalise([elb(22,103,'EX3',{openingHmr:5,closingHmr:5,breakdownHours:8}),elb(23,104,'EX4',{openingHmr:5,closingHmr:5})]),{assets});
 assert.deepEqual(old.map(e=>[e.door,e.state,e.statusLabel]),[['EX3','breakdown','Breakdown'],['EX4','nohours','No hours recorded']]);
 assert.deepEqual(shiftsNotWorked(entries).map(e=>e.door),['EX3','EX4','EX5']);
});

test('site, shift and machine lines add up, with running machines first, then red, then brown',()=>{
 const sites=summarise(entries,'site');
 assert.deepEqual(sites.rows.map(r=>[r.site,r.machineShifts,r.running,r.breakdown,r.nohours,r.trips]),[['Site A',6,3,1,2,10],['Site B',1,1,0,0,2]]);
 const a=sites.rows[0];
 assert.deepEqual([a.b1,a.b2,a.b3,a.b4,a.stops,a.idleMinutes,a.longest],[2,2,1,1,6,86,28]);
 // 6 + 4 + 0 + 0 hours worked out of four 8-hour shifts with an ELB; EX5 and the night shift have no ELB and are left out.
 assert.equal(a.hours,10);assert.equal(a.shiftHours,32);assert.equal(a.percent,31.3);
 assert.equal(sites.total.machineShifts,7);assert.equal(sites.total.trips,12);assert.equal(sites.total.notJudged,4);
 const shifts=summarise(entries.filter(e=>e.site==='Site A'),'shift');
 assert.deepEqual(shifts.rows.map(r=>[r.shift,r.stageLabel,r.machineShifts,r.running]),[['Shift I','VLB locked',5,2],['Shift III','VLB still open',1,1]]);
 const machines=summarise(entries.filter(e=>e.site==='Site A'&&e.shiftCode==='S1'),'machine');
 assert.deepEqual(machines.rows.map(r=>[r.door,r.state]),[['EX1','running'],['EX2','running'],['EX3','breakdown'],['EX4','nohours'],['EX5','nohours']]);
 const together=summarise(entries.filter(e=>e.site==='Site A'),'machine').rows.find(r=>r.door==='EX1');
 assert.equal(together.machineShifts,2);assert.equal(together.statusLabel,'Ran 2 shifts');assert.equal(together.stops,6);
 assert.deepEqual(idleStops(entries,'b2').map(s=>[s.shift,s.machine,s.minutes]),[['Shift I','EX1',12],['Shift III','EX1',14]]);
 assert.equal(idleStops(entries).length,6);
});

test('the site list of a batch follows the Site and Shift filters and is left out under a card filter',()=>{
 const doors=options=>machineShifts(records,{assets,fleet,batches,...options}).filter(e=>e.statusLabel==='ELB not entered').map(e=>e.door);
 assert.deepEqual(doors({filters:{site:'Site A'}}),['EX5']);
 assert.deepEqual(doors({filters:{site:'Site B'}}),[]);
 assert.deepEqual(doors({filters:{asset:'1'}}),[]);
 assert.deepEqual(machineShifts(records.filter(r=>r.shiftId===3),{assets,fleet,batches,filters:{shift:'3'}}).map(e=>e.door+' '+e.shiftCode),['EX1 S3']);
});

test('a machine is found by the door number written on the card, and by its master id when the card carries it',()=>{
 const rows=normalise([vlb(1,'V9001',[trip('ex 01','05:10','05:30'),trip('EX-1','05:20','05:40'),trip('SOMETHING ELSE','05:30','05:50',{equipmentId:'102'})])]);
 const list=machineShifts(rows,{assets});
 assert.deepEqual(list.map(e=>[e.door,e.trips,e.names]).sort(),[['EX1',2,['ex 01','EX-1']],['EX2',1,['SOMETHING ELSE']]]);
});
