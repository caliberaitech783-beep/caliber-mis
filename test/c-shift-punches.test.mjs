import {compareAttendance} from '../shared/attendance-mismatch.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {cShiftDays} from '../shared/c-shift-punches.mjs';
import {machineDays} from '../shared/trip-biometric-check.mjs';
import {readBiometricDays} from '../server/routes/attendance-sheet-check.mjs';
const site='Majri OC',date='2026-11-27',next='2026-11-28';
const masters=[{site,shiftName:'Shift C',startTime:'20:00:00',endTime:'04:00:00'}];
const day=(date,inTime,outTime,extra={})=>({caliberCode:'9001',date,inTime,outTime,site,...extra});
const fix=days=>cShiftDays(days,{masters});
test('calendar-date OUT joins previous C shift, using site timings and leaving input intact',()=>{
 const input=[day(date,'19:55',''),day(next,'','04:10')];
 assert.deepEqual(fix(input),[day(date,'19:55','04:10')]);assert.equal(input[0].outTime,'');
 assert.deepEqual(fix([day(date,'19:55',''),day(next,'04:10','')]),[day(date,'19:55','04:10')]);
});
test('missing IN stays a miss punch on the previous C date; normalization is idempotent',()=>{
 const once=fix([day(next,'','04:10')]);assert.equal(once[0].date,date);assert.equal(once[0].inTime,'');assert.deepEqual(fix(once),once);
});
test('other sites, daytime duties and completed C followed by A IN stay separate',()=>{
 const input=[day(date,'19:55','04:00'),day(next,'04:10',''),day(next,'','05:00',{caliberCode:'9002',site:'Sasti OC'})];
 assert.deepEqual(fix(input),input);
 const a=[day(date,'19:55',''),day(next,'04:10','12:00')];assert.deepEqual(fix(a),a);
});
test('effective dates and site-specific end control the morning window',()=>{
 assert.equal(cShiftDays([day(next,'','08:00')],{masters})[0].date,next);
 const changed=[{...masters[0],endTime:'06:00',effectiveFrom:date,effectiveTo:date}];
 assert.equal(cShiftDays([day(next,'','08:00')],{masters:changed})[0].date,date);
 assert.equal(cShiftDays([day(next,'','04:00')],{masters:[{...masters[0],effectiveFrom:next}]})[0].date,next);
});
test('HR corrected rows are not changed',()=>{
 const corrected=day(date,'20:00','04:00',{corrected:{by:'HR'}});assert.deepEqual(fix([corrected,day(next,'','04:05')]),[corrected]);
});
test('machine labels do not split a C duty; next evening remains a new duty',()=>{
 const punches=[['9001','1',date+' 19:55',0,'1'],['9001','1',next+' 04:10',0,'0'],['9001','1',next+' 19:55',0,'0']];
 const days=machineDays({sites:[site],punches},{masters}).days;
 assert.deepEqual(days.map(d=>[d.date,d.inTime,d.outTime]),[[date,'19:55','04:10'],[next,'19:55','']]);
});
test('next-day A IN after C OUT starts its own machine duty',()=>{
 const punches=[['9001','1',date+' 20:00',0,'0'],['9001','1',next+' 04:00',0,'1'],['9001','1',next+' 04:10',0,'0'],['9001','1',next+' 12:00',0,'1']];
 assert.deepEqual(machineDays({sites:[site],punches},{masters}).days.map(d=>[d.date,d.inTime,d.outTime]),[[date,'20:00','04:00'],[next,'04:10','12:00']]);
});
test('a one-day report fetches the following morning and reconciles imported punches before filtering',async()=>{
 const reads=[],queries=[];
 const pool={query:async(sql,params)=>{queries.push([sql,params]);return {rows:sql.includes('master_records')?masters.map(record_data=>({record_data})):[{caliber_code:'9001',date,in_time:'20:00',out_time:'',site},{caliber_code:'9001',date:next,in_time:'',out_time:'04:00',site}]};}};
 const result=await readBiometricDays({pool,hrPunches:async range=>{reads.push(range);return {sites:[site],punches:[]};},site,from:date,to:date});
 assert.deepEqual(reads,[{from:'2026-11-26',to:next}]);assert.deepEqual(queries.find(([s])=>s.includes('mis_biometric_punches'))[1],['2026-11-26',next]);
 assert.deepEqual(result.days.map(d=>[d.date,d.inTime,d.outTime]),[[date,'20:00','04:00']]);
});

test('the next morning OUT produces no false mismatch or missing punch for previous C duty',()=>{
 const result=compareAttendance({punches:[day(date,'19:55',''),day(next,'','04:00')],duties:[{caliberCode:'9001',date,site,shift:'S3'}],masters,from:date,to:next,lockedDays:[]});
 assert.deepEqual(result.lines,[]);
});
