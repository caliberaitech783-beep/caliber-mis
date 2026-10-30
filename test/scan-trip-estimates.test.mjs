import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateMissingTripTimes,previousScanShift,completePreviousShiftMachines,fillScanTripEstimates,tripEstimateNote} from '../scan-trip-estimates.mjs';
const draft={bookDate:'2026-10-29',cardShift:'II',assetId:'645',location:'Sasti OC',timeMode:'with',trips:[{equipmentName:'',loadingTime:'',unloadingTime:'08:22'}]};
const source=(name='VPC28',id=1)=>({id,book_no:'PREV/'+id,data:{bookDate:'2026-10-29',cardShift:'I',trips:[{equipmentName:name,loadingTime:'07:20',unloadingTime:'07:40'}]}});
test('08:22 unloading fills 08:00 loading and visibly identifies the estimate',()=>{
 const next=estimateMissingTripTimes(draft),row=next.trips[0];assert.equal(row.loadingTime,'08:00');assert.match(tripEstimateNote(row,'loadingTime'),/Estimated.*22 minutes/);assert.equal(draft.trips[0].loadingTime,'');
 assert.deepEqual(estimateMissingTripTimes(next),next);
 assert.equal(tripEstimateNote({...row,loadingTime:'08:02'},'loadingTime'),'');
});
test('missing unloading adds 22 minutes, including midnight; complete, empty and invalid times remain literal',()=>{
 const input={trips:[{loadingTime:'23:50',unloadingTime:''},{loadingTime:'',unloadingTime:'00:10'},{loadingTime:'08:10',unloadingTime:'08:25'},{loadingTime:'',unloadingTime:''},{loadingTime:'',unloadingTime:'25:70'}]};
 const rows=estimateMissingTripTimes(input).trips;assert.equal(rows[0].unloadingTime,'00:12');assert.equal(rows[0].timeEstimates.unloadingTime.dayOffset,1);assert.equal(rows[1].loadingTime,'23:48');assert.equal(rows[1].timeEstimates.loadingTime.dayOffset,-1);for(let i=2;i<5;i++)assert.deepEqual(rows[i],input.trips[i]);
 assert.deepEqual(estimateMissingTripTimes({...input,timeMode:'without'}),{...input,timeMode:'without'});
});
test('previous shift crosses dates, month and year boundaries correctly',()=>{
 assert.deepEqual(previousScanShift({bookDate:'2026-01-01',cardShift:'I'}),{bookDate:'2025-12-31',cardShift:'III'});
 assert.deepEqual(previousScanShift({bookDate:'2026-10-29',cardShift:'Day'}),{bookDate:'2026-10-28',cardShift:'Night'});
 assert.equal(previousScanShift({bookDate:'',cardShift:'I'}),null);
});
test('missing machine comes from previous shift terminal trip with provenance; printed machine is retained',()=>{
 const next=completePreviousShiftMachines({...draft,trips:[...draft.trips,{equipmentName:'VPC37',loadingTime:'09:40',unloadingTime:'10:00'}]},[source()]);
 assert.equal(next.trips[0].equipmentName,'VPC28');assert.match(tripEstimateNote(next.trips[0],'equipmentName'),/Taken from previous shift.*2026-10-29.*PREV\/1/);assert.equal(next.trips[1].equipmentName,'VPC37');
 assert.equal(tripEstimateNote({...next.trips[0],equipmentName:'VPC29'},'equipmentName'),'');
});
test('conflicting, wrong shift, chained and unmatched prefix sources never supply a guessed machine',()=>{
 for(const records of [[source(),source('VPC37',2)],[{...source(),data:{...source().data,cardShift:'III'}}],[{...source(),data:{...source().data,trips:[{...source().data.trips[0],equipmentSource:'previous-shift'}]}}]])assert.equal(completePreviousShiftMachines(draft,records).trips[0].equipmentName,'');
 const prefix={...draft,trips:[{equipmentName:'TPC',unloadingTime:'08:22'}]};assert.equal(completePreviousShiftMachines(prefix,[source()]).trips[0].equipmentName,'TPC');
 assert.equal(completePreviousShiftMachines({...prefix,trips:[{equipmentName:'VPC',unloadingTime:'08:22'}]},[source()]).trips[0].equipmentName,'VPC28');
});
test('lookup is scoped to vehicle, site, exact date/shift and excludes deleted log books',async()=>{
 const queries=[];const client={query:async(sql,args)=>{queries.push({sql,args});return {rows:[source()]}}};
 const next=await fillScanTripEstimates(client,draft);assert.equal(next.trips[0].loadingTime,'08:00');assert.equal(next.trips[0].equipmentName,'VPC28');assert.deepEqual(queries[0].args,['645','Sasti OC','2026-10-29','I']);assert.match(queries[0].sql,/deleted_at IS NULL/);assert.match(queries[0].sql,/asset_id=\$1 AND site=\$2/);
 queries.length=0;assert.deepEqual(await fillScanTripEstimates(client,draft,{responseRecoveryIssues:['review']}),draft);assert.equal(queries.length,0);
 await fillScanTripEstimates(client,{...draft,assetId:''});assert.equal(queries.length,0);
});
