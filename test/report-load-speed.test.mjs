import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {linkVlbTripHandovers,withVlbTripCounts} from '../shared/vlb-trip-handover.mjs';
import {logBooksForOperations} from '../server/routes/log-book.mjs';
import {registerFleetReconciliation,FLEET_BREAKDOWN_COPY_MS} from '../server/routes/fleet-reconciliation-api.mjs';
import {createPulseBreakdownMirror} from '../server/services/pulse-breakdown-mirror.mjs';

// 18 Nov 2026: the 18-day Operations reading took up to 4 min 45 s on live, while 18 Fleet Reconciliation
// readings (each a live read of Pulse's whole breakdown list) ran 170 s each and kept the server busy.

const card=(id,door,trips,extra={})=>({id,book_no:'B'+id,book_type:'vehicle',data:{bookDate:'2026-11-16',location:'Sasti OB',door,shiftId:'1',employeeId:'E'+id,trips,hoursSource:{big:'x'.repeat(50)},...extra}});

test('the full Operations reading counts trips exactly as before, without linking handovers across cards',()=>{
 const records=[
  card(1,'V103',[{loadingTime:'06:00',tripCount:2,loadingEquipment:'EX7'},{loadingTime:'07:00',unloadingTime:'07:40',tripCount:1}]),
  card(2,'V103',[{unloadingTime:'06:30',tripCount:2},{unloadingTime:'08:10',tripCount:1}]),
  card(3,'V104',[{loadingTime:'25:99',tripCount:3},{tripCount:4}],{timeMode:'with'}),
  card(4,'V105',[{tripCount:5},{loadingTime:'09:00',tripCount:'2'}],{timeMode:'without'}),
  card(5,'V106',[]),
  card(6,'V107',undefined),
 ];
 const before=logBooksForOperations(linkVlbTripHandovers(records));
 const after=logBooksForOperations(withVlbTripCounts(records));
 assert.deepEqual(after,before);
 assert.equal(after[0].data.completedTrips,3);
 assert.equal(after[3].data.totalTrips,7);
 assert.equal(records[0].data.trips[0].completedTrips,undefined,'the saved cards are not changed');
});

test('the Operations reading lets the database leave out unread card fields, and links handovers only for Trip Timing',()=>{
 const route=readFileSync(new URL('../server/routes/log-book.mjs',import.meta.url),'utf8');
 assert.match(route,/SELECT id,book_no,book_type,data - \$3::text\[\] AS data FROM mis_log_books/);
 assert.match(route,/\[from,to,withScans\?OPERATIONS_UNUSED_CARD_FIELDS:TIMING_UNUSED_CARD_FIELDS\]/);
 assert.match(route,/const linked=withScans\?withVlbTripCounts\(vehicleRecords\):await withVlbTripHandovers\(/);
 assert.match(route,/registerFleetReconciliation\(app,\{[^}]*breakdownMirror\}\)/);
});

test('Fleet Reconciliation reads Pulse-II\'s copy of the breakdown list while it is fresh, and Pulse live only when it is not',async t=>{
 const pool=new PGlite();t.after(()=>pool.close());
 await pool.exec(`CREATE TABLE master_records(id BIGINT,master_name TEXT,record_data JSONB);CREATE TABLE mis_log_books(id BIGINT,book_no TEXT,book_type TEXT,asset_id BIGINT,site TEXT,data JSONB,book_date DATE,deleted_at TIMESTAMPTZ);`);
 const site='Sasti OC',date='2026-11-02';
 await pool.query("INSERT INTO master_records VALUES(1,'Equipment master',$1),(2,'Shift Master',$2)",[{category:'vehicle',door:'V1',currentLocation:site},{site,shiftName:'Shift A',startTime:'05:00:00',endTime:'13:00:00'}]);
 const query=(sql,args)=>!args&&sql.includes(';')?pool.exec(sql):pool.query(sql,args);
 let clock=Date.parse('2026-11-18T12:00:00Z'),liveReads=0;
 const pulseRows=[{ref:'BD-1',site,door:'V1',start:'2026-11-02T01:00:00Z',closedAt:'2026-11-02T03:00:00Z'}];
 const mirror=createPulseBreakdownMirror({pool:{query},readFeed:async()=>pulseRows,now:()=>clock,log:{error(){}}});
 await mirror.refresh();
 const app=express();app.use(express.json());
 registerFleetReconciliation(app,{pool:{query},protect:[(req,res,next)=>{req.session={login:'test',role:'super'};req.logBookScope={sites:null};next()}],ensureBooks:async()=>{},breakdownMirror:mirror,
  pulseMasterSync:{readBreakdownRequests:async({fresh})=>{assert.equal(fresh,true);liveReads++;return pulseRows;},status:()=>({connected:true})}});
 app.use((err,req,res,next)=>res.status(500).json({error:err.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const url=`http://127.0.0.1:${server.address().port}/api/reports/fleet-reconciliation?`+new URLSearchParams({site,date,shift:'S1'});
 let body=await(await fetch(url)).json();
 assert.equal(liveReads,0,'a fresh copy answers without asking Pulse');
 assert.equal(body.breakdownsReadAt,new Date(clock).toISOString());
 const withCopy=body.rows.map(r=>[r.door,r.breakdown]);
 clock+=FLEET_BREAKDOWN_COPY_MS+1000;
 body=await(await fetch(url)).json();
 assert.equal(liveReads,1,'an old copy is not trusted: Pulse is read live');
 assert.deepEqual(body.rows.map(r=>[r.door,r.breakdown]),withCopy,'both give the same fleet');
});
