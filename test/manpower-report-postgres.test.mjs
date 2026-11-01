import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {registerManpowerReports} from '../manpower-report-api.mjs';

const connectionString=process.env.DELETION_TEST_DATABASE_URL;
test('manpower HTTP report reads scoped saved books and batches from PostgreSQL',{skip:!connectionString},async t=>{
 const target=new URL(connectionString);assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.pathname==='/caliber_mis');
 const {default:pg}=await import('pg'),{default:express}=await import('express');
 const {withVlbTripHandovers}=await import('../vlb-trip-handover.mjs');
 const schema='manpower_'+randomUUID().replaceAll('-',''),bootstrap=new pg.Client({connectionString});await bootstrap.connect();await bootstrap.query('CREATE SCHEMA '+schema);
 const pool=new pg.Pool({connectionString,options:'-c search_path='+schema});
 t.after(async()=>{await pool.end();await bootstrap.query('DROP SCHEMA '+schema+' CASCADE');await bootstrap.end();});
 await pool.query(`CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);
  CREATE TABLE mis_log_books(id BIGINT PRIMARY KEY,book_no TEXT,book_type TEXT,book_date DATE,site TEXT,asset_id BIGINT,data JSONB,deleted_at TIMESTAMPTZ);
  CREATE TABLE mis_vlb_batches(id UUID PRIMARY KEY,name TEXT,site TEXT,book_date DATE,closed_at TIMESTAMPTZ,archived_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ);
  CREATE TABLE mis_vlb_batch_entries(batch_id UUID,logbook_id BIGINT);`);
 for(const [id,master_name,record_data] of [[1,'Equipment master',{door:'V1',site:'Sasti OC',category:'Vehicle',group:'Tipper',make:'Volvo',model:'FMX'}],[21,'Employee master',{caliberId:'101',caliberCode:'CMLL101',name:'Example Driver'}],[31,'Shift Master',{site:'Sasti OC',shiftCode:'A',startTime:'05:00',endTime:'13:00'}],[32,'Shift Master',{site:'Sasti OC',shiftCode:'B',startTime:'13:00',endTime:'21:00'}]])await pool.query('INSERT INTO master_records VALUES($1,$2,$3)',[id,master_name,record_data]);
 const batchId=randomUUID();await pool.query("INSERT INTO mis_vlb_batches VALUES($1,'TEST BATCH','Sasti OC','2026-11-10',NOW(),NULL,NULL)",[batchId]);
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
 const filtered=await (await fetch(url+'&batch='+batchId,{headers:{Authorization:'Bearer fixture'}})).json();assert.equal(filtered.details.length,1);assert.match(filtered.ot[0].shifts,/S1.*S2/);
});
