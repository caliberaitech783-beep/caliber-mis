import test from 'node:test';
import assert from 'node:assert/strict';
import {saveFleetEntry,readFleetBreakdowns} from '../vlb-batch-stages.mjs';

const batch={id:'batch',site:'Sasti OC',report_date:'2026-11-02',shift:'S1',stage:'elb_open'};
function fixture({bd=0,trips=0,unavailable=false}={}){
 const row={asset_id:'19',door:'EX19',trips,logbook_id:null};
 const writes=[];
 const client={async query(sql,args){
  if(sql.startsWith('SELECT * FROM mis_vlb_batch_fleet'))return {rows:[row]};
  if(sql.startsWith('SELECT asset_id FROM mis_vlb_batch_fleet'))return {rows:[{asset_id:'19'}]};
  if(sql.includes("master_name='Shift Master'"))return {rows:[{id:'4',record_data:{site:'Sasti OC',shiftCode:'I',startTime:'06:00',endTime:'14:00'}}]};
  writes.push({sql,args});return {rows:[]};
 }};
 const pulse={breakdownHours:bd,breakdowns:bd?[{reference:'BD-1',description:'Engine fault',hours:bd}]:[],source:'https://pulse.cmll.in'};
 const ops={async readHours(input){assert.equal(input.assetId,'19');assert.equal(input.bookDate,'2026-11-02');assert.equal(input.location,'Sasti OC');assert.equal(input.shiftHours,8);if(unavailable)throw Error('Pulse disconnected');return pulse;},resolve:async(c,k,input)=>({...input}),insert:async(c,k,data)=>({id:1,book_no:'ELB1',data})};
 return {client,ops,writes,pulse};
}
test('Working-only saves use authoritative Pulse hours and preserve event details without trusting manual BD totals',async()=>{
 const f=fixture({bd:2,trips:5});
 const record=await saveFleetEntry(f.client,batch,'19',{entryMode:'working-only',shiftStatus:'working',employeeId:'7',openingHmr:100,closingHmr:105,manualBreakdownHours:99,shiftHours:12,requestKey:'test'},'mis',f.ops);
 assert.equal(record.data.shiftStatus,'working_partial_breakdown');assert.equal(record.data.breakdownHours,2);assert.equal(record.data.shiftHours,8);assert.equal(record.data.manualBreakdownHours,null);assert.equal(record.data.statusReason,'Engine fault');assert.equal(record.data.hoursSource.breakdownHours,2);assert.equal(record.data.pulseBreakdowns[0].reference,'BD-1');assert.equal(record.data.breakdownHoursSource,'pulse');
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
