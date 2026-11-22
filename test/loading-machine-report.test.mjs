import test from 'node:test';
import assert from 'node:assert/strict';
import {bandOf,bandShare,idleText,percentWorked,machineShifts,summarise,idleStops,shiftsNotWorked,loadingLines,shiftTimeline,gapParts,clockTags,clockAt,breakdownText,mergePeriods,BANDS,IDLE_LIMIT,RED_AFTER,WAIT_LIMIT,TONES} from '../shared/loading-machine-report.mjs';
import {reportBreakdowns,readReportBreakdowns} from '../server/rules/report-pulse-breakdowns.mjs';
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
 // Shift III runs through midnight: 23:50, 23:56, 00:10 are gaps of 6 and 14 minutes; 07:30 fits the shift neither as
 // 07:30 nor as 19:30, so it is a wrongly written time (14:00 would be read as 02:00 on the night clock).
 vlb(3,'V9003',[trip('EX1','23:50','00:05'),trip('EX1','00:10','00:30'),trip('EX1','07:30','07:50')],shiftIII),
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
 assert.equal(bandShare(269,4560),5.9);assert.equal(bandShare(0,40),0);assert.equal(bandShare(0,0),null,'no timed gap, so no share');
 assert.equal(idleText(0),'0 h 00 min');assert.equal(idleText(45),'0 h 45 min');assert.equal(idleText(185),'3 h 05 min');assert.equal(idleText(null),'—');
});

test('one line per loading machine and shift; machines that never load are left out',()=>{
 assert.deepEqual(entries.map(e=>e.door+' '+e.shiftCode).sort(),['EX1 S1','EX1 S3','EX2 S1','EX3 S1','EX4 S1','EX5 S1','EX9 S1']);
 assert.ok(!entries.some(e=>e.door==='DZ1'),'a dozer is not a loading machine, with an ELB or on the site list');
});

test('equipment category (owner, 16 Nov 2026): the machine\'s group in the Equipment master, one line per category',()=>{
 assert.deepEqual(entries.map(e=>e.door+' '+e.category).sort(),['EX1 Excavator','EX1 Excavator','EX2 Excavator','EX3 Excavator','EX4 Excavator','EX5 Excavator','EX9 Group missing in master']);
 const siteA=entries.filter(e=>e.site==='Site A'),categories=summarise(siteA,'category');
 assert.deepEqual(categories.rows.map(r=>[r.category,r.machineCount,r.machineShifts]),[['Excavator',5,6]]);
 assert.equal(categories.total.category,'ALL CATEGORIES');
 const machines=summarise(siteA.filter(e=>e.category==='Excavator'),'machine');
 assert.equal(machines.total.machineShifts,categories.rows[0].machineShifts,'the machines of a category add up to its line');
 assert.equal(categories.rows[0].stops,machines.total.stops);
});

test('idle stops are the gaps between one loading and the next by the same machine, across all tippers',()=>{
 const ex1=find('EX1');
 assert.equal(ex1.state,'running');assert.equal(ex1.statusLabel,'Working');
 assert.equal(ex1.trips,6,'the unloading-only row is not a loading of this shift');
 assert.deepEqual(ex1.tippers.sort(),['V9001','V9002']);
 assert.deepEqual([ex1.b1,ex1.b2,ex1.b3,ex1.b4],[1,1,1,1]);
 assert.equal(ex1.gaps,5,'six timed loadings make five gaps, the 4-minute one included');
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
const ex6Assets=[...assets,{id:'106',door:'EX6',site:'Site A',kind:'equipment',group:'Excavator',name:'SAMPLE EXCAVATOR'}];
// EX6 as Pulse is read when the report opens with no breakdown of it, and as its ELB card copied the breakdown when saved.
const ex6=machineShifts(waiting,{assets:ex6Assets,pulseBreakdowns:[]}).find(e=>e.door==='EX6');
const ex6bd=machineShifts(waiting,{assets:ex6Assets}).find(e=>e.door==='EX6');

test('an idle stop names the tipper trips delayed in it and the breakdown Pulse shows inside it',()=>{
 assert.equal(WAIT_LIMIT,15,'the limit of the Trip Timing & Gap Report');
 const stops=ex6.stopList.map(s=>[s.from.clock,s.to.clock,s.minutes,s.band,s.delayed.map(d=>[d.door,d.unloadedAt,d.loadedAt,d.waited,d.inside]),s.breakdown]);
 assert.deepEqual(stops,[
  // T1 unloaded at 06:00 and was loaded again only at 06:40: empty for 10 minutes of this stop.
  ['05:52','06:10',18,'b3',[['T1','06:00','06:40',40,10]],''],
  // T1 and T3 stood empty through the stop. T2 took 14 minutes from unloading to loading, which is no delay; T4 unloaded only 3 minutes before the stop ended.
  ['06:10','06:40',30,'b4',[['T1','06:00','06:40',40,30],['T3','06:20','06:48',28,20]],''],
  ['06:48','06:55',7,'b1',[['T4','06:37','06:55',18,7]],'']
 ]);
 assert.equal(ex6.delayed,3,'T1 is one trip although it stood through two stops');
 assert.deepEqual(ex6.bdPeriods,[]);
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
 // 05:00 to 06:00: four loadings (the first has no colour); 12 minutes of normal working, then the 18-minute stop from
 // 05:52: green for its first 5 minutes, orange from 05:57; 40 minutes before the first loading.
 assert.deepEqual(hour(line.hours[0]),['05:00 to 06:00',4,{green:3,orange:0,red:0},17,3,0,40,'orange']);
 // 06:00 to 07:00: the rest of that stop (10 orange); the 30-minute stop 06:10 to 06:40 is 5 green, 15 orange, 10 red;
 // two loadings of 4 minutes; the 7-minute stop from 06:48 is 5 green and 2 orange up to 06:55.
 assert.deepEqual(hour(line.hours[1]),['06:00 to 07:00',5,{green:2,orange:2,red:1},18,27,10,5,'red']);
 assert.deepEqual(hour(line.hours[2]),['07:00 to 08:00',0,{green:0,orange:0,red:0},0,0,0,60,'rest']);
 assert.equal(line.hours.length,8);assert.deepEqual(line.breakdowns,[]);
 const night=shiftTimeline(find('EX1','S3'));
 assert.deepEqual(night.pieces.map(p=>[p.from,p.to,p.fromClock,p.toClock]),[[170,176,'23:50','23:56'],[176,190,'23:56','00:10']]);
 assert.deepEqual([night.marks[0].clock,night.marks[3].clock,night.marks.at(-1).clock,night.hours[3].label],['21:00','00:00','05:00','00:00 to 01:00']);
 // A 12-hour card shift has no start time in the master: the strip starts at the first loading.
 const loose=machineShifts(normalise([vlb(41,'V9041',[trip('EX8','07:10','07:30'),trip('EX8','07:40','08:00')],{location:'Site C',shiftName:'Day',bookShiftCode:'D',masterShiftStart:'',shiftHours:12})]),{assets})[0];
 const free=shiftTimeline(loose);
 assert.deepEqual([loose.axis.known,free.lo,free.hi,free.marks.map(m=>m.clock).join(),free.pieces.map(p=>p.minutes).join()],[false,0,60,'07:10,08:10','30']);
 assert.equal(shiftTimeline(find('EX2')),null,'no loading with a time, no strip');
});

test('on the strip a gap turns orange at its 5th minute and red at its 20th, with the clock time of each turn',()=>{
 assert.equal(RED_AFTER,20);
 assert.deepEqual(gapParts(0,4),[{from:0,to:4,tone:'green'}]);
 assert.deepEqual(gapParts(10,15),[{from:10,to:15,tone:'green'}],'exactly 5 minutes stays green');
 assert.deepEqual(gapParts(10,30).map(p=>p.tone),['green','orange'],'exactly 20 minutes never turns red');
 assert.deepEqual(gapParts(220,256),[{from:220,to:225,tone:'green'},{from:225,to:240,tone:'orange'},{from:240,to:256,tone:'red'}]);
 const line=shiftTimeline(ex6);
 const stop=line.pieces.find(p=>p.minutes===30);
 assert.deepEqual(stop.turns.map(t=>[t.clock,t.tone]),[['06:15','orange'],['06:30','red']]);
 assert.deepEqual([stop.fromClock,stop.fromDoor,stop.toClock,stop.door],['06:10','T5','06:40','T1']);
 assert.deepEqual(line.pieces.find(p=>p.minutes===18).turns.map(t=>t.clock),['05:57']);
 assert.deepEqual(line.pieces.filter(p=>p.band==='ok').flatMap(p=>p.turns),[],'a green gap has no turn');
 // Every minute of every gap is drawn in exactly one colour.
 for(const p of line.pieces)assert.equal(p.parts.reduce((s,x)=>s+x.to-x.from,0),p.to-p.from);
 // The whole 8-hour shift is drawn: the time before the first loading and after the last is named.
 assert.deepEqual(line.lead,{from:0,to:40,clock:'05:40',minutes:40});
 assert.deepEqual(line.tail,{from:115,to:480,clock:'06:55',minutes:365});
 assert.equal(line.ticks.length,24,'a tick every quarter of an hour between the 9 hour marks');assert.ok(line.ticks.every(m=>m%15===0&&m%60));
 const loose=machineShifts(normalise([vlb(41,'V9041',[trip('EX8','07:10','07:30'),trip('EX8','07:40','08:00')],{location:'Site C',shiftName:'Day',bookShiftCode:'D',masterShiftStart:'',shiftHours:12})]),{assets})[0];
 assert.deepEqual([shiftTimeline(loose).lead,shiftTimeline(loose).tail],[null,null],'without the shift hours there is no before or after');
 assert.deepEqual(shiftTimeline(loose).pieces[0].turns.map(t=>t.clock),['07:15','07:30']);
});

test('the clock tags under a strip never overlap; red stops come first and a tag at the end of the strip reads leftwards',()=>{
 const line=shiftTimeline(ex6);
 // A letter is 2 minutes of the strip here, so the tags of the 30-minute stop crowd each other.
 const tags=clockTags(line,{width:2,lanes:3});
 assert.deepEqual(tags.map(g=>[g.text,g.lane]),[['05:57 orange',1],['06:15 orange',0],['06:30 red',1],['06:40 loaded',2],['06:53 orange',0]]);
 for(const a of tags)for(const b of tags)if(a!==b&&a.lane===b.lane){
  const span=g=>g.end?[g.at-g.text.length*2,g.at]:[g.at,g.at+g.text.length*2];
  const [a1,a2]=span(a),[b1,b2]=span(b);assert.ok(a2+2<=b1||b2+2<=a1,a.text+' and '+b.text+' overlap');
 }
 // With one row the red stop is served first and what does not fit is left to the pop-up and the list.
 assert.deepEqual(clockTags(line,{width:2,lanes:1}).map(g=>g.text),['06:15 orange','06:53 orange']);
 // A tag that would run past the end of the strip is drawn to the left of its time.
 const late={hi:100,pieces:[{id:'p',band:'b4',tone:'red',minutes:30,to:99,toClock:'13:59',turns:[{at:74,tone:'orange',clock:'13:34'},{at:89,tone:'red',clock:'13:49'}]}]};
 assert.deepEqual(clockTags(late,{width:1,lanes:3}).map(g=>[g.text,g.end,g.lane]),[['13:34 orange',false,0],['13:49 red',false,0],['13:59 loaded',true,1]]);
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
 // Each band has its own share of the 7 timed gaps of the site (5 in Shift I and 2 in Shift III): 2, 2, 1 and 1 stops.
 assert.equal(a.gaps,7);assert.deepEqual([a.b1Share,a.b2Share,a.b3Share,a.b4Share],[28.6,28.6,14.3,14.3]);
 const b=sites.rows[1];assert.equal(b.gaps,0);assert.deepEqual([b.b1Share,b.b4Share],[null,null],'cards saved without times give no share');
 assert.equal(sites.total.gaps,7);assert.equal(sites.total.b3Share,14.3);
 // 6 + 4 + 0 + 0 hours worked out of four 8-hour shifts with an ELB; EX5 and the night shift have no ELB and are left out.
 assert.equal(a.hours,10);assert.equal(a.shiftHours,32);assert.equal(a.percent,31.3);
 assert.equal(sites.total.machineShifts,7);assert.equal(sites.total.trips,12);assert.equal(sites.total.notJudged,4);
 const shifts=summarise(entries.filter(e=>e.site==='Site A'),'shift');
 assert.deepEqual(shifts.rows.map(r=>[r.shift,r.stageLabel,r.machineShifts,r.running]),[['Shift I','VLB locked',5,2],['Shift III','VLB still open',1,1]]);
 const machines=summarise(entries.filter(e=>e.site==='Site A'&&e.shiftCode==='S1'),'machine');
 // Owner, 17 Nov 2026: the running machines with the fewest hours worked on top: EX2 (4 h) before EX1 (6 h).
 assert.deepEqual(machines.rows.map(r=>[r.door,r.state]),[['EX2','running'],['EX1','running'],['EX3','breakdown'],['EX4','nohours'],['EX5','nohours']]);
 assert.deepEqual(machines.rows.slice(0,2).map(r=>r.hours),[4,6]);
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

test('Step 3 leaves First and Last loading, Shift hours, Hours in BD and Not judged to Smart Print so it fits the screen',()=>{
 const screen=fs.readFileSync(new URL('../src/loading-machine-report.jsx',import.meta.url),'utf8');
 assert.match(screen,/\[column\('firstLoading','First loading'\),column\('lastLoading','Last loading'\)\]\.map\(printOnly\)/);
 assert.match(screen,/\.\.\.more\.map\(printOnly\),column\('reason','Remark'\)/);
 assert.match(screen,/const printOnly=c=>\(\{\.\.\.c,printOnly:true\}\);/);
 const main=fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/visibleColumnKeys = stepLook \? columns\.filter\(\(column\) => !column\.printOnly\)\.map\(\(column\) => column\.key\) : appliedColumns;/,'not on the screen');
 assert.match(main,/columns: withExportSerial\(stepLook \? columns : displayedColumns\), allColumns: withExportSerial\(columns\)/,'still in Smart Print, PDF and Excel');
});

test('the screen shows working and idle time first, keeps the old list as a second view and the totals at the foot',()=>{
 const screen=fs.readFileSync(new URL('../src/loading-machine-report.jsx',import.meta.url),'utf8');
 // Owner, 17 Nov 2026: BD hours (Pulse + ELB) and BD mismatch sit between the two (test/bd-hours-report.test.mjs).
 assert.match(screen,/\[\['idle','Machine working and idle time'\],\['bd','BD hours \(Pulse \+ ELB\)'\],\['mismatch','BD mismatch'\],\['rows','All machines list'\]\]/);
 assert.match(screen,/const work=\[column\('trips','Trips loaded'\),column\('percent','% of shift worked'[^\n]*column\('hoursWorked','Hours worked'/,'% of shift worked sits between Trips loaded and Hours worked');
 // Step 2 is the date by shift table (owner, 15 Nov 2026), with its All dates line at the foot of the grid.
 assert.equal(screen.match(/isTotalRow=\{isTotal\}/g).length,3,'site, category and machine tables keep their total line at the foot');
 assert.match(screen,/<DateShiftGrid grid=\{shiftGrid\}/);
 assert.match(screen,/r\.state==='breakdown'\?'lm-row-breakdown':r\.state==='nohours'\?'lm-row-nohours'/);
 assert.match(screen,/const idle=onPick=>\[\.\.\.BANDS\.map\(b=>banded\(b,onPick\)\)/,'every idle band carries its own percentage');
 assert.match(screen,/r\[key\]\+' \('\+share\(r\)\+'\)'/,'the printed and downloaded report carries the percentage beside the count');
 assert.match(screen,/<span className="lm-share"[^>]*>\{share\(r\)\}<\/span>/,'the percentage sits just beside the coloured count');
 const css=fs.readFileSync(new URL('../src/loading-machine-report.css',import.meta.url),'utf8');
 assert.match(css,/\.lm-banded\{[^}]*white-space:nowrap/,'count and percentage stay on one line');
 assert.match(css,/tr\.lm-row-breakdown>td[^{]*\{background:#fde4e4/,'a machine in BD is a red line');
 assert.match(css,/tr\.lm-row-nohours>td[^{]*\{background:#f0e2d2/,'a machine with no hours and not in BD is a brown line');
 // The table sorts itself by a column it takes for a duration; none of these columns may be one, or the lines lose their order.
 assert.ok(!/column\('hours',|'BD hours'/.test(screen));
});

test('pressing a machine opens its shift time-line: the strip, then every loading in its colour with the tipper trips delayed',async()=>{
 const screen=fs.readFileSync(new URL('../src/loading-machine-report.jsx',import.meta.url),'utf8');
 assert.match(screen,/\{\(focus\|\|!stacked\)&&ran&&<ShiftTimelines entries=\{shownEntries\}[^\n]*onPick=\{setOnly\}\/>\}\s*\{ran&&tripChips\}\s*\{ran&&<ReportSection key=\{'lm-trips-'/,'the strip, the colour chips, then the list');
 // A machine over many shifts: one strip per shift (Step 5); pressing one opens that shift full width (Step 6).
 assert.match(screen,/\{stacked&&<ShiftTimelines entries=\{itemEntries\} step="Step 5 · "[^\n]*onOpen=\{openStrip\}/);
 assert.match(screen,/const listStep=stacked&&focus\?6:5,cardStep=listStep\+1;/);
 // Owner, 16 Nov 2026: Step 3 is the shift by equipment category; a category opens its machines as Step 4.
 assert.match(screen,/title=\{'Step 3 · Loading machines · '\+slotWhere\+' · by equipment category'\+filtered\}/);
 assert.match(screen,/columns=\{summaryColumns\('category',openCategory\)\}[^\n]*onRowClick=\{r=>openCategory\(r\)\}/);
 assert.match(screen,/title=\{'Step 4 · Loading machines · '\+where\+filtered\}/);
 // Step 3 is under the grid as soon as a site is open, for every date and shift until a box is pressed.
 assert.match(screen,/const slotEntries=!site\?\[\]:!slot\?siteEntries:/);
 assert.match(screen,/onOpenAll=\{\(\)=>openSlot\(shifts\.total\)\}[^\n]*\n[^\n]*allPicked=\{allShifts\}/);
 assert.match(screen,/const openSlot=\(row,pick=only\)=>\{setSlot\(row\.total\?null:/);
 assert.match(screen,/rows=\{lines\} columns=\{tripColumns\(manyLines,manySites\)\}[^\n]*rowClassName=\{l=>lineClass\(l\)[^\n]*onRowClick=\{l=>setCard\(l\.to\.recordId\)\}/);
 assert.match(screen,/column\('delayedCount','Tipper trips delayed'/);assert.match(screen,/column\('breakdown','Breakdown in Pulse'/);
 // With a band chosen, the machines of the shift are followed by the stops of that band, so the delayed trips show without another press.
 assert.match(screen,/\{band&&<ReportSection key=\{'lm-bandstops-'[^\n]*\n[^\n]*rows=\{bandStops\} columns=\{tripColumns\(true,manySites\)\}/);
 // Owner, 16 Nov 2026: every list opened from All sites names the site; Step 2 keeps one line per date and site.
 assert.match(screen,/const manySites=site===EVERY;/);
 assert.match(screen,/lineOf:r=>manySites\?siteDateLine\(r\):dateLine\(r\)/);
 assert.match(screen,/columns=\{machineColumns\(openItem,allShifts,manySites\)\}/);
 assert.match(screen,/columns=\{notWorkedColumns\(manySites,openBd\)\}/);
 const {isDurationColumn}=await import('../src/duration-sort.mjs');
 for(const [,key,label] of screen.matchAll(/column\('([^']+)','([^']+)'/g))assert.ok(!isDurationColumn(label,key),label+' must not be taken for a duration, or the table reorders the lines');
 const css=fs.readFileSync(new URL('../src/loading-machine-report.css',import.meta.url),'utf8');
 for(const [tone,colour] of [['green','#edf8f0'],['orange','#fff3e0'],['red','#fde4e2']])assert.match(css,new RegExp('tr\\.lm-line-'+tone+'>td[^{]*\\{background:'+colour),'a '+tone+' loading is a '+tone+' line');
 assert.match(css,/\.lm-part-green,\.lm-report \.lm-seg-ok\{background:#3aa863\}/);assert.match(css,/\.lm-part-orange\{background:#ffb04d\}/);assert.match(css,/\.lm-part-red,\.lm-report \.lm-seg-b4\{background:#d6362f\}/);
 assert.match(css,/\.lm-tag-end\{transform:translateX\(-100%\)/,'a tag at the end of the strip reads leftwards');
});

test('a piece of the strip reads in full: the loading before, each turn of colour by the clock, the next loading',async()=>{
 const source=fs.readFileSync(new URL('../src/loading-machine-report.jsx',import.meta.url),'utf8');
 const start=source.indexOf('export function pieceText'),end=start+source.slice(start).search(/\r?\n\}\r?\n/)+3;
 const pieceText=new Function('BAND_LABELS','plural',source.slice(start,end).replace('export ','')+';return pieceText;')({b1:'5 to 10 min',b4:'20+ min'},(n,one)=>n+' '+one+(n===1?'':'s'));
 const p=shiftTimeline(ex6).pieces.find(x=>x.minutes===30);
 assert.equal(pieceText(p),'06:10 loading (T5) → 06:15 turned orange → 06:30 turned red → 06:40 next loading (T1) · 30 min idle · 20+ min · 2 tipper trips delayed');
 // The same gap with 20 minutes of breakdown in it: the breakdown and its end take their place among the turns.
 const q=shiftTimeline(ex6bd).pieces.find(x=>x.gap===30);
 assert.equal(pieceText(q),'06:10 loading (T5) → 06:15 breakdown → 06:35 breakdown over, orange → 06:40 next loading (T1) · 30 min between loadings, 20 min of it in breakdown · 10 min idle · 5 to 10 min · 1 tipper trip delayed · Breakdown in Pulse: BD-7 · Hose burst · 06:15 to 06:35');
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

// Owner, 15 Nov 2026: "if a vehicle is BD for around 15 minutes, 1 hour or 2 hours, it should show in black. And upon
// clicking it, it should show the reason of breakdown also." Then: "Yes, take BD out of idle and build it".
test('a breakdown is black on the strip and the idle clock stops while it lasts',()=>{
 assert.deepEqual(mergePeriods([{from:30,to:50},{from:10,to:20},{from:15,to:35}]),[{from:10,to:50}]);
 // 10 idle minutes (5 green, 5 orange), 30 minutes of breakdown, then the clock goes on from 10: orange till its 20th minute, then red.
 assert.deepEqual(gapParts(0,60,[{from:10,to:40}]),[{from:0,to:5,tone:'green'},{from:5,to:10,tone:'orange'},{from:10,to:40,tone:'bd'},{from:40,to:50,tone:'orange'},{from:50,to:60,tone:'red'}]);
 // A breakdown at the start of the gap: the clock starts when it ends.
 assert.deepEqual(gapParts(0,30,[{from:-10,to:20}]),[{from:0,to:20,tone:'bd'},{from:20,to:25,tone:'green'},{from:25,to:30,tone:'orange'}]);
 assert.deepEqual(gapParts(0,30,[{from:0,to:30}]),[{from:0,to:30,tone:'bd'}],'a gap wholly in breakdown is all black');
 assert.deepEqual(gapParts(0,30,[{from:40,to:50}]),gapParts(0,30),'a breakdown outside the gap changes nothing');
});

test('the minutes in breakdown are taken out of the idle stop, its band and the tipper trips delayed',()=>{
 const stops=ex6bd.stopList.map(s=>[s.from.clock,s.to.clock,s.gap,s.bdMinutes,s.minutes,s.band,s.delayed.map(d=>[d.door,d.inside]),s.breakdown]);
 assert.deepEqual(stops,[
  ['05:52','06:10',18,0,18,'b3',[['T1',10]],''],
  // 30 minutes between two loadings, 20 of them in breakdown: a 10-minute stop. T1 stood empty 10 idle minutes of it; T3,
  // unloaded at 06:20, stood empty only 5 minutes outside the breakdown, which is no delay.
  ['06:10','06:40',30,20,10,'b1',[['T1',10]],'BD-7 · Hose burst · 06:15 to 06:35'],
  ['06:48','06:55',7,0,7,'b1',[['T4',7]],'']
 ]);
 assert.deepEqual([ex6bd.b1,ex6bd.b3,ex6bd.b4,ex6bd.idleMinutes,ex6bd.longest,ex6bd.bdMinutes,ex6bd.delayed],[2,1,0,35,18,20,2]);
 assert.equal(summarise([ex6bd,ex6],'machine').total.bdMinutes,20);
 assert.deepEqual(ex6bd.bdPeriods.map(b=>[b.from,b.to,b.minutes,b.fromClock,b.toClock,b.reference,b.reason]),[[75,95,20,'06:15','06:35','BD-7','Hose burst']]);
});

test('the strip draws the breakdown black with its clock times, and the hours count its minutes',()=>{
 const line=shiftTimeline(ex6bd);
 assert.deepEqual(line.breakdowns.map(b=>[b.from,b.to]),[[75,95]]);
 const gap=line.pieces.find(p=>p.gap===30);
 assert.deepEqual(gap.parts,[{from:70,to:75,tone:'green'},{from:75,to:95,tone:'bd'},{from:95,to:100,tone:'orange'}]);
 assert.deepEqual(gap.turns,[],'the breakdown and its end are marked by the breakdown itself');
 assert.deepEqual(gap.events.map(e=>e.clock+' '+e.words),['06:15 breakdown','06:35 breakdown over, orange']);
 const hour=line.hours[1];
 assert.deepEqual([hour.green,hour.orange,hour.red,hour.bd,hour.rest],[18,17,0,20,5]);
 assert.equal(line.bdMinutes,20);
 // The breakdown's tags come first.
 assert.deepEqual(clockTags(line,{width:2,lanes:3}).filter(g=>g.breakdown).map(g=>g.text),['06:15 BD','06:35 BD over']);
 assert.equal(breakdownText(line.breakdowns[0]),'Breakdown · 06:15 to 06:35 · 20 min in this shift · Pulse BD-7 · Reason: Hose burst · Restored (from 14/12 06:15 to 14/12 06:35)');
 assert.equal(breakdownText({...line.breakdowns[0],minutes:135,ongoing:true}),'Breakdown · 06:15 to 06:35 · 2 h 15 min in this shift · Pulse BD-7 · Reason: Hose burst · Still open in Pulse (started 14/12 06:15)');
});

test('Pulse read when the report opens wins over the copy on the ELB card, and a machine down all shift is drawn black',()=>{
 const feed=[
  {ref:'BD-21',site:'Site A',door:'EX6',start:'2026-12-14T00:40:00.000Z',end:'2026-12-14T01:10:00.000Z',status:'Closed',reason:'Engine overheating'},
  {ref:'BD-22',site:'Site B',door:'EX6',start:'2026-12-14T00:40:00.000Z',end:null,status:'Ongoing',reason:'Another site'},
  // EX5 has no ELB and no loading: Pulse shows it down for the whole shift, 05:00 to 13:00 India time, still open.
  {ref:'BD-23',site:'Site A',door:'EX5',start:'2026-12-13T22:00:00.000Z',end:null,status:'Ongoing',reason:'Gear box'}
 ];
 const live=machineShifts(waiting,{assets:ex6Assets,pulseBreakdowns:feed}).find(e=>e.door==='EX6');
 assert.deepEqual(live.bdPeriods.map(b=>[b.reference,b.fromClock,b.toClock,b.reason]),[['BD-21','06:10','06:40','Engine overheating']],'the card copy BD-7 is not used');
 assert.deepEqual(['minutes','band'].map(k=>live.lines.find(l=>l.gap===30)[k]),[0,'ok'],'a gap wholly in breakdown is no idle stop');
 const all=machineShifts(records,{assets,fleet,batches,pulseBreakdowns:feed,now:Date.parse('2026-12-14T09:00:00.000Z')});
 const ex5=all.find(e=>e.door==='EX5');
 assert.deepEqual([ex5.state,ex5.statusLabel,ex5.bdMinutes],['breakdown','Breakdown in Pulse',480]);
 const line=shiftTimeline(ex5);
 assert.deepEqual([line.pieces.length,line.empty,line.breakdowns.map(b=>[b.from,b.to,b.ongoing])],[0,{from:0,to:480},[[0,480,true]]]);
 assert.equal(shiftTimeline(find('EX5')),null,'without Pulse there is nothing to draw');
});

test('the report reads Pulse breakdowns of the chosen dates and sites only, and never waits long for Pulse',async()=>{
 const rows=[
  {ref:'A',site:'Site A',door:'EX1',start:'2026-11-07 08:10',closedAt:'2026-11-07 10:25',status:'Closed',description:'Hydraulic hose burst'},
  {ref:'B',site:'Site A',door:'EX1',start:'2026-10-01 08:10',closedAt:'2026-10-01 09:00'},
  {ref:'C',site:'Site Z',door:'EX1',start:'2026-11-07 08:10',closedAt:'—'},
  {ref:'D',site:'Site A',door:'EX2',start:'2026-11-07 08:10',closedAt:'',vehicleIdle:true,idealApprovedAt:'2026-11-07 09:00',reason:'Pump'},
  {ref:'E',site:'Site A',door:'EX3',start:'2026-11-07 08:10',archivedAt:'2026-11-08'},
  {ref:'F',site:'Site A',door:'EX4',start:'2026-11-05 08:10',closedAt:'—',category:'Electrical'}
 ];
 const list=reportBreakdowns(rows,{from:'2026-11-07',to:'2026-11-07',siteAllowed:site=>site!=='Site Z'});
 assert.deepEqual(list.map(r=>[r.ref,r.start,r.end,r.status,r.reason]),[
  ['A','2026-11-07T02:40:00.000Z','2026-11-07T04:55:00.000Z','Closed','Hydraulic hose burst'],
  // Moved to idle in Pulse: the breakdown ends when the machine went idle.
  ['D','2026-11-07T02:40:00.000Z','2026-11-07T03:30:00.000Z','Restored','Pump'],
  ['F','2026-11-05T02:40:00.000Z',null,'Ongoing','Electrical']
 ]);
 const slow=await readReportBreakdowns(()=>new Promise(()=>{}),{from:'2026-11-07',to:'2026-11-07',waitMs:20});
 assert.deepEqual(slow,{pulseBreakdowns:null,pulseBreakdownsError:'Pulse did not answer in time.'});
 const fine=await readReportBreakdowns(async()=>rows,{from:'2026-11-07',to:'2026-11-07'});
 assert.equal(fine.pulseBreakdowns.length,4);
 const route=fs.readFileSync(new URL('../server/routes/log-book.mjs',import.meta.url),'utf8');
 assert.match(route,/!withScans&&pulseMasterSync\?await readReportBreakdowns\(/);
 assert.match(route,/chassis:text\(r\.chassisNo\|\|r\.chassis\)/);
 const screen=fs.readFileSync(new URL('../src/loading-machine-report.jsx',import.meta.url),'utf8');
 assert.match(screen,/machineShifts\(records,\{assets,fleet,batches,filters,pulseBreakdowns\}\)/);
 assert.match(screen,/className=\{'lm-bd'/);
 assert.match(screen,/breakdownText\(saidBd\)/);
 assert.match(fs.readFileSync(new URL('../src/operations-reports.jsx',import.meta.url),'utf8'),/pulseBreakdowns=\{data\.pulseBreakdowns\?\?null\}/);
});

// Owner, 15 Nov 2026: "Fix the cut-off BD over label". On his screen the strip was about 560 px wide, so "12:12 BD over" ran
// past the end of an 8-hour shift; the tags are now placed by the real width of the strip, padding included.
test('a tag near the end of a narrow strip reads leftwards instead of running off it',()=>{
 const t={lo:0,hi:480,shiftMinutes:480,pieces:[],breakdowns:[{id:'bd',from:305,to:432,fromClock:'10:05',toClock:'12:12',minutes:127,ongoing:false}]};
 const placed=px=>{const per=480/px;return clockTags(t,{width:7.4*per,pad:16*per,lanes:3}).map(g=>[g.text,g.end]);};
 assert.deepEqual(placed(560),[['10:05 BD',false],['12:12 BD over',true]],'560 px: drawn to the left of 12:12');
 assert.deepEqual(placed(1400),[['10:05 BD',false],['12:12 BD over',false]],'1,400 px: room to the right');
 const screen=fs.readFileSync(new URL('../src/loading-machine-report.jsx',import.meta.url),'utf8');
 assert.match(screen,/<div ref=\{track\} className="lm-tl-track"/);
 assert.match(screen,/clockTags\(t,\{width:7\.4\*perPx,pad:16\*perPx,lanes:3\}\)/);
 assert.match(screen,/new ResizeObserver\(measure\)/);
 const css=fs.readFileSync(new URL('../src/loading-machine-report.css',import.meta.url),'utf8');
 assert.match(css,/\.lm-hour-counts\{display:flex;flex-wrap:wrap;/,'the BD minutes of an hour wrap instead of being cut off');
});

test('All-sites lists carry a Site column and a machine line names every site it worked at',()=>{
 const source=fs.readFileSync(new URL('../src/loading-machine-report.jsx',import.meta.url),'utf8');
 assert.match(source,/const siteColumn=\(manySites,key='site'\)=>manySites\?\[column\(key,'Site'\)\]:\[\];/);
 assert.match(source,/export function machineColumns\(onPick,manyShifts=false,manySites=false\)\{\r?\n return \[\.\.\.siteColumn\(manySites,'sites'\),column\('door','Door no\.'\)/);
 assert.match(source,/column\('date','Date',l=>day\(l\.date\)\),column\('shift','Shift'\)\]:\[\]\),\.\.\.siteColumn\(manySites\),\.\.\.\(many\?\[column\('machine','Loading machine'\)\]:\[\]\)/);
 assert.match(source,/export const notWorkedColumns=\(manySites=false,onBreakdown=null\)=>\[column\('date','Date',e=>day\(e\.date\)\),column\('shift','Shift'\),\.\.\.siteColumn\(manySites\),/);
 // One machine seen at two sites in the chosen dates stays one line that names both.
 const one=entries[0],moved=[one,{...one,site:'Site Z',slotKey:one.slotKey+'-z',id:one.id+'-z'}];
 assert.equal(summarise(moved,'machine').rows[0].sites,one.site+', Site Z');
 assert.equal(summarise([one],'machine').rows[0].sites,one.site);
});

// Owner, 17 Nov 2026 (photo 2): Step 4 runs from the fewest hours worked to the most (2.5 h before 3 h); a running machine
// with no hours on its ELB comes after them, then the machines in BD and with no hours, as before.
test('Step 4 lists the running machines from the fewest hours worked to the most',()=>{
 const base=entries.find(e=>e.state==='running');
 const make=(door,state,hours,idleMinutes)=>({...base,id:base.id+door,machineKey:'m-'+door,door,state,hours,idleMinutes,lines:[],stops:0,trips:1});
 const list=[make('A','running',3,10),make('B','running',2.5,5),make('C','running',null,90),make('D','breakdown',0,0),make('E','running',3,40),make('F','nohours',null,0)];
 const order=summarise(list,'machine').rows.map(r=>r.door);
 assert.deepEqual(order,['B','E','A','C','D','F'],'2.5 h first; equal hours: the most idle first; no ELB hours after the running ones with hours');
});

test('Step 4 carries the tick that draws the chart of every machine of one shift, in the order of the list',()=>{
 const screen=fs.readFileSync(new URL('../src/loading-machine-report.jsx',import.meta.url),'utf8');
 assert.match(screen,/headingControl=\{<label className="lm-chart-tick"[^\n]*<input type="checkbox" checked=\{chartAll\}[^\n]*Show chart of every machine/);
 assert.match(screen,/const chartItems=chartAll&&slot&&category\?machinesListed\.map\(\(row,i\)=>\(\{row,sr:i\+1,/,'charts follow the lines of Step 4 with their Sr. No.');
 assert.match(screen,/\{chartAll&&<MachineCharts items=\{chartItems\}[^\n]*slotPicked=\{Boolean\(slot\)\}/);
 assert.match(screen,/Pick one shift box in Step 2 above to see the chart of every machine of that shift\./,'every date and shift open draws nothing');
 assert.match(screen,/<Strip entry=\{e\} label="" single onPick=\{\(\)=>\{\}\} onOpen=\{\(\)=>onOpen\(row\)\}\/>/,'each chart is the full photo-1 strip and opens its machine');
 assert.match(screen,/@page\{size:A3 landscape;margin:8mm\}/);
 assert.match(screen,/\.lm-chart-card:nth-of-type\(3n\)\{break-after:page/,'three machines a page');
 // New state goes after the old, so the screen tests that feed useState by position keep working.
 const states=[...screen.slice(screen.indexOf('export default function LoadingMachineReport')).matchAll(/useState\(/g)].length;
 assert.ok(screen.indexOf('[chartAll,setChartAll]=useState(false)')>screen.indexOf('[bdShift,setBdShift]=useState('),'the tick is the last state');
 assert.ok(states>=10);
});

test('the Sr. No. of a chart is red for 1 to 5, orange for 6 to 10 and green after',()=>{
 const screen=fs.readFileSync(new URL('../src/loading-machine-report.jsx',import.meta.url),'utf8');
 const srTone=new Function('return '+/export const srTone=([^;]+);/.exec(screen)[1])();
 assert.deepEqual([1,5,6,10,11,40].map(srTone),['red','red','orange','orange','green','green']);
 const css=fs.readFileSync(new URL('../src/loading-machine-report.css',import.meta.url),'utf8');
 for(const [tone,colour] of [['red','#dc2626'],['orange','#ea580c'],['green','#16a34a']])assert.ok(css.includes(`.lm-chart-sr.lm-sr-${tone}{background:${colour}}`),tone);
});
