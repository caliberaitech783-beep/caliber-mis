import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readOnShiftClock,shiftWindowOf,cardOnShiftClock,shiftClockNote} from '../shared/shift-clock.mjs';
import {tripEntries,entryRemark} from '../shared/trip-timing-report.mjs';
import {normalise} from '../src/operations-report-model.mjs';

const C={start:21*60,hours:8,label:'21:00–05:00'},B={start:13*60,hours:8,label:'13:00–21:00'},A={start:5*60,hours:8,label:'05:00–13:00'};
const read=(value,window)=>readOnShiftClock(value,window).time;

test('Shift C reads a 12-hour written time on the night clock', () => {
  assert.equal(read('12:50',C),'00:50');
  assert.equal(read('9:30',C),'21:30');
  assert.equal(read('11:00',C),'23:00');
  assert.equal(read('4:03',C),'04:03');
  assert.equal(read('04:03',C),'04:03');
  assert.equal(read('23:15',C),'23:15');
  assert.equal(readOnShiftClock('12:50',C).written,'12:50');
  assert.equal(readOnShiftClock('04:03',C).written,'');
});

test('Shift B and Shift A read on their own clocks', () => {
  assert.equal(read('2:30',B),'14:30');
  assert.equal(read('8:45',B),'20:45');
  assert.equal(read('1:05',B),'13:05');
  assert.equal(read('6:10',A),'06:10');
  assert.equal(read('12:30',A),'12:30');
  assert.equal(read('1:00',A),'13:00');
});

test('slack: a trip may start an hour early or run two hours over', () => {
  assert.equal(read('4:20',A),'04:20');
  assert.equal(read('5:40',C),'05:40');
  assert.equal(read('6:50',C),'06:50');
  assert.equal(readOnShiftClock('6:50',C).outside,false);
});

test('a time outside the shift either way stays as written and is marked', () => {
  assert.equal(read('14:30',C),'02:30');assert.equal(read('13:37',C),'01:37');assert.equal(readOnShiftClock('13:37',C).written,'13:37');
  const r=readOnShiftClock('7:30',C);
  assert.equal(r.time,'07:30');assert.equal(r.outside,true);assert.equal(r.written,'');
  assert.equal(readOnShiftClock('19:30',C).outside,true);
  assert.equal(read('8:00',C),'20:00');
});

test('seconds, blanks and bad values pass through', () => {
  assert.equal(read('12:50:30',C),'00:50:30');
  assert.equal(readOnShiftClock('',C).time,'');
  assert.equal(readOnShiftClock('ab',C).time,'ab');
  assert.equal(readOnShiftClock('12:50',null).time,'12:50');
});

test('a 12-hour Day shift keeps the written hour when both fit', () => {
  const day={start:8*60,hours:12,label:'08:00–20:00'};
  assert.equal(read('8:00',day),'08:00');
  assert.equal(read('3:15',day),'15:15');
  assert.equal(read('20:30',day),'20:30');
  assert.equal(read('7:30',day),'19:30');
});

test('the shift window comes from the saved start, else the marked shift', () => {
  assert.deepEqual(shiftWindowOf({masterShiftStart:'21:00:00',shiftHours:8,shiftName:'Shift C'}),{start:1260,hours:8,label:'21:00–05:00'});
  assert.equal(shiftWindowOf({shiftName:'Shift C'}).start,1260);
  assert.equal(shiftWindowOf({bookShiftCode:'S2'}).start,780);
  assert.equal(shiftWindowOf({masterShiftStart:'20:00',shiftName:'Shift C',shiftHours:8}).label,'20:00–04:00');
  assert.equal(shiftWindowOf({shiftName:'Day'}),null);
});

test('a card keeps the written time beside the time read', () => {
  const card={kind:'vehicle',timeMode:'with',shiftName:'Shift C',masterShiftStart:'21:00:00',shiftHours:8,trips:[{loadingTime:'12:50',unloadingTime:'1:37'},{loadingTime:'04:03',unloadingTime:'04:36'},{loadingTime:'7:30',unloadingTime:'7:50'}]};
  const out=cardOnShiftClock(card);
  assert.notEqual(out,card);
  assert.deepEqual(out.trips[0],{loadingTime:'00:50',unloadingTime:'01:37',writtenLoadingTime:'12:50'});
  assert.equal(out.trips[1],card.trips[1]);
  assert.equal(out.trips[2].outsideShift,true);
  assert.equal(card.trips[0].loadingTime,'12:50');
  assert.match(shiftClockNote(out.trips[0],'Shift C','21:00–05:00'),/Written 12:50 on the card, read as 00:50 on the Shift C clock/);
  assert.equal(cardOnShiftClock(out).trips[0],out.trips[0]);
  const plain={...card,trips:[card.trips[1]]};
  assert.equal(cardOnShiftClock(plain),plain);
  assert.equal(cardOnShiftClock({...card,timeMode:'without'}).trips[0].loadingTime,'12:50');
});

test('Trip Timing reads the Shift C card of 1 Nov on the night clock', () => {
  const [record]=normalise([{id:348,book_no:'VLB_S/1ST-NOV26/S3/348',book_type:'vehicle',data:{bookDate:'2026-11-01',location:'Dhoptala OB (2nd)',door:'V103',employeeName:'SAMPLE DRIVER',caliberId:'CMPL0001',
    shiftName:'Shift C',masterShiftStart:'21:00:00',shiftHours:8,timeMode:'with',trips:[{equipmentName:'Vpc 12',loadingTime:'12:50',unloadingTime:'13:37',tripCount:1},{equipmentName:'Vpc 12',loadingTime:'04:03',unloadingTime:'04:36',tripCount:1},{equipmentName:'Vpc 12',loadingTime:'07:30',unloadingTime:'07:50',tripCount:1}]}}]);
  const [first,second,third]=tripEntries([record]);
  assert.equal(first.loadingTime,'00:50');assert.equal(first.unloadingTime,'01:37');
  assert.equal(first['load-unload'].minutes,47);assert.equal(first['load-unload'].band,'b3');
  assert.match(entryRemark(first),/Written 12:50 on the card, read as 00:50/);
  assert.equal(second['unload-load'].minutes,146);
  assert.equal(third['load-unload'].band,null);assert.equal(third['load-unload'].outside,true);
  assert.match(entryRemark(third),/outside Shift C hours \(21:00–05:00\)/);
  assert.equal(third['unload-load'].band,null);
});

test('both save paths read trip times on the shift clock', () => {
  const route=fs.readFileSync(new URL('../server/routes/log-book.mjs',import.meta.url),'utf8');
  assert.match(route,/import \{cardOnShiftClock\} from '\.\.\/\.\.\/shared\/shift-clock\.mjs'/);
  assert.match(route,/kind==='vehicle'&&data\.timeMode==='with'\)\{\s*const read=cardOnShiftClock\(data\)/);
  assert.match(route,/writtenLoadingTime:text\(row\.writtenLoadingTime,8\)/);
  const machine=fs.readFileSync(new URL('../shared/loading-machine-report.mjs',import.meta.url),'utf8');
  assert.match(machine,/const rows=cardOnShiftClock\(r\)\.trips/);
});
