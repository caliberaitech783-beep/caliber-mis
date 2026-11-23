import test from 'node:test';
import assert from 'node:assert/strict';
import {zeroTripAttendance,attendanceRange} from '../shared/zero-trip-attendance.mjs';

test('a 0-trip card finds the driver punch of its date',()=>{
 const days=[{caliberCode:'1234',date:'2026-11-24',inTime:'05:02',outTime:'13:10',site:'Sasti OC',source:'machine'},{caliberCode:'999',date:'2026-11-24',inTime:'05:00',outTime:'',site:'Sasti OC'}];
 const r=zeroTripAttendance({days,code:'CMLL1234',bookDate:'2026-11-24',cardShift:'I'});
 assert.equal(r.status,'present');assert.equal(r.code,'1234');assert.deepEqual(r.punches.map(p=>p.inTime),['05:02']);
});

test('no punch is absent; no CMLL number is said',()=>{
 const r=zeroTripAttendance({days:[{caliberCode:'1234',date:'2026-11-23',inTime:'05:00'}],code:'1234',bookDate:'2026-11-24',cardShift:'I'});
 assert.equal(r.status,'absent');assert.match(r.message,/No biometric punch for CMLL 1234 on 2026-11-24/);
 assert.equal(zeroTripAttendance({days:[],code:'',bookDate:'2026-11-24'}).status,'no-code');
});

test('an overnight card reads the next date and counts only a lone morning Out from it',()=>{
 assert.deepEqual(attendanceRange('2026-11-30','III'),{from:'2026-11-30',to:'2026-12-01'});
 assert.deepEqual(attendanceRange('2026-11-30','I'),{from:'2026-11-30',to:'2026-11-30'});
 const lone=[{caliberCode:'1234',date:'2026-12-01',inTime:'',outTime:'05:20'}],nextDuty=[{caliberCode:'1234',date:'2026-12-01',inTime:'05:00',outTime:'13:00'}];
 assert.equal(zeroTripAttendance({days:lone,code:'1234',bookDate:'2026-11-30',cardShift:'Night'}).status,'present');
 assert.equal(zeroTripAttendance({days:nextDuty,code:'1234',bookDate:'2026-11-30',cardShift:'Night'}).status,'absent');
 assert.equal(zeroTripAttendance({days:lone,code:'1234',bookDate:'2026-11-30',cardShift:'I'}).status,'absent');
});

test('a machine read that failed is passed on beside the imported punches',()=>{
 const r=zeroTripAttendance({days:[],code:'1234',bookDate:'2026-11-24',machine:{asked:true,connected:false,error:'HR Pulse did not give the machine punches.'}});
 assert.equal(r.machineNote,'HR Pulse did not give the machine punches.');
});
