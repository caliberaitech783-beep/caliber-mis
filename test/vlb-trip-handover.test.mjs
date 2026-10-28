import test from 'node:test';
import assert from 'node:assert/strict';
import {linkVlbTripHandovers,validTripTimes} from '../vlb-trip-handover.mjs';
const card=(id,date,driver,trips,patch={})=>({id,book_no:'VLB/'+id,data:{location:'Sasti OC',door:'V189',bookDate:date,employeeId:id,employeeName:driver,shiftId:id,masterShiftStart:'21:00:00',timeMode:'with',trips,...patch}});
const loading=(time='23:50')=>({equipmentName:'V25',loadingTime:time,unloadingTime:'',tripCount:1});
const unloading=(time='00:10')=>({equipmentName:'V99',loadingTime:'',unloadingTime:time,tripCount:1});
test('cross-shift cards close once, preserve driver credits and literal missing times',()=>{
 const a=card(1,'2026-10-28','First', [loading()]);
 const b=card(2,'2026-10-29','Next',[unloading()],{masterShiftStart:'00:00:00'});
 const [end,start]=linkVlbTripHandovers([b,a]);
 assert.equal(start.data.trips[0].tripStatus,'closed');assert.equal(end.data.trips[0].tripStatus,'closed');
 assert.equal(start.data.openingTrips,1);assert.equal(start.data.endingTrips,0);
 assert.equal(end.data.openingTrips,0);assert.equal(end.data.endingTrips,1);
 assert.equal(start.data.totalTrips+end.data.totalTrips,1);
 assert.equal(end.data.trips[0].handoverLinks[0].durationMinutes,20);
 assert.equal(start.data.trips[0].unloadingTime,'');assert.equal(end.data.trips[0].loadingTime,'');
 assert.equal(start.data.trips[0].handoverLinks[0].counterpart.driverName,'Next');
 assert.equal(end.data.trips[0].handoverLinks[0].counterpart.driverName,'First');
 assert.equal(a.data.trips[0].tripStatus,undefined);
});
test('site and door isolate handovers; driver, shift, equipment and date do not',()=>{
 const start=card(1,'2026-10-25','First',[loading()]);
 for(const patch of [{location:'Jayant OC'},{door:'V190'}]){
  const result=linkVlbTripHandovers([start,card(2,'2026-10-29','Next',[unloading()],patch)]);
  assert.equal(result[0].data.trips[0].tripStatus,'open');assert.equal(result[1].data.totalTrips,0);
 }
 assert.equal(linkVlbTripHandovers([start,card(2,'2026-10-29','Next',[unloading()])])[1].data.totalTrips,1);
});
test('one-to-one chronological matching, leftovers, corrections and removed cards',()=>{
 const a=card(1,'2026-10-28','First',[loading('21:10'),loading('22:10')]);
 const b=card(2,'2026-10-28','Next',[unloading('23:00')]);
 const [start,end]=linkVlbTripHandovers([a,b]);
 assert.equal(start.data.trips[0].tripStatus,'closed');assert.equal(start.data.trips[1].tripStatus,'open');assert.equal(end.data.totalTrips,1);
 assert.equal(linkVlbTripHandovers([a])[0].data.trips[0].tripStatus,'open');
 assert.equal(linkVlbTripHandovers([b])[0].data.trips[0].tripStatus,'awaiting-loading');
 assert.equal(linkVlbTripHandovers([card(1,'2026-10-30','First',[loading()]),b])[1].data.totalTrips,0);
});
test('full trips and without-time rows remain closed; blank or invalid timed rows are rejected',()=>{
 assert.ok(validTripTimes(loading()));assert.ok(validTripTimes(unloading()));
 assert.equal(validTripTimes({loadingTime:'',unloadingTime:''}),false);
 assert.equal(validTripTimes({loadingTime:'25:00',unloadingTime:'10:00'}),false);
 const result=linkVlbTripHandovers([card(1,'2026-10-28','First',[{...loading(),unloadingTime:'23:59'}]),card(2,'2026-10-28','Next',[{equipmentName:'L1',tripCount:3}],{timeMode:'without'})]);
 assert.equal(result[0].data.totalTrips,1);assert.equal(result[1].data.totalTrips,3);
});
