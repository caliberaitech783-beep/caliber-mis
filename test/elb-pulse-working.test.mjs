import test from 'node:test';
import assert from 'node:assert/strict';
import {saveFleetEntry,readFleetBreakdowns} from '../server/rules/vlb-batch-stages.mjs';
import {resolveLogBookData} from '../server/routes/log-book.mjs';

const batch={id:'batch',site:'Sasti OC',report_date:'2026-11-02',shift:'S1',stage:'elb_open'};
function fixture({bd=0,trips=0,unavailable=false,surfaceMiner=false,secondSite='Sasti OC',shiftHours=8}={}){
 const row={asset_id:'19',door:surfaceMiner?'SM1':'EX19',trips,logbook_id:null};
 const shift={site:'Sasti OC',shiftCode:'I',startTime:'06:00',endTime:'14:00'};
 const writes=[];
 const client={async query(sql,args){
  if(sql.includes('FROM mis_vlb_batches older'))return {rows:[]};
  if(sql.startsWith('SELECT * FROM mis_vlb_batch_fleet'))return {rows:[row]};
  if(sql.startsWith('SELECT asset_id FROM mis_vlb_batch_fleet'))return {rows:[{asset_id:'19'}]};
  if(sql.includes("master_name='Vehicle transfers'"))return {rows:[]};
  if(sql.includes("master_name='Equipment master'"))return {rows:[{id:'19',record_data:{door:row.door,site:'Sasti OC',group:surfaceMiner?'Surface Miner':'Excavator'}}]};
  if(sql.includes("master_name='Shift Master'"))return {rows:[{id:'4',record_data:shift}]};
  if(sql.includes('WHERE master_name=ANY'))return {rows:[]};
  if(sql.includes('FROM master_records WHERE id=ANY'))return {rows:[
   {id:'19',master_name:'Equipment master',record_data:{door:row.door,site:'Sasti OC',group:surfaceMiner?'Surface Miner':'Excavator'}},
   {id:'4',master_name:'Shift Master',record_data:shift},
   {id:'7',master_name:'Employee master',record_data:{name:'Operator A',site:'Sasti OC'}},
   {id:'8',master_name:'Employee master',record_data:{name:'Operator B',site:secondSite,caliberId:'CB'}},
  ].filter(master=>args[0].map(String).includes(master.id))};
  writes.push({sql,args});return {rows:[]};
 }};
 const pulse={breakdownHours:bd,breakdowns:bd?[{reference:'BD-1',description:'Engine fault',hours:bd}]:[],source:'https://pulse.cmll.in'};
 const ops={async readHours(input){assert.equal(input.assetId,'19');assert.equal(input.bookDate,'2026-11-02');assert.equal(input.location,'Sasti OC');assert.equal(input.shiftHours,shiftHours);if(unavailable)throw Error('Pulse disconnected');return pulse;},resolve:async(c,k,input)=>({...input}),insert:async(c,k,data)=>({id:1,book_no:'ELB1',data})};
 return {client,ops,writes,pulse};
}
test('Working-only saves use authoritative Pulse hours and preserve event details without trusting manual BD totals',async()=>{
 const f=fixture({bd:2,trips:5,shiftHours:12});
 const record=await saveFleetEntry(f.client,batch,'19',{entryMode:'working-only',shiftStatus:'working',employeeId:'7',openingHmr:100,closingHmr:105,manualBreakdownHours:99,shiftHours:12,requestKey:'test'},'mis',f.ops);
 assert.equal(record.data.shiftStatus,'working_partial_breakdown');assert.equal(record.data.breakdownHours,2);assert.equal(record.data.shiftHours,12);assert.equal(record.data.manualBreakdownHours,null);assert.equal(record.data.statusReason,'Engine fault');assert.equal(record.data.hoursSource.breakdownHours,2);assert.equal(record.data.pulseBreakdowns[0].reference,'BD-1');assert.equal(record.data.breakdownHoursSource,'pulse');
});

test('Excavator operator handover saves two portions on one ELB with one equipment HMR total',async()=>{
 const f=fixture();
 const input={entryMode:'working-only',employeeId:'7',secondOperatorId:'8',openingHmr:100,handoverHmr:104,closingHmr:108,requestKey:'test'};
 const record=await saveFleetEntry(f.client,batch,'19',input,'mis',{...f.ops,resolve:resolveLogBookData});
 assert.equal(record.data.totalWorkingHmr,8);
 assert.equal(record.data.employeeName,'Operator A');
 assert.deepEqual(record.data.operatorSplit,{secondOperatorId:8,secondOperatorName:'Operator B',secondOperatorCaliberId:'CB',handoverHmr:104,firstHours:4,secondHours:4,totalHours:8});
 assert.equal(f.writes.filter(({sql})=>sql.startsWith('INSERT INTO mis_elb_batch_entries')).length,1);
});

test('operator handover rejects excess HMR, an invalid reading, duplicate operators and ineligible operators or entry modes',async()=>{
 const input={entryMode:'working-only',employeeId:'7',secondOperatorId:'8',openingHmr:100,handoverHmr:104,closingHmr:108,requestKey:'test'};
 for(const [fixtureOptions,patch,error] of [
  [{surfaceMiner:true},{closingHmr:108.01},/cannot exceed 8 hours/],
  [{surfaceMiner:true},{handoverHmr:109},/below closing HMR/],
  [{surfaceMiner:true},{secondOperatorId:'7'},/two different operators/],
  [{surfaceMiner:true,secondSite:'Jayant OC'},{},/second operator assigned to this location/],
  [{},{entryMode:'breakdown'},/only in ELB Manual working entry/],
 ]){
  const f=fixture(fixtureOptions);
  await assert.rejects(()=>saveFleetEntry(f.client,batch,'19',{...input,...patch},'mis',{...f.ops,resolve:resolveLogBookData}),error);
  assert.equal(f.writes.length,0);
 }
});
test('full-shift breakdown and zero-work machines save through Working without requiring an operator',async()=>{
 for(const [bd,status,idle] of [[8,'breakdown',0],[0,'not_in_use',8],[2,'not_in_use',6]]){
  const f=fixture({bd});const record=await saveFleetEntry(f.client,batch,'19',{entryMode:'working-only',openingHmr:100,closingHmr:100,requestKey:'test'},'mis',f.ops);
  assert.equal(record.data.shiftStatus,status);assert.equal(record.data.employeeId,null);assert.equal(record.data.breakdownHours,bd);assert.equal(record.data.idleHours,idle);assert.equal(record.data.totalWorkingHmr,0);
 }
});
test('Pulse failure and invalid Pulse totals never save an invented zero; loaded trips still require positive working hours',async()=>{
 const f=fixture({unavailable:true});await assert.rejects(()=>saveFleetEntry(f.client,batch,'19',{entryMode:'working-only',openingHmr:100,closingHmr:100},'mis',f.ops),/Pulse disconnected/);assert.equal(f.writes.length,0);
 const bad=fixture({bd:9});await assert.rejects(()=>readFleetBreakdowns(bad.client,batch,'19',bad.ops.readHours,'mis'),/invalid breakdown/);
 const loaded=fixture({trips:2});await assert.rejects(()=>saveFleetEntry(loaded.client,batch,'19',{entryMode:'working-only',employeeId:'7',openingHmr:100,closingHmr:100},'mis',loaded.ops),/greater than zero/);
});
