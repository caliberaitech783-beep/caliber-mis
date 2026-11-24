import test from 'node:test';
import assert from 'node:assert/strict';
import {linkVlbTripHandovers,validTripTimes,withVlbTripHandovers} from '../shared/vlb-trip-handover.mjs';
const card=(id,date,driver,trips,patch={})=>({id,book_no:'VLB/'+id,data:{location:'Sasti OC',door:'V189',bookDate:date,employeeId:id,employeeName:driver,shiftId:id,masterShiftStart:'21:00:00',timeMode:'with',trips,...patch}});
const loading=(time='23:50')=>({equipmentName:'V25',loadingTime:time,unloadingTime:'',tripCount:1});
const unloading=(time='00:10')=>({equipmentName:'V99',loadingTime:'',unloadingTime:time,tripCount:1});

test('complete manual cards avoid all historical reads and retain their exact linked result',async()=>{
 const records=[card(1,'2026-12-28','First',[{...loading(),unloadingTime:'23:59'}]),card(2,'2026-12-28','Second',[{tripCount:3}],{timeMode:'without'})];
 const client={query(){throw Error('a complete manual save must not read history')}};
 assert.deepEqual(await withVlbTripHandovers(client,records),linkVlbTripHandovers(records));
});

test('partial cards fetch full history only for matching canonical site/door, with no date cutoff',async()=>{
 const records=[card(1,'2026-11-02','First',[loading()],{door:'Volvo 00189',location:'Sasti II'}),card(2,'2026-12-28','Second',[unloading()],{door:'V-189',location:'Sasti OC'})];
 const unrelated=Array.from({length:1000},(_,i)=>card(10+i,'2026-12-28','Other',[loading()],{door:'V'+(1000+i)}));
 const calls=[],scope=['Sasti OC'];
 const client={async query(sql,args){calls.push({sql,args});if(calls.length===1)return {rows:[...records,...unrelated].map(r=>({ids:[r.id],location:r.data.location,door:r.data.door}))};return {rows:records.filter(r=>args[0].includes(r.id))};}};
 const result=await withVlbTripHandovers(client,[records[1]],scope);
 assert.deepEqual(result,linkVlbTripHandovers(records).filter(r=>r.id===2));
 assert.equal(calls.length,2);assert.deepEqual(calls[1].args,[[1,2],scope]);
 assert.equal(result[0].data.trips[0].handoverLinks[0].counterpart.logBookId,'1');
});
test('cross-shift cards close once, preserve driver credits and literal missing times',()=>{
 const a=card(1,'2026-12-28','First', [loading()]);
 const b=card(2,'2026-12-29','Next',[unloading()],{masterShiftStart:'00:00:00'});
 const [end,start]=linkVlbTripHandovers([b,a]);
 assert.equal(start.data.trips[0].tripStatus,'closed');assert.equal(end.data.trips[0].tripStatus,'closed');
 assert.equal(start.data.openingTrips,1);assert.equal(start.data.endingTrips,0);
 assert.equal(end.data.openingTrips,0);assert.equal(end.data.endingTrips,1);
 assert.equal(start.data.totalTrips,1);assert.equal(end.data.totalTrips,0);
 assert.equal(end.data.trips[0].handoverLinks[0].durationMinutes,20);
 assert.equal(start.data.trips[0].unloadingTime,'');assert.equal(end.data.trips[0].loadingTime,'');
 assert.equal(start.data.trips[0].handoverLinks[0].counterpart.driverName,'Next');
 assert.equal(end.data.trips[0].handoverLinks[0].counterpart.driverName,'First');
 assert.equal(a.data.trips[0].tripStatus,undefined);
});
test('site and door isolate handovers; driver, shift, equipment and date do not',()=>{
 const start=card(1,'2026-12-25','First',[loading()]);
 for(const patch of [{location:'Jayant OC'},{door:'V190'}]){
  const result=linkVlbTripHandovers([start,card(2,'2026-12-29','Next',[unloading()],patch)]);
  assert.equal(result[0].data.trips[0].tripStatus,'open');assert.equal(result[1].data.totalTrips,0);
 }
 assert.equal(linkVlbTripHandovers([start,card(2,'2026-12-29','Next',[unloading()])])[1].data.trips[0].tripStatus,'closed');
});
test('one-to-one chronological matching, leftovers, corrections and removed cards',()=>{
 const a=card(1,'2026-12-28','First',[loading('21:10'),loading('22:10')]);
 const b=card(2,'2026-12-28','Next',[unloading('23:00')]);
 const [start,end]=linkVlbTripHandovers([a,b]);
 assert.equal(start.data.trips[0].tripStatus,'closed');assert.equal(start.data.trips[1].tripStatus,'open');assert.equal(start.data.totalTrips,2);assert.equal(end.data.totalTrips,0);
 assert.equal(linkVlbTripHandovers([a])[0].data.totalTrips,2);
 assert.equal(linkVlbTripHandovers([b])[0].data.trips[0].tripStatus,'awaiting-loading');
 assert.equal(linkVlbTripHandovers([card(1,'2026-12-30','First',[loading()]),b])[1].data.totalTrips,0);
});
test('full trips and without-time rows remain closed; blank or invalid timed rows are rejected',()=>{
 assert.ok(validTripTimes(loading()));assert.ok(validTripTimes(unloading()));
 assert.equal(validTripTimes({loadingTime:'',unloadingTime:''}),false);
 assert.equal(validTripTimes({loadingTime:'25:00',unloadingTime:'10:00'}),false);
 const result=linkVlbTripHandovers([card(1,'2026-12-28','First',[{...loading(),unloadingTime:'23:59'}]),card(2,'2026-12-28','Next',[{equipmentName:'L1',tripCount:3}],{timeMode:'without'})]);
 assert.equal(result[0].data.totalTrips,1);assert.equal(result[1].data.totalTrips,3);
});

test('estimated loading time does not credit the unloading shift',()=>{
 const a=card(1,'2026-12-28','First',[loading()]);
 const row={...unloading(),loadingTime:'00:05',timeEstimates:{loadingTime:{value:'00:05',anchorField:'unloadingTime',anchorValue:'00:10'}}};
 const b=card(2,'2026-12-29','Next',[row],{masterShiftStart:'00:00:00'});
 const [start,end]=linkVlbTripHandovers([a,b]);
 assert.equal(start.data.totalTrips,1);
 assert.equal(end.data.totalTrips,0);
 assert.equal(end.data.trips[0].handoverLinks[0].role,'unloading');
});

// Compare actual SQL results against the full-history read, using current rules.
test('identity groups preserve full-history results, aliases, FIFO, scope and snapshots',async t=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const {VLB_TRIP_HANDOVER_SCHEMA}=await import('../server/rules/vlb-trip-handover-schema.mjs');
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE mis_log_books(id INT,book_no TEXT,book_type TEXT,site TEXT,book_date DATE,data JSONB,deleted_at TIMESTAMPTZ)');
 await db.exec(VLB_TRIP_HANDOVER_SCHEMA);
 const rows=[
  card(1,'2026-11-02','Old',[loading('21:10')],{location:'Sasti II',door:'VOLVO 0189'}),
  card(2,'2026-12-28','New',[loading('21:20')]),
  card(3,'2026-12-29','End',[unloading()],{location:'Sasti OB',door:'V-189'}),
  card(4,'2026-12-29','Other vehicle',[unloading()],{door:'V190'}),
  card(5,'2026-12-29','Other site',[unloading()],{location:'Jayant OC'}),
  card(6,'2026-11-01','Deleted',[loading()]),
  card(7,'2026-12-29','Complete',[{...loading(),unloadingTime:'23:59'}]),
  card(8,'2026-12-29','Estimated',[{...unloading(),loadingTime:'00:05',timeEstimates:{loadingTime:{value:'00:05'}}}]),
 ];
 for(let id=20;id<120;id++)rows.push(card(id,'2026-11-02','Repeated group',[loading()]));
 for(const row of rows)await db.query("INSERT INTO mis_log_books VALUES($1,$2,'vehicle',$3,$4,$5,$6)",[row.id,row.book_no,row.data.location,row.data.bookDate,JSON.stringify(row.data),row.id===6?'2026-11-02':null]);
 for(const scope of [null,['Sasti OB','Sasti OC','Sasti II'],['Sasti OB'],[]]){
  const inputs=[rows[2],{...rows[1],data:{...rows[1].data,trips:[loading('22:00')]}}];
  const old=(await db.query("SELECT id,book_no,book_type,data FROM mis_log_books WHERE book_type='vehicle' AND deleted_at IS NULL AND book_date>='2026-11-01' AND ($1::text[] IS NULL OR site=ANY($1::text[])) AND mis_vlb_has_handover_trip(data)",[scope])).rows;
  const all=new Map(old.map(r=>[String(r.id),r]));for(const r of inputs)all.set(String(r.id),r);
  const expected=new Map(linkVlbTripHandovers([...all.values()]).map(r=>[String(r.id),r]));
  const fetched=[];let identityCount=0;
  const client={query:async(sql,args)=>{const result=await db.query(sql,args);if(sql.startsWith('SELECT id,'))fetched.push(...result.rows);else identityCount=result.rows.length;return result;}};
  assert.deepEqual(await withVlbTripHandovers(client,inputs,scope),inputs.map(r=>expected.get(String(r.id))));
  assert.ok(fetched.every(r=>![4,5,6,7].includes(r.id)));
  if(scope===null)assert.ok(identityCount<10,'one identity per raw site/door, not per historical card');
 }
 assert.equal((await db.query('SELECT data FROM mis_log_books WHERE id=2')).rows[0].data.trips[0].loadingTime,'21:20');
});
