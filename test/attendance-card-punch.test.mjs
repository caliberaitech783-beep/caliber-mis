// Card + punch (owner, 24 Nov 2026: "attendance should be fetched if there is punch", "Card + punch" chosen): a trip card
// left out of attendance because its driver is not one Employee Master person counts for its Caliber ID when that ID
// punched the biometric machine that day at that site. Nobody is counted without a card. Every ID and name is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildManpowerReport} from '../server/rules/manpower-report.mjs';
import {buildAttendanceWeek} from '../server/rules/attendance-read.mjs';
import {createAttendancePunches,punchKeys,punchKeysBetween} from '../server/services/attendance-punches.mjs';
import {uncountedCards} from '../shared/attendance-sheet-check.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';

const site='Majri OC',date='2026-11-05',KEY=canonicalSiteName(site);
const shifts=[['A','06:00','14:00'],['B','14:00','22:00'],['C','22:00','06:00']].map(([shiftCode,startTime,endTime],i)=>({id:String(31+i),site,shiftCode,shiftName:'Shift '+shiftCode,startTime,endTime,status:'Active'}));
const assets=[{id:'1',door:'D12',site,category:'Equipment',group:'Dozer',make:'BEML',model:'D155'}];
const batches=['S1','S2','S3'].map((shift,i)=>({id:'b'+i,name:'B'+i,site,report_date:date,shift,closed_at:'2026-11-06'}));
const card=(patch={})=>{
 const data={bookDate:date,location:site,assetId:1,employeeId:'21',caliberId:'CMPL907040',employeeName:'AABID',shiftId:32,shiftName:'Shift B',bookShiftCode:'S2',masterShiftStart:'14:00',door:'D12',openingHmr:100,closingHmr:106,trips:[],...patch};
 return {id:1,book_no:'CAL/ELB/1',book_type:'equipment',book_date:date,site,asset_id:1,data,batches:[{id:'b1',name:'B1',closed_at:'2026-11-06'}]};
};
// Two different Caliber IDs on one person's lines: the match refuses the card ("ambiguous").
const AMBIGUOUS=[{id:'21',caliberId:'CMPL907040',caliberCode:'CMPL907040',name:'AABID'},{id:'62',employeeId:'907040',caliberCode:'CMLL555',name:'AABID'}];
const build=(punched,{employees=AMBIGUOUS,patch}={})=>buildManpowerReport({records:[card(patch)],employees,assets,shifts,batches,filters:{from:date,to:date},parts:'attendance',lockedOnly:true,punched});

test('a refused card counts for its Caliber ID when that ID punched that day at that site',()=>{
 assert.equal(build([]).otDuties.length,0,'no punch: left out, as before');
 const r=build(['907040|'+KEY+'|'+date]);
 assert.deepEqual(r.otDuties.map(d=>[d.employeeId,d.date,d.shift]),[['CMPL907040',date,'S2']]);
 const note=r.exceptions.find(e=>/bio-punch/.test(e.reason));
 assert.match(note.reason,/two lines hold this ID/);
 assert.equal(uncountedCards(r.exceptions).length,0,'the sheet check does not call it "not counted"');
 // A punch with no site (an imported line) counts too; a punch on another date or at another site does not.
 assert.equal(build(['907040||'+date]).otDuties.length,1);
 assert.equal(build(['907040|'+KEY+'|2026-11-06']).otDuties.length,0);
 assert.equal(build(['907040|'+canonicalSiteName('Sasti OC')+'|'+date]).otDuties.length,0);
 assert.equal(build(['907041|'+KEY+'|'+date]).otDuties.length,0,'another number punched');
});

test('a card not in Employee Master, or naming another line, also counts by its punch; a matched card is unchanged',()=>{
 assert.equal(build(['907040|'+KEY+'|'+date],{employees:[]}).otDuties[0].employeeId,'CMPL907040');
 const conflict=build(['907040|'+KEY+'|'+date],{employees:[{id:'22',caliberId:'CMPL907041',name:'RAJU'}],patch:{employeeId:'22'}});
 assert.deepEqual(conflict.otDuties.map(d=>d.employeeId),['CMPL907040'],'the punched Caliber ID, not the other line');
 const matched=build(['907040|'+KEY+'|'+date],{employees:[AMBIGUOUS[0]]});
 assert.equal(matched.otDuties[0].employeeName,'AABID');
 assert.ok(!matched.exceptions.some(e=>/bio-punch/.test(e.reason)));
 assert.equal(build(['907040|'+KEY+'|'+date],{patch:{caliberId:''}}).otDuties.length,0,'no Caliber ID on the card: nobody to count');
});

test('the week build passes the punches through',()=>{
 const week=punched=>buildAttendanceWeek({cards:[card()],links:{},masters:{employees:AMBIGUOUS,assets,shifts},batches,filters:{from:date,to:date},scope:{sites:null},punched});
 assert.equal(week([]).otDuties.length,0);
 assert.equal(week(['907040|'+KEY+'|'+date]).otDuties.length,1);
});

test('punch keys come from the machine and the imported punches; HR Pulse not answering counts no machine punch',async()=>{
 assert.deepEqual(punchKeys([{caliberCode:'CMLL907040',date,site:'Majri OC'},{caliberCode:'907041',date,site:''},{caliberCode:'',date}]),
  ['907040|'+KEY+'|'+date,'907041||'+date]);
 assert.deepEqual(punchKeysBetween(['1||2026-11-04','1||2026-11-05','1||2026-11-07'],'2026-11-05','2026-11-06'),['1||2026-11-05']);
 const pool={query:async()=>({rows:[{caliber_code:'CMPL907041',date,in_time:'06:00',out_time:'14:00',site:''}]})};
 let asked=0;
 const answer={punches:[['CMPL907040','17',date+' 13:55:00',0,'0']],sites:['Majri OC']};
 const read=createAttendancePunches({pool,hrPunches:async()=>{asked++;return answer;}});
 assert.deepEqual(await read({from:date,to:date}),['907040|'+KEY+'|'+date,'907041||'+date]);
 await read({from:date,to:date});
 assert.equal(asked,1,'HR Pulse is asked once for the same dates within a few minutes');
 const silent=createAttendancePunches({pool,hrPunches:()=>new Promise(()=>{}),waitMs:20});
 assert.deepEqual(await silent({from:date,to:date}),['907041||'+date],'only the imported punches');
 const noTable=createAttendancePunches({pool:{query:async()=>{throw Object.assign(Error('relation "mis_biometric_punches" does not exist'),{code:'42P01'});}}});
 assert.deepEqual(await noTable({from:date,to:date}),[]);
});
