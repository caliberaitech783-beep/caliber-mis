import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {registerManpowerReports} from '../server/routes/manpower-report-api.mjs';
import {SHIFT_ATTENDANCE_SCHEMA} from '../server/routes/shift-attendance.mjs';
import {VLB_TRIP_HANDOVER_SCHEMA} from '../server/rules/vlb-trip-handover-schema.mjs';

const connectionString=process.env.DELETION_TEST_DATABASE_URL;
test('manpower HTTP report reads scoped saved books and batches from PostgreSQL',{skip:!connectionString},async t=>{
 const target=new URL(connectionString);assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.pathname==='/caliber_mis');
 const {default:pg}=await import('pg'),{default:express}=await import('express');
 const {withVlbTripHandovers}=await import('../shared/vlb-trip-handover.mjs');
 const schema='manpower_'+randomUUID().replaceAll('-',''),bootstrap=new pg.Client({connectionString});await bootstrap.connect();await bootstrap.query('CREATE SCHEMA '+schema);
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema});
 t.after(async()=>{await pool.end();await bootstrap.query('DROP SCHEMA '+schema+' CASCADE');await bootstrap.end();});
 await pool.query(`CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);
  CREATE TABLE mis_log_books(id BIGINT PRIMARY KEY,book_no TEXT,book_type TEXT,book_date DATE,site TEXT,asset_id BIGINT,data JSONB,deleted_at TIMESTAMPTZ);
  CREATE TABLE mis_vlb_batches(id UUID PRIMARY KEY,name TEXT,site TEXT,book_date DATE,closed_at TIMESTAMPTZ,archived_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ,shift TEXT,stage TEXT);
  CREATE TABLE mis_vlb_batch_entries(batch_id UUID,logbook_id BIGINT);`+SHIFT_ATTENDANCE_SCHEMA+VLB_TRIP_HANDOVER_SCHEMA);
 for(const [id,master_name,record_data] of [[1,'Equipment master',{door:'V1',site:'Sasti OC',category:'Vehicle',group:'Tipper',make:'Volvo',model:'FMX'}],[21,'Employee master',{caliberId:'101',caliberCode:'CMLL101',name:'Example Driver'}],[31,'Shift Master',{site:'Sasti OC',shiftCode:'A',startTime:'05:00',endTime:'13:00'}],[32,'Shift Master',{site:'Sasti OC',shiftCode:'B',startTime:'13:00',endTime:'21:00'}]])await pool.query('INSERT INTO master_records VALUES($1,$2,$3)',[id,master_name,record_data]);
 const batchId=randomUUID();await pool.query("INSERT INTO mis_vlb_batches VALUES($1,'TEST BATCH','Sasti OC','2026-11-10',NOW(),NULL,NULL,'S1','closed')",[batchId]);
 for(const [id,shift,site,deleted] of [[1,1,'Sasti OC',null],[2,2,'Sasti OC',null],[3,1,'Jayant OC',null],[4,1,'Sasti OC','2026-11-11']]){
  const data={bookDate:'2026-11-10',location:site,door:'V1',assetId:1,employeeId:21,caliberId:'101',shiftId:30+shift,bookShiftCode:'S'+shift,shiftName:'Shift '+(shift===1?'A':'B'),masterShiftStart:shift===1?'05:00':'13:00',openingHmr:100,closingHmr:shift===1?108:107,openingKmr:100,closingKmr:140,trips:[{equipmentName:'E1',tripCount:5}],timeMode:'without'};
  await pool.query("INSERT INTO mis_log_books VALUES($1,$2,'vehicle','2026-11-10',$3,1,$4,$5)",[id,'CARD-'+id,site,data,deleted]);if(id===1)await pool.query('INSERT INTO mis_vlb_batch_entries VALUES($1,$2)',[batchId,id]);
 }
 const app=express();registerManpowerReports(app,{pool,ensureBooks:async()=>{},withHandovers:withVlbTripHandovers,protect:[(req,res,next)=>{if(req.headers.authorization!=='Bearer fixture')return res.status(401).json({error:'Sign in'});req.logBookScope={sites:['sasti ob']};next();}]});app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}/api/reports/manpower?from=2026-11-10&to=2026-11-10`;
 assert.equal((await fetch(url)).status,401);
 const response=await fetch(url,{headers:{Authorization:'Bearer fixture'}}),payload=await response.json();assert.equal(response.status,200,JSON.stringify(payload));assert.equal(payload.details.length,2);assert.equal(payload.performance.length,2);assert.equal(payload.ot[0].combinedHours,15);assert.equal(payload.ot[0].severity,'red');assert.equal(payload.performance[0].trips,5);assert.ok(payload.details.every(r=>r.site==='Sasti OC'));assert.equal(payload.options.batches[0].label,'TEST BATCH');
 assert.equal((await fetch(url+'&site=Jayant%20OC',{headers:{Authorization:'Bearer fixture'}})).status,403);
 // The batch's shift and stage are read from the batch table: Shift 1 has a closed batch, and only this login's site is listed.
 assert.deepEqual(payload.attendanceShifts.find(b=>b.shift==='S1'),{siteKey:'sasti ob',date:'2026-11-10',shift:'S1',state:'closed',batch:'TEST BATCH'});assert.deepEqual([...new Set(payload.attendanceShifts.map(b=>b.siteKey))],['sasti ob']);assert.deepEqual(payload.attendanceSites,[{siteKey:'sasti ob',site:'Sasti OC'}]);
 const filtered=await (await fetch(url+'&batch='+batchId,{headers:{Authorization:'Bearer fixture'}})).json();assert.equal(filtered.details.length,1);assert.match(filtered.ot[0].shifts,/S1.*S2/);
 // OT & Multiple Duties reads the same cases week by week, with only the duty fields and each card's batches.
 const ot=await (await fetch(url+'&view=ot',{headers:{Authorization:'Bearer fixture'}})).json();
 assert.deepEqual(ot.ot,payload.ot);assert.deepEqual(ot.otDuties,payload.otDuties);assert.deepEqual(ot.otSites,payload.otSites);assert.deepEqual(ot.options.batches,payload.options.batches);
 assert.match(ot.ot[0].batches,/TEST BATCH/);
 const otBatch=await (await fetch(url+'&view=ot&batch='+batchId,{headers:{Authorization:'Bearer fixture'}})).json();assert.deepEqual(otBatch.ot,filtered.ot);
 // The other four Manpower tabs read week by week as well and get only their own tables, the same as the full read.
 for(const [view,tables] of Object.entries({category:['details','summary'],reconciliation:['fleet','fleetWork'],performance:['performance'],equipment:['attendanceEquipment','attendanceShifts']})){
  const response=await fetch(url+'&view='+view,{headers:{Authorization:'Bearer fixture'}}),weekly=await response.json();assert.equal(response.status,200,view+' '+JSON.stringify(weekly));
  for(const table of tables)assert.deepEqual(weekly[table],payload[table],view+' '+table);
  assert.deepEqual(weekly.totals,payload.totals,view+' totals');assert.deepEqual(weekly.otSites,payload.otSites);assert.deepEqual(weekly.options.batches,payload.options.batches);assert.equal(weekly.otDuties,undefined);
 }
 const category=await (await fetch(url+'&view=category&batch='+batchId,{headers:{Authorization:'Bearer fixture'}})).json();assert.deepEqual(category.details,filtered.details);assert.match(category.details[0].batches,/TEST BATCH/);
 // Manpower by Category now gets the counts of every card (built on a worker thread) and one date's cards on their own.
 const {manpowerCategoryCells}=await import('../server/rules/manpower-report.mjs');
 const counts=await (await fetch(url+'&view=category-counts',{headers:{Authorization:'Bearer fixture'}})).json();
 assert.deepEqual(counts.cells,manpowerCategoryCells(payload.details));assert.deepEqual(counts.summary,payload.summary);assert.deepEqual(counts.totals,payload.totals);assert.equal(counts.details,undefined);
 const cards=await (await fetch(url+'&view=category-cards',{headers:{Authorization:'Bearer fixture'}})).json();assert.deepEqual(cards.details,payload.details);
});

// 28 Nov 2026 (owner: "plz make the MIS read faster also"): the master lists are read again only when their mark moves.
// The mark is made of every line's id and the number of the change that last wrote it (xmin); this is the real database
// saying that it moves with every insert, edit and delete, that nothing else moves it, and that it belongs to the read's
// own snapshot.
test('the mark of the master lists moves with every insert, edit and delete, and only then',{skip:!connectionString},async t=>{
 const target=new URL(connectionString);assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.pathname==='/caliber_mis');
 const {default:pg}=await import('pg');
 const {createKeptMasters,reportMastersText}=await import('../server/routes/manpower-report-api.mjs');
 const schema='masters_'+randomUUID().replaceAll('-',''),bootstrap=new pg.Client({connectionString});await bootstrap.connect();await bootstrap.query('CREATE SCHEMA '+schema);
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema});
 t.after(async()=>{await pool.end();await bootstrap.query('DROP SCHEMA '+schema+' CASCADE');await bootstrap.end();});
 await pool.query('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 const add=(name,data)=>pool.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2) RETURNING id',[name,data]).then(r=>r.rows[0].id);
 await add('Equipment master',{door:'V1',site:'Sasti OC'});
 const driver=await add('Employee master',{caliberId:'101',name:'Example Driver'});
 await add('Shift Master',{site:'Sasti OC',shiftCode:'A',startTime:'05:00',endTime:'13:00'});
 const keep=createKeptMasters(),names=text=>JSON.parse(text).employees.map(e=>e.name);
 const first=await keep(pool),again=await keep(pool);
 assert.deepEqual([first.kept,again.kept],[false,true]);
 assert.equal(first.mastersJson,(await reportMastersText(pool)).mastersJson,'the kept text is exactly what the database writes');
 assert.deepEqual(names(first.mastersJson),['Example Driver']);assert.equal(first.shifts.length,1);
 // An edit, an insert and a delete each give a new mark, and the text read then holds the change.
 await pool.query("UPDATE master_records SET record_data=record_data||'{\"name\":\"Renamed Driver\"}' WHERE id=$1",[driver]);
 const edited=await keep(pool);assert.equal(edited.kept,false);assert.deepEqual(names(edited.mastersJson),['Renamed Driver']);
 const second=await add('ERP Employee master',{caliberId:'102',name:'Second Driver'});
 const added=await keep(pool);assert.equal(added.kept,false);assert.deepEqual(names(added.mastersJson),['Renamed Driver','Second Driver']);
 await pool.query('DELETE FROM master_records WHERE id=$1',[second]);
 const removed=await keep(pool);assert.equal(removed.kept,false);assert.deepEqual(names(removed.mastersJson),['Renamed Driver']);
 assert.equal((await keep(pool)).kept,true);
 // A list the report does not read moves nothing.
 await add('Vehicle transfers',{door:'V1'});
 assert.equal((await keep(pool)).kept,true);
 // Inside a read's snapshot the mark is the snapshot's: a change made meanwhile is not seen, and neither is its text.
 const client=await pool.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal((await keep(client)).kept,true);
  await pool.query("UPDATE master_records SET record_data=record_data||'{\"name\":\"Changed Meanwhile\"}' WHERE id=$1",[driver]);
  const inside=await keep(client);
  assert.equal(inside.kept,true);assert.deepEqual(names(inside.mastersJson),['Renamed Driver']);
  await client.query('COMMIT');
 }finally{client.release();}
 const after=await keep(pool);assert.equal(after.kept,false);assert.deepEqual(names(after.mastersJson),['Changed Meanwhile']);
});
