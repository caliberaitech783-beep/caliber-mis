import test from 'node:test';
import assert from 'node:assert/strict';
import {DUMMY_EMPLOYEE_IDS,isDummyEmployeeId,cardHasDummyEmployee} from '../shared/dummy-employee-ids.mjs';
import {shareCardOperator} from '../shared/log-book-shared-shift.mjs';
import {assertCombinedShiftMeters} from '../server/rules/log-book-shift-hmr.mjs';
import {buildManpowerReport} from '../server/rules/manpower-report.mjs';

test('the seven dummy IDs of temporary drivers are recognised in every spelling',()=>{
 assert.deepEqual(DUMMY_EMPLOYEE_IDS.map(row=>row.id),['CMLL18152','CMLL12893','CMLL8856','CMLL12238','CMLL17805','CMLL15602','CMLL12227']);
 for(const value of ['CMLL18152','cmll 12238','CMPL8856',' CMLL-12227 '])assert.equal(isDummyEmployeeId(value),true,value);
 for(const value of ['CMLL3228','CMLL188152','12238','',null])assert.equal(isDummyEmployeeId(value),false,String(value));
 assert.equal(cardHasDummyEmployee({caliberId:'CMLL15602'}),true);
 assert.equal(cardHasDummyEmployee({caliberId:'CMPL3228'}),false);
});

test('two cards under one dummy ID are different drivers, except for the second sheet of one trip card',()=>{
 const dummy={employeeId:77,caliberId:'CMLL8856'},real={employeeId:21,caliberId:'CMPL3228'};
 assert.equal(shareCardOperator(dummy,{...dummy}),false);
 assert.equal(shareCardOperator(dummy,{...dummy},{sameDummy:true}),true);
 assert.equal(shareCardOperator(real,{...real}),true);
 assert.equal(shareCardOperator(dummy,real),false);
});

test('a dummy ID may drive several vehicles in one shift without the driver HMR limit; the vehicle limit stays',async()=>{
 const others=[{id:1,book_no:'VLB-1',site:'Jayant OC',asset_id:2,data:{bookShiftCode:'S1',openingHmr:0,closingHmr:8}},{id:2,book_no:'VLB-2',site:'Jayant OC',asset_id:3,data:{bookShiftCode:'S1',openingHmr:0,closingHmr:8}}];
 const client={query:async sql=>({rows:/asset_id,data FROM mis_log_books/.test(sql)?others:[]})};
 const data={assetId:1,location:'Jayant OC',bookDate:'2026-11-15',bookShiftCode:'S1',shiftHours:8,employeeId:77,openingHmr:0,closingHmr:8};
 await assert.rejects(()=>assertCombinedShiftMeters(client,'vehicle',{...data,caliberId:'CMPL3228'}),error=>error.details?.code==='driver_shift_hmr_limit');
 await assertCombinedShiftMeters(client,'vehicle',{...data,caliberId:'CMLL8856'});
 const sameVehicle={query:async sql=>({rows:/asset_id,data FROM mis_log_books/.test(sql)?[]:[{id:3,book_no:'VLB-3',site:'Jayant OC',data:{bookShiftCode:'S1',openingHmr:0,closingHmr:8}}]})};
 await assert.rejects(()=>assertCombinedShiftMeters(sameVehicle,'vehicle',{...data,caliberId:'CMLL8856'}),error=>error.details?.code==='shift_hmr_limit');
});

test('one dummy ID can save several cards on one tipper in the same shift; a real driver cannot',async()=>{
 const {assertSingleVlbCardPerShift}=await import('../server/rules/vlb-duplicate-card.mjs');
 const card=(id,caliberId)=>({id,book_no:'VLB-'+id,data:{location:'Jayant OC',bookShiftCode:'S1',employeeId:77,caliberId,scanCardNumber:'500'}});
 const data=caliberId=>({assetId:1,door:'V1',location:'Jayant OC',bookDate:'2026-11-15',bookShiftCode:'S1',employeeId:77,caliberId,scanCardId:'scan-9',scanCardNumber:'500'});
 const dummy={query:async()=>({rows:[card(1,'CMLL8856'),card(2,'CMLL8856'),card(3,'CMLL8856')]})};
 assert.deepEqual(await assertSingleVlbCardPerShift(dummy,data('CMLL8856')),[]);
 const real={query:async()=>({rows:[card(1,'CMPL3228')]})};
 await assert.rejects(()=>assertSingleVlbCardPerShift(real,data('CMPL3228')),error=>error.details?.code==='duplicate_card');
});

test('a dummy ID in all three shifts of one day raises no OT flag',()=>{
 const site='Jayant OC',date='2026-11-10';
 const shifts=[['A','05:00','13:00'],['B','13:00','21:00'],['C','21:00','05:00']].map(([shiftCode,startTime,endTime],i)=>({id:String(31+i),site,shiftCode,shiftName:'Shift '+shiftCode,startTime,endTime,status:'Active'}));
 const employees=[{id:'21',caliberId:'CMPL3228',caliberCode:'CMLL3228',name:'Driver One'},{id:'77',caliberId:'CMLL8856',caliberCode:'CMLL8856',name:'ABC'}];
 const assets=[1,2,3].map(id=>({id:String(id),door:'V'+id,site,category:'Vehicle',group:'Tipper',make:'Volvo',model:'FMX'}));
 const card=(id,shift,employeeId,caliberId)=>{const data={bookDate:date,location:site,assetId:shift,employeeId,caliberId,shiftId:30+shift,shiftName:'Shift '+['A','B','C'][shift-1],bookShiftCode:'S'+shift,masterShiftStart:shifts[shift-1].startTime,door:'V'+shift,openingHmr:100,closingHmr:108,openingKmr:1000,closingKmr:1100,totalTrips:5,trips:[]};
  return {id,book_no:'CARD-'+id,book_type:'vehicle',book_date:date,site,asset_id:shift,data,batches:[{id:'b'+shift,name:'BATCH-S'+shift,closed_at:'2026-11-11'}]};};
 const report=records=>buildManpowerReport({records,assets,employees,shifts,filters:{from:date,to:date}});
 assert.equal(report([1,2,3].map(s=>card(s,s,21,'CMPL3228'))).ot.length,1);
 const dummy=report([1,2,3].map(s=>card(s,s,77,'CMLL8856')));
 assert.equal(dummy.ot.length,0);
 assert.equal(dummy.performance.length,3);
});
