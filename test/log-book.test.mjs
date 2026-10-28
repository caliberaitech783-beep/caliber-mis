import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {normalizeLogBook,timeGapMinutes,registerLogBooks,assetBookKind} from '../log-book.mjs';

const input=()=>({bookDate:'2026-10-18',location:'Sasti OC',assetId:1,employeeId:2,shiftId:3,shiftHours:8,openingKmr:100,closingKmr:150,openingHmr:200,closingHmr:206.5,timeMode:'with',trips:[{equipmentName:'VPC-60',loadingTime:'08:20:00',unloadingTime:'08:40:00',tripCount:1}]});
test('template totals use the correct meter pairs, preserve zero and keep missing integration data unavailable',()=>{
 const row=normalizeLogBook('vehicle',{...input(),openingKmr:0,closingKmr:0,totalRunningKmr:999,breakdownHours:0});
 assert.equal(row.docType,'VLB');assert.equal(row.totalRunningKmr,0);assert.equal(row.totalWorkingHmr,6.5);assert.equal(row.trips[0].gapMinutes,null);assert.equal(row.trips[0].durationMinutes,20);assert.equal(row.totalTrips,1);
 for(const field of ['breakdownHours','workOrderContract'])assert.equal(row[field],null);
 assert.equal(row.availabilityHours,6.5);assert.equal(row.idleHours,1.5);
 const equipment=normalizeLogBook('equipment',{...input(),openingKmr:'',closingKmr:''});assert.equal(equipment.docType,'QLB');assert.equal(equipment.totalWorkingHmr,6.5);assert.equal(equipment.openingKmr,null);assert.deepEqual(equipment.trips,[]);
});
test('trip modes, overnight times and invalid meter/date inputs are validated',()=>{
 assert.equal(timeGapMinutes('23:50:00','00:10:00'),20);
 assert.equal(normalizeLogBook('vehicle',{...input(),timeMode:'without',trips:[{equipmentName:'L1',tripCount:3}]}).totalTrips,3);
 for(const patch of [{bookDate:'2026-02-31'},{closingHmr:199},{openingKmr:''},{shiftHours:9},{assetId:true},{trips:[null]},{trips:[{equipmentName:'L1',tripCount:0}]},{trips:[{equipmentName:'L1',tripCount:1,loadingTime:'29:00',unloadingTime:'30:00'}]}])assert.throws(()=>normalizeLogBook('vehicle',{...input(),...patch}));
 assert.equal(assetBookKind({category:'Equipment'}),'equipment');assert.equal(assetBookKind({category:'Vehicle'}),'vehicle');
});

test('database-backed log books enforce access, persist both forms, generate numbers, deduplicate retries and reject stale edits',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 const masters=[['Equipment master',{category:'Vehicle',door:'V-TEST',currentLocation:'Sasti OC',equipmentName:'Tipper'}],['Users & employees',{employee:'Local form test',employeeId:'CM-TEST',phone:'private-not-exposed',passwordHash:'private-not-exposed'}],['Shift Master',{site:'Sasti OC',shiftName:'Shift A',startTime:'05:00:00',endTime:'13:00:00'}],['Equipment master',{category:'Equipment',door:'EQ-TEST',currentLocation:'Sasti OC',equipmentName:'Excavator'}],['Shift Master',{site:'Jayant OC',shiftName:'Shift A'}],['Work Order master',{woNo:'WO-TEST',site:'Sasti OC'}],['C-Dir Employee master',{name:'Driver test',empId:'EMP-123',site:'Sasti OC'}]];
 for(const [name,data] of masters)await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2)',[name,JSON.stringify(data)]);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());
 const requireSession=(req,res,next)=>{if(!req.headers.authorization)return res.status(401).json({error:'Sign in'});req.session={login:'local-test',role:req.headers.authorization==='admin'?'super':'normal'};next()};
 const requireAdministrator=(req,res,next)=>req.session.role==='super'?next():res.status(403).json({error:'Admin only'});
 registerLogBooks(app,{pool,requireSession,requireAdministrator,pulseMasterSync:{status:()=>({connected:true}),readBreakdownRequests:async()=>[]}});app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,method='GET',body,auth='admin')=>{const r=await fetch(base+route,{method,headers:{...(auth?{Authorization:auth}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 assert.equal((await call('/api/log-books/vehicle','GET',undefined,'')).status,401);assert.equal((await call('/api/log-books/vehicle','GET',undefined,'normal')).status,403);
 for(const name of ['Dudhicua East OC','Dudhichua East OC','Dudhichua East OB'])await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2)',['Site master',JSON.stringify({name})]);
 const options=await call('/api/log-books/options');assert.deepEqual(options.data.sites.filter(site=>/east/i.test(site)),['Dudhichua East OC']);assert.equal(options.status,200);assert.equal(options.data.employees[0].caliberId,'EMP-123');assert.ok(!JSON.stringify(options.data).includes('private-not-exposed'));
 assert.equal(options.data.workOrders[0].number,'WO-TEST');const body={...input(),employeeId:7,workOrderId:6,requestKey:randomUUID()};const first=await call('/api/log-books/vehicle','POST',body);assert.equal(first.status,201);assert.match(first.data.book_no,/^CAL\/VLB\/181026\/S1\/0001$/);assert.equal(first.data.data.totalRunningKmr,50);assert.equal(first.data.data.caliberId,'EMP-123');assert.equal(first.data.data.workOrderContract,'WO-TEST');
 const repeat=await call('/api/log-books/vehicle','POST',body);assert.equal(repeat.status,200);assert.equal(repeat.data.book_no,first.data.book_no);
 assert.equal((await call('/api/log-books/vehicle')).data.records.length,1);
 const edited=await call(`/api/log-books/vehicle/${first.data.id}`,'PUT',{...body,closingKmr:170,revision:1});assert.equal(edited.status,200);assert.equal(edited.data.revision,2);assert.equal(edited.data.data.totalRunningKmr,70);
 assert.equal((await call(`/api/log-books/vehicle/${first.data.id}`,'PUT',{...body,revision:1})).status,409);
 assert.equal((await call('/api/log-books/vehicle','POST',{...body,requestKey:randomUUID(),shiftId:5})).status,400);
 assert.equal((await call('/api/log-books/equipment','POST',{...body,requestKey:randomUUID()})).status,400);
 const equipment=await call('/api/log-books/equipment','POST',{...body,assetId:4,requestKey:randomUUID()});assert.equal(equipment.status,201);assert.match(equipment.data.book_no,/^CAL\/ELB\/18-10-26\/001$/);assert.equal(equipment.data.data.breakdownHours,0);assert.equal(equipment.data.data.hoursSource.runningHours,6.5);assert.equal(equipment.data.data.idleHours,1.5);
 assert.equal((await call('/api/log-books/equipment')).data.records.length,1);const second=await call('/api/log-books/vehicle','POST',{...body,requestKey:randomUUID()});assert.equal(second.data.book_no,'CAL/VLB/181026/S1/0002');const nextDay=await call('/api/log-books/vehicle','POST',{...body,bookDate:'2026-10-19',requestKey:randomUUID()});assert.equal(nextDay.data.book_no,'CAL/VLB/191026/S1/0001');assert.equal((await call('/api/log-books/vehicle','POST',{...body,workOrderId:5,requestKey:randomUUID()})).status,400);
 assert.equal((await call('/api/log-books/vehicle?first=1')).data.records[0].id,first.data.id);const last=await call('/api/log-books/vehicle?last=1');assert.equal(last.data.records.length,1);assert.equal(last.data.records[0].id,nextDay.data.id);
 assert.equal((await call('/api/log-books/vehicle/'+first.data.id,'DELETE',{revision:1})).status,409);
 assert.equal((await call('/api/log-books/vehicle/'+first.data.id,'DELETE',{revision:2},'normal')).status,403);
 assert.equal((await call('/api/log-books/vehicle/'+first.data.id,'DELETE',{revision:2})).status,200);
 assert.ok(!(await call('/api/log-books/vehicle')).data.records.some(r=>r.id===first.data.id));
 assert.equal((await call('/api/log-books/vehicle/'+first.data.id,'PUT',{...body,revision:3})).status,409);
 // Complementary driver cards link even when they arrive in reverse order.
 const closingBody={...body,requestKey:randomUUID(),bookDate:'2026-10-21',trips:[{equipmentName:'L2',loadingTime:'',unloadingTime:'06:30',tripCount:1}]};
 const closing=await call('/api/log-books/vehicle','POST',closingBody);assert.equal(closing.status,201);assert.equal(closing.data.data.totalTrips,0);
 const openingBody={...body,requestKey:randomUUID(),bookDate:'2026-10-20',trips:[{equipmentName:'L1',loadingTime:'12:30',unloadingTime:'',tripCount:1}]};
 const opening=await call('/api/log-books/vehicle','POST',openingBody);assert.equal(opening.status,201);assert.equal(opening.data.data.openingTrips,1);
 const linked=(await call('/api/log-books/vehicle')).data.records;
 const end=linked.find(r=>r.id===closing.data.id),start=linked.find(r=>r.id===opening.data.id);
 assert.equal(end.data.totalTrips,1);assert.equal(start.data.totalTrips,0);assert.equal(end.data.endingTrips,1);
 assert.equal(end.data.trips[0].tripStatus,'closed');assert.equal(start.data.trips[0].tripStatus,'closed');
 assert.equal(end.data.trips[0].handoverLinks[0].counterpart.logBookId,String(opening.data.id));
 const olderPage=(await call('/api/log-books/vehicle?before='+opening.data.id)).data.records.find(r=>r.id===closing.data.id);assert.equal(olderPage.data.trips[0].tripStatus,'closed');

 assert.equal((await call('/api/log-books/vehicle/'+opening.data.id,'DELETE',{revision:1})).status,200);
 const reopened=(await call('/api/log-books/vehicle?last=1')).data.records[0];
 assert.equal(reopened.id,closing.data.id);assert.equal(reopened.data.trips[0].tripStatus,'awaiting-loading');assert.equal(reopened.data.totalTrips,0);

});
