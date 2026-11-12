import test from 'node:test';
import assert from 'node:assert/strict';
import {bandOf,idleText,percentWorked,machineShifts,summarise,idleStops,shiftsNotWorked,loadingLines,shiftTimeline,clockAt,BANDS,IDLE_LIMIT,WAIT_LIMIT,TONES} from '../shared/loading-machine-report.mjs';
import {normalise} from '../src/operations-report-model.mjs';
import fs from 'node:fs';
import {transformWithOxc} from 'vite';

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
 assert.equal(idleText(0),'0 h 00 min');assert.equal(idleText(45),'0 h 45 min');assert.equal(idleText(185),'3 h 05 min');assert.equal(idleText(null),'—');
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

test('every timed loading is one line in green, orange or red; the first loading of the shift has no colour',()=>{
 assert.deepEqual(TONES,{first:'first',ok:'green',b1:'orange',b2:'orange',b3:'orange',b4:'red'});
 const ex1=find('EX1');
 assert.deepEqual(loadingLines([ex1]).map(l=>[l.to.clock,l.to.door,l.minutes,l.band,l.tone]),[['05:10','V9001',null,'first','first'],['05:14','V9002',4,'ok','green'],['05:22','V9001',8,'b1','orange'],['05:34','V9002',12,'b2','orange'],['05:52','V9001',18,'b3','orange'],['06:20','V9002',28,'b4','red']]);
 assert.equal(ex1.ok,1);assert.equal(ex1.loadings,6);
 assert.deepEqual([loadingLines([ex1],'ok').length,loadingLines([ex1],'stops').length,loadingLines([ex1],'b4').length],[1,4,1]);
 const total=summarise(entries,'site').total;
 assert.equal(total.loadings,9,'six in Shift I and three in the night shift; a loading without a time is on no line');assert.equal(total.ok,1);
 // Lines of many shifts: newest shift first, then the machine, then the order of the shift.
 assert.deepEqual(loadingLines(entries.filter(e=>e.door==='EX1')).map(l=>l.shift+' '+l.to.clock).slice(0,2),['Shift I 05:10','Shift I 05:14']);
});

// EX6 loads four tippers in turn, stands from 05:52 to 06:10 and from 06:10 to 06:40, then loads the four again.
const waiting=normalise([
 vlb(31,'T1',[trip('EX6','05:40','06:00'),trip('EX6','06:40','07:00')]),vlb(32,'T2',[trip('EX6','05:44','06:30'),trip('EX6','06:44','07:05')]),
 vlb(33,'T3',[trip('EX6','05:48','06:20'),trip('EX6','06:48','07:10')]),vlb(34,'T4',[trip('EX6','05:52','06:37'),trip('EX6','06:55','07:15')]),
 vlb(35,'T5',[trip('EX6','06:10','06:30')]),
 // Pulse shows a breakdown of EX6 from 06:15 to 06:35 India time.
 elb(36,106,'EX6',{pulseBreakdowns:[{reference:'BD-7',description:'Hose burst',start:'2026-12-14T00:45:00.000Z',end:'2026-12-14T01:05:00.000Z',shiftStart:'2026-12-14T00:45:00.000Z',shiftEnd:'2026-12-14T01:05:00.000Z'}]})
]);
const ex6=machineShifts(waiting,{assets:[...assets,{id:'106',door:'EX6',site:'Site A',kind:'equipment',group:'Excavator',name:'SAMPLE EXCAVATOR'}]}).find(e=>e.door==='EX6');

test('an idle stop names the tipper trips delayed in it and the breakdown Pulse shows inside it',()=>{
 assert.equal(WAIT_LIMIT,15,'the limit of the Trip Timing & Gap Report');
 const stops=ex6.stopList.map(s=>[s.from.clock,s.to.clock,s.minutes,s.band,s.delayed.map(d=>[d.door,d.unloadedAt,d.loadedAt,d.waited,d.inside]),s.breakdown]);
 assert.deepEqual(stops,[
  // T1 unloaded at 06:00 and was loaded again only at 06:40: empty for 10 minutes of this stop.
  ['05:52','06:10',18,'b3',[['T1','06:00','06:40',40,10]],''],
  // T1 and T3 stood empty through the stop. T2 took 14 minutes from unloading to loading, which is no delay; T4 unloaded only 3 minutes before the stop ended.
  ['06:10','06:40',30,'b4',[['T1','06:00','06:40',40,30],['T3','06:20','06:48',28,20]],'BD-7 · Hose burst · 06:15 to 06:35'],
  ['06:48','06:55',7,'b1',[['T4','06:37','06:55',18,7]],'']
 ]);
 assert.equal(ex6.delayed,3,'T1 is one trip although it stood through two stops');
 assert.deepEqual(ex6.bdPeriods.map(p=>[p.from,p.to]),[[75,95]]);
 // A wait that runs backwards (the row above was unloaded after this loading) or is longer than a shift is not judged.
 assert.equal(find('EX1').stopList.find(s=>s.band==='b4').delayed.map(d=>d.door+' '+d.waited).join(),'V9002 30');
 assert.equal(find('EX1').delayed,1);
 assert.equal(summarise([ex6,find('EX1')],'machine').total.delayed,4);
});

test('the shift time-line lays the gaps on the hours of the shift, through midnight and without a shift start',()=>{
 assert.deepEqual([clockAt(300),clockAt(1260,200),clockAt(300,-30),clockAt(1430,10.5)],['05:00','00:20','04:30','00:00']);
 const line=shiftTimeline(ex6);
 assert.deepEqual([line.lo,line.hi,line.shiftMinutes,line.known,line.firstClock,line.lastClock],[0,480,480,true,'05:40','06:55']);
 assert.deepEqual(line.pieces.map(p=>[p.from,p.to,p.band,p.tone,p.delayed]),[[40,44,'ok','green',0],[44,48,'ok','green',0],[48,52,'ok','green',0],[52,70,'b3','orange',1],[70,100,'b4','red',2],[100,104,'ok','green',0],[104,108,'ok','green',0],[108,115,'b1','orange',1]]);
 assert.deepEqual(line.marks.map(m=>m.clock),['05:00','06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00']);
 assert.deepEqual(line.marks.filter(m=>m.edge).map(m=>m.clock),['05:00','13:00']);
 const hour=h=>[h.label,h.loadings,h.count,h.green,h.orange,h.red,h.rest,h.worst];
 // 05:00 to 06:00: four loadings (the first has no colour); 12 minutes in green, 8 of the 18-minute stop, 40 before the first loading.
 assert.deepEqual(hour(line.hours[0]),['05:00 to 06:00',4,{green:3,orange:0,red:0},12,8,0,40,'orange']);
 assert.deepEqual(hour(line.hours[1]),['06:00 to 07:00',5,{green:2,orange:2,red:1},8,17,30,5,'red']);
 assert.deepEqual(hour(line.hours[2]),['07:00 to 08:00',0,{green:0,orange:0,red:0},0,0,0,60,'rest']);
 assert.equal(line.hours.length,8);assert.deepEqual(line.breakdowns.map(b=>b.label),['BD-7 · Hose burst · 06:15 to 06:35']);
 const night=shiftTimeline(find('EX1','S3'));
 assert.deepEqual(night.pieces.map(p=>[p.from,p.to,p.fromClock,p.toClock]),[[170,176,'23:50','23:56'],[176,190,'23:56','00:10']]);
 assert.deepEqual([night.marks[0].clock,night.marks[3].clock,night.marks.at(-1).clock,night.hours[3].label],['21:00','00:00','05:00','00:00 to 01:00']);
 // A 12-hour card shift has no start time in the master: the strip starts at the first loading.
 const loose=machineShifts(normalise([vlb(41,'V9041',[trip('EX8','07:10','07:30'),trip('EX8','07:40','08:00')],{location:'Site C',shiftName:'Day',bookShiftCode:'D',masterShiftStart:'',shiftHours:12})]),{assets})[0];
 const free=shiftTimeline(loose);
 assert.deepEqual([loose.axis.known,free.lo,free.hi,free.marks.map(m=>m.clock).join(),free.pieces.map(p=>p.minutes).join()],[false,0,60,'07:10,08:10','30']);
 assert.equal(shiftTimeline(find('EX2')),null,'no loading with a time, no strip');
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

test('the screen shows working and idle time first, keeps the old list as a second view and the totals at the foot',()=>{
 const screen=fs.readFileSync(new URL('../src/loading-machine-report.jsx',import.meta.url),'utf8');
 assert.match(screen,/\[\['idle','Machine working and idle time'\],\['rows','All machines list'\]\]/);
 assert.match(screen,/const work=\[column\('trips','Trips loaded'\),column\('percent','% of shift worked'[^\n]*column\('hoursWorked','Hours worked'/,'% of shift worked sits between Trips loaded and Hours worked');
 assert.equal(screen.match(/isTotalRow=\{isTotal\}/g).length,3,'site, shift and machine tables keep their total line at the foot');
 assert.match(screen,/r\.state==='breakdown'\?'lm-row-breakdown':r\.state==='nohours'\?'lm-row-nohours'/);
 const css=fs.readFileSync(new URL('../src/loading-machine-report.css',import.meta.url),'utf8');
 assert.match(css,/tr\.lm-row-breakdown>td[^{]*\{background:#fde4e4/,'a machine in BD is a red line');
 assert.match(css,/tr\.lm-row-nohours>td[^{]*\{background:#f0e2d2/,'a machine with no hours and not in BD is a brown line');
 // The table sorts itself by a column it takes for a duration; none of these columns may be one, or the lines lose their order.
 assert.ok(!/column\('hours',|'BD hours'/.test(screen));
});

test('pressing a machine opens its shift time-line: the strip, then every loading in its colour with the tipper trips delayed',async()=>{
 const screen=fs.readFileSync(new URL('../src/loading-machine-report.jsx',import.meta.url),'utf8');
 assert.match(screen,/\{ran&&<ShiftTimelines entries=\{itemEntries\}[^\n]*onPick=\{setOnly\}\/>\}\s*\{ran&&tripChips\}\s*\{ran&&<ReportSection key=\{'lm-trips-'/,'the strip, the colour chips, then the list');
 assert.match(screen,/rows=\{lines\} columns=\{tripColumns\(manyLines\)\}[^\n]*rowClassName=\{lineClass\} onRowClick=\{l=>setCard\(l\.to\.recordId\)\}/);
 assert.match(screen,/column\('delayedCount','Tipper trips delayed'/);assert.match(screen,/column\('breakdown','Breakdown in Pulse'/);
 // With a band chosen, the machines of the shift are followed by the stops of that band, so the delayed trips show without another press.
 assert.match(screen,/\{band&&<ReportSection key=\{'lm-bandstops-'[^\n]*\n[^\n]*rows=\{bandStops\} columns=\{tripColumns\(true\)\}/);
 const {isDurationColumn}=await import('../src/duration-sort.mjs');
 for(const [,key,label] of screen.matchAll(/column\('([^']+)','([^']+)'/g))assert.ok(!isDurationColumn(label,key),label+' must not be taken for a duration, or the table reorders the lines');
 const css=fs.readFileSync(new URL('../src/loading-machine-report.css',import.meta.url),'utf8');
 for(const [tone,colour] of [['green','#edf8f0'],['orange','#fff3e0'],['red','#fde4e2']])assert.match(css,new RegExp('tr\\.lm-line-'+tone+'>td[^{]*\\{background:'+colour),'a '+tone+' loading is a '+tone+' line');
 assert.match(css,/\.lm-seg-ok\{background:#3aa863\}/);assert.match(css,/\.lm-seg-b4\{background:#d6362f/);
});

test('screens asking for the same dates share one reading of the log books; Refresh reads again',async()=>{
 const source=fs.readFileSync(new URL('../src/operations-reports.jsx',import.meta.url),'utf8');
 const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function'),'operations-reports.jsx',{jsx:{runtime:'classic'}});
 let calls=0,stopped=0;
 const fetch=(url,{signal,headers})=>{calls++;assert.equal(headers.Authorization,'Bearer token');assert.match(String(url),/^\/api\/reports\/operations\?from=2026-11-0\d&to=2026-11-13$/);signal.addEventListener('abort',()=>stopped++);const call=calls;return new Promise(resolve=>setTimeout(()=>resolve({ok:true,json:async()=>({records:[],call})}),20));};
 const operationsData=new Function('fetch',code+';return operationsData')(fetch);
 const first=operationsData('2026-11-01','2026-11-13','token',false),second=operationsData('2026-11-01','2026-11-13','token',false);
 assert.equal(calls,1,'the dashboard\'s second report does not read the month again');assert.equal(first.promise,second.promise);
 first.release();assert.equal(stopped,0,'the reading is still wanted by the other screen');
 assert.deepEqual(await second.promise,{records:[],call:1});second.release();
 const third=operationsData('2026-11-01','2026-11-13','token',false);assert.equal(calls,1,'shared for a minute');third.release();
 const refreshed=operationsData('2026-11-01','2026-11-13','token',true);assert.equal(calls,2,'Refresh reads again');
 const other=operationsData('2026-11-02','2026-11-13','token',false);assert.equal(calls,3,'other dates are another reading');
 other.release();assert.equal(stopped,1,'a reading nobody waits for is stopped');
 assert.deepEqual(await refreshed.promise,{records:[],call:2});refreshed.release();assert.equal(stopped,1,'a finished reading is not stopped');
});
