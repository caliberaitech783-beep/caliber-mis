// Owner, 28 Nov 2026: "i need the driver trainer and Lathe operator as other staff (not trip card) it should not show in
// trip card attendence...it should have the category of normal staff".
import test from 'node:test';
import assert from 'node:assert/strict';
import {drivesOrOperates,isOtherStaff,needsDriverConfirm,OTHER_STAFF_CATEGORY} from '../shared/caliber-id-check.mjs';
import {buildManpowerReport} from '../server/rules/manpower-report.mjs';

const site='Sasti OC',date='2026-11-10';
const shifts=[['A','05:00','13:00'],['B','13:00','21:00'],['C','21:00','05:00']].map(([shiftCode,startTime,endTime],i)=>({id:String(31+i),site,shiftCode,shiftName:'Shift '+shiftCode,startTime,endTime,status:'Active'}));
const employees=[
 {id:'21',caliberId:'CMPL101',caliberCode:'CMLL101',name:'Driver One',currentDesignationName:'VOLVO DRIVER'},
 {id:'22',caliberId:'CMPL102',caliberCode:'CMLL102',name:'Trainer Two',currentDesignationName:'Driver Trainer'},
 {id:'23',caliberId:'CMPL103',caliberCode:'CMLL103',name:'Lathe Three',currentDesignationName:'LATHE OPERATOR'},
];
const assets=[1,2,3].map(id=>({id:String(id),door:'V'+id,site,category:'Vehicle',group:'Tipper',make:'Volvo',model:'FMX'}));
const batches=[{id:'bS1',name:'BATCH-S1',site,report_date:date,shift:'S1',closed_at:'2026-11-11T00:00:00Z'}];
function card(id,employeeId,caliberId,employeeName){
 const data={bookDate:date,location:site,assetId:id,employeeId,caliberId,employeeName,shiftId:31,shiftName:'Shift A',bookShiftCode:'S1',masterShiftStart:'05:00',door:'V'+id,openingHmr:100,closingHmr:108,openingKmr:1000,closingKmr:1100,totalTrips:5,trips:[]};
 return {id,book_no:'CARD-'+id,book_type:'vehicle',book_date:date,site,asset_id:id,data,batches:[{id:'bS1',name:'BATCH-S1',closed_at:'2026-11-11'}]};
}
const records=[card(1,21,'CMPL101','Driver One'),card(2,22,'CMPL102','Trainer Two'),card(3,23,'CMPL103','Lathe Three')];
const build=extra=>buildManpowerReport({records,assets,employees,shifts,batches,filters:{from:date,to:date},...extra});

test('Driver Trainer and Lathe Operator are normal staff, never a driver or an operator',()=>{
 for(const designation of ['Driver Trainer','DRIVER TRAINER','VOLVO DRIVER TRAINER','VOLVO TRAINER','LATHE OPERATOR','Leath Operator','LETH OPRATOR']){
  assert.equal(isOtherStaff(designation),true,designation);
  assert.equal(drivesOrOperates({currentDesignationName:designation}),false,designation);
 }
 assert.equal(isOtherStaff({departmentName:'TRAINER'}),true,'no designation: the department decides');
 for(const designation of ['VOLVO DRIVER','PC OPERATOR','TRAINEE DRIVER','HELPER',''])assert.equal(isOtherStaff(designation),false,designation);
 assert.equal(drivesOrOperates({currentDesignationName:'TRAINEE DRIVER'}),true,'a trainee still drives');
 assert.equal(needsDriverConfirm({caliberId:'CMPL102',currentDesignationName:'Driver Trainer'}),true,'the scan does not put a trainer on a card by itself');
 assert.equal(OTHER_STAFF_CATEGORY,'Normal staff');
});

test('their cards stand, but trip card attendance and the HR feed leave them out',()=>{
 for(const parts of ['attendance','hr-attendance']){
  const r=build({parts});
  assert.deepEqual(r.otDuties.map(d=>d.employeeKey),['CMLL101'],parts);
  assert.deepEqual(r.attendanceEquipment.map(d=>d.employeeKey),['CMLL101'],parts);
 }
 const full=build({});
 assert.equal(full.totals.savedRecords,3,'every card stays in the totals');
 assert.deepEqual(full.shiftAttendance.map(r=>r.employeeName),['Driver One']);
 assert.equal(full.otDuties.length,3,'the OT view keeps the cards');
 assert.deepEqual(full.otDuties.filter(d=>d.employeeKey!=='CMLL101').map(d=>d.category).sort(),['Normal staff (Driver Trainer)','Normal staff (LATHE OPERATOR)']);
 const notes=full.exceptions.filter(e=>/Attendance not counted: .* is normal staff/.test(e.reason)).map(e=>e.book).sort();
 assert.deepEqual(notes,['CARD-2','CARD-3']);
});

test('a Present entry of a trainer or a lathe operator is not counted either',()=>{
 const attendance=[22,23,21].map((employee_id,i)=>({id:i+1,site,date,shift:'S2',employee_id,asset_id:i+1,reason:'No work',kind:'zero'}));
 const r=build({parts:'attendance',records:[],attendance});
 assert.deepEqual(r.attendanceEquipment.map(d=>d.employeeKey),['CMLL101']);
});
