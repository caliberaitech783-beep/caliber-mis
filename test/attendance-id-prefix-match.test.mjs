// CMPL9040 and CMLL9040 are one person (owner, 24 Nov 2026: at Majri OC every ELB card of CMPL9040 was left out of
// attendance as "Employee / Caliber ID mapping is ambiguous", "make it fix for all the sites"). The attendance build reads
// Employee master, ERP Employee master, C-Dir Employee master and Users & employees together; the same person written
// with the other prefix, or as the bare number, in a second list is not a second person. Two different numbers still
// are. Every ID and name is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildManpowerReport} from '../server/rules/manpower-report.mjs';
import {attendanceGap} from '../shared/caliber-recheck.mjs';
import {matchesSamePerson,personKey,samePersonVariants} from '../shared/employee-identity.mjs';

const site='Majri OC',date='2026-11-05';
const shifts=[['A','06:00','14:00'],['B','14:00','22:00'],['C','22:00','06:00']].map(([shiftCode,startTime,endTime],i)=>({id:String(31+i),site,shiftCode,shiftName:'Shift '+shiftCode,startTime,endTime,status:'Active'}));
const assets=[{id:'1',door:'D12',site,category:'Equipment',group:'Dozer',make:'BEML',model:'D155'}];
const batches=['S1','S2','S3'].map((shift,i)=>({id:'b'+i,name:'B'+i,site,report_date:date,shift,closed_at:'2026-11-06'}));
const card=(patch={})=>{
 const data={bookDate:date,location:site,assetId:1,employeeId:'21',caliberId:'CMPL907040',employeeName:'AABID',shiftId:32,shiftName:'Shift B',bookShiftCode:'S2',masterShiftStart:'14:00',door:'D12',openingHmr:100,closingHmr:106,trips:[],...patch};
 return {id:1,book_no:'CAL/ELB/1',book_type:'equipment',book_date:date,site,asset_id:1,data,batches:[{id:'b1',name:'B1',closed_at:'2026-11-06'}]};
};
const duties=(employees,patch)=>{
 const r=buildManpowerReport({records:[card(patch)],employees,assets,shifts,batches,filters:{from:date,to:date},parts:'attendance',lockedOnly:true});
 return {duties:r.otDuties.map(d=>d.employeeId),reasons:r.exceptions.map(e=>e.reason).filter(reason=>/Employee/.test(reason))};
};
const HR={id:'21',caliberId:'CMPL907040',caliberCode:'CMPL907040',name:'AABID'};

test('the other prefix and the bare number are the same person; another number is not',()=>{
 assert.deepEqual(samePersonVariants('CMPL907040').sort(),['CMLL907040','CMPL907040']);
 assert.deepEqual(samePersonVariants('907040'),['907040','CMPL907040','CMLL907040']);
 assert.deepEqual(samePersonVariants('EMP12'),['EMP12']);
 assert.equal(personKey('cmpl-907040'),'CMLL907040');
 assert.ok(matchesSamePerson({caliberId:'907040'},'CMPL907040'));
 assert.ok(!matchesSamePerson({caliberId:'907041'},'CMPL907040'));
});

test('a card counts when the same person is in a second list with the other prefix',()=>{
 assert.deepEqual(duties([HR]).duties,['CMPL907040'],'one line: counted, as before');
 // An ERP line of the same person: bare number, no Caliber ID (it becomes CMLL907040).
 assert.deepEqual(duties([HR,{id:'61',employeeId:'907040',name:'AABID'}]),{duties:['CMPL907040'],reasons:[]});
 // A login line with only the Caliber ID, written CMLL.
 assert.deepEqual(duties([HR,{id:'71',caliberCode:'CMLL907040',name:'AABID'}]),{duties:['CMPL907040'],reasons:[]});
 // The card linked to the ERP line while its Caliber ID is written CMPL.
 assert.deepEqual(duties([HR,{id:'61',employeeId:'907040',name:'AABID'}],{employeeId:'61'}).reasons,[]);
});

test('two different people are still kept apart',()=>{
 // One person's lines name two different Caliber IDs: which one worked is not known.
 const two=duties([HR,{id:'62',employeeId:'907040',caliberCode:'CMLL555',name:'AABID'}]);
 assert.deepEqual(two,{duties:[],reasons:['Employee / Caliber ID mapping is ambiguous.']});
 // The card's line is another number.
 assert.deepEqual(duties([HR,{id:'22',caliberId:'CMPL907041',name:'RAJU'}],{employeeId:'22'}).reasons,['Saved Employee ID conflicts with the linked employee master.']);
});

test('Caliber ID Re-check agrees: the other prefix is not an ID mismatch',()=>{
 const masters=[{id:'61',master_name:'ERP Employee master',record_data:{employeeId:'907040',name:'AABID'}},{id:'22',master_name:'Employee master',record_data:{caliberId:'CMPL907041',name:'RAJU'}}];
 const gap=(employeeId)=>attendanceGap(masters,{kind:'equipment',employeeId,caliberId:'CMPL907040',site,worked:true,shift:{bookShiftCode:'S2'}});
 assert.equal(gap('61'),null);
 assert.equal(gap('22')?.reason,'id-mismatch');
});
