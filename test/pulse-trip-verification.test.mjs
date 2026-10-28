import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {createCanvas} from '@napi-rs/canvas';
import {PGlite} from '@electric-sql/pglite';
import {LOG_BOOK_SCHEMA,insertLogBook} from '../log-book.mjs';
import {SCAN_SCHEMA} from '../bulk-card-scanning.mjs';
import {createPulseMasterSync} from '../pulse-master-sync.mjs';
import {planTripVerification,sameTripVehicle,enqueueTripVerification,tripVerificationMarker,createTripVerification,registerTripVerification} from '../pulse-trip-verification.mjs';

const record=()=>({id:1,book_type:'vehicle',book_no:'CAL/VLB/281026/S1/0001',data:{scanCardId:randomUUID(),bookDate:'2026-10-28',location:'Sasti OC',door:'V101',chassis:'CH101',registration:'MH01AB101',masterShiftStart:'05:00:00',shiftHours:8,cardShift:'I',bookShiftCode:'S1',timeMode:'with',openingHmr:100,closingHmr:105,openingKmr:200,closingKmr:240,trips:[{equipmentName:'V2',tripCount:1,loadingTime:'10:35:00',unloadingTime:'10:55:00'}]}});
const request=()=>({ref:'BD-TEST-101',site:'Sasti OC',door:'V101',chassis:'CH101',status:'Closed',start:'2026-10-28 08:00:00',closedAt:'2026-10-28 10:00:00',meterType:'KMR',openingMeterReadings:{HMR:'100',KMR:'200'}});
const now=Date.parse('2026-10-28T15:00:00+05:30');

test('matches the same site and vehicle, uses the earliest post-closure loading, and keeps meter identities',()=>{
 const card=record();card.data.trips.unshift({equipmentName:'V2',tripCount:1,loadingTime:'07:00',unloadingTime:'07:25'});
 const plan=planTripVerification(card,[request()],{now});assert.equal(plan.status,'ready');
 assert.equal(plan.firstTripAt,'2026-10-28T05:05:00.000Z');assert.equal(plan.payload.firstTripTime,'10:35:00');assert.equal(plan.payload.closingMeterReading,'240');
 assert.deepEqual(plan.payload.closingMeterReadings,{HMR:'105',KMR:'240'});assert.match(plan.payload.firstTripRemark,/CAL\/VLB/);
 assert.equal(sameTripVehicle(card.data,{door:'V101',chassis:'DIFFERENT'}),false);
 assert.equal(sameTripVehicle(card.data,{door:'V101',reg:'MH01DIFFERENT'}),false);
 assert.equal(planTripVerification(card,[{...request(),site:'Jayant OC'}],{now}).status,'pending');
 assert.equal(planTripVerification(card,[{...request(),status:'Open'}],{now}).status,'pending');
 assert.equal(planTripVerification(card,[{...request(),vehicleIdle:true}],{now}).status,'pending');
});

test('overnight trips use the following calendar day and do not guess grouped, incomplete or invalid times',()=>{
 const card=record();Object.assign(card.data,{masterShiftStart:'21:00:00',cardShift:'III',trips:[{tripCount:1,loadingTime:'00:20',unloadingTime:'00:40'}]});
 const bd={...request(),start:'2026-10-28 21:30:00',closedAt:'2026-10-28 23:50:00'};
 const plan=planTripVerification(card,[bd],{now:now+86400000});assert.equal(plan.status,'ready');assert.equal(plan.payload.firstTripDate,'2026-10-29');assert.equal(plan.payload.firstTripTime,'00:20:00');
 for(const patch of [{loadingTime:''},{unloadingTime:''},{tripCount:2},{loadingTime:'24:00'},{loadingTime:'05:10',unloadingTime:'05:20'},{loadingTime:'00:40',unloadingTime:'00:20'}]){
  const edited=structuredClone(card);Object.assign(edited.data.trips[0],patch);assert.equal(planTripVerification(edited,[bd],{now:now+86400000}).status,'review');
 }
 assert.equal(planTripVerification(card,[bd],{now}).status,'review');
});

test('ambiguous breakdowns, intervening breakdowns, conflicting first trips and meters require review',()=>{
 const card=record(),bd=request();
 for(const requests of [[bd,{...bd,ref:'SECOND'}],[bd,{...bd,ref:'NEW',status:'Open',start:'2026-10-28 10:20:00'}],[{...bd,firstTripAt:'2026-10-28 10:25:00'}],[{...bd,productionFirstTripAt:'2026-10-28 10:25:00'}],[{...bd,openingMeterReadings:{KMR:999}}],[{...bd,closedAt:'2026-10-28 11:00:00'}],[{...bd,start:'2026-10-28 11:00:00'}]])assert.equal(planTripVerification(card,requests,{now}).status,'review');
 const noTimes=record();noTimes.data.timeMode='without';assert.equal(planTripVerification(noTimes,[bd],{now}).status,'review');
 const already={...bd,verifiedAt:'2026-10-28 11:00:00',firstTripAt:'2026-10-28 10:35:00',firstTripRemark:tripVerificationMarker(card)};
 assert.equal(planTripVerification(card,[already],{now}).status,'verified');
 assert.equal(planTripVerification(card,[{...already,firstTripRemark:'Verified manually'}],{now}).status,'pending');
});

async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB); CREATE TABLE pulse_master_links(master_name TEXT,source_id TEXT,local_id BIGINT REFERENCES master_records(id),PRIMARY KEY(master_name,source_id));'+LOG_BOOK_SCHEMA+SCAN_SCHEMA);
 const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const card=record(),image=createCanvas(10,10).toBuffer('image/png');card.data.assetId=1;
 const batch=randomUUID();await db.query("INSERT INTO mis_scan_batches(id,kind,name,created_by) VALUES($1,'vehicle','Test','MIS tester')",[batch]);
 await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,status) VALUES($1,$2,1,'test.png',$3,'test-hash','approved')",[card.data.scanCardId,batch,image]);
 await query('BEGIN');const saved=await insertLogBook(pool,'vehicle',card.data,card.data.scanCardId,'MIS tester');await db.query("UPDATE mis_scan_cards SET status='posted',logbook_id=$1 WHERE id=$2",[saved.id,card.data.scanCardId]);await query('COMMIT');
 return {db,pool,card:{...saved,data:card.data},image};
}

test('saved scan → durable queue → Pulse API verification; retry after timeout reconciles without a second write',async t=>{
 const {db,pool,card}=await fixture(t),secrets=new Map();let source=request(),writes=0,reads=0,expired=false,loseResponse=true,logins=0;
 const pulse=createPulseMasterSync({pool,credentialStore:{read:async k=>secrets.get(k),write:async(k,v)=>secrets.set(k,v)},fetchImpl:async(url,options)=>{
  const path=new URL(url).pathname;
  if(path==='/api/login'){logins++;expired=false;return Response.json({token:'test-session-'+logins,role:'super',permissions:{adminLevel:'Admin'}});}
  if(expired)return Response.json({error:'expired'},{status:401});
  if(path==='/api/masters')return Response.json({'Equipment master':[]});
  if(path==='/api/requests'){reads++;return Response.json([source]);}
  assert.equal(path,'/api/requests/BD-TEST-101/verify');assert.equal(options.method,'PATCH');
  const payload=JSON.parse(options.body);assert.equal(payload.firstTripDate,'2026-10-28');assert.equal(payload.firstTripTime,'10:35:00');assert.equal(payload.closingMeterReading,'240');assert.match(payload.firstTripCardImage,/^data:image\/png;base64,/);
  writes++;source={...source,verifiedAt:new Date().toISOString(),firstTripAt:'2026-10-28T10:35:00+05:30',firstTripRemark:payload.firstTripRemark};
  if(loseResponse){loseResponse=false;throw Error('Network timeout after source commit');}return Response.json(source);
 }});
 await pulse.connect({username:'fixture-admin',password:'synthetic-only'});expired=true;
 const service=createTripVerification({pool,pulse});await service.run();
 let job=(await db.query('SELECT * FROM mis_pulse_trip_verifications')).rows[0];assert.equal(job.status,'pending');assert.equal(writes,1);assert.equal(logins,2);
 await db.query('UPDATE mis_pulse_trip_verifications SET next_attempt_at=NOW()');
 // New service represents a process restart. Queue and source evidence survive it.
 await createTripVerification({pool,pulse}).run();
 job=(await db.query('SELECT * FROM mis_pulse_trip_verifications')).rows[0];assert.equal(job.status,'verified');assert.equal(job.request_ref,source.ref);assert.equal(writes,1);assert.equal(reads,2);
 await enqueueTripVerification(pool,card);job=(await db.query('SELECT * FROM mis_pulse_trip_verifications')).rows[0];assert.equal(job.status,'verified');assert.match(job.reason,/edited after verification/);
 await service.run();assert.equal(writes,1);
});

test('blocked cards send nothing; offline retries persist; deleted cards and local scanner mode never send',async t=>{
 const {db,pool}=await fixture(t);let writes=0,offline=true,source=[request(),{...request(),ref:'AMBIGUOUS'}];
 const pulse={status:()=>({connected:true}),readBreakdownRequests:async()=>{if(offline)throw Error('Connection unavailable');return source;},verifyTripCard:async()=>{writes++;throw Error('must not send')}};
 const service=createTripVerification({pool,pulse});await service.run();assert.equal((await db.query('SELECT status FROM mis_pulse_trip_verifications')).rows[0].status,'pending');
 offline=false;await db.query('UPDATE mis_pulse_trip_verifications SET next_attempt_at=NOW()');await service.run();assert.equal((await db.query('SELECT status FROM mis_pulse_trip_verifications')).rows[0].status,'review');assert.equal(writes,0);
 await db.query("UPDATE mis_pulse_trip_verifications SET status='pending',next_attempt_at=NOW()");await createTripVerification({pool,pulse,enabled:false}).run();assert.equal((await db.query('SELECT attempts FROM mis_pulse_trip_verifications')).rows[0].attempts,2);
 await db.query('UPDATE mis_log_books SET deleted_at=NOW()');await service.run();assert.equal(writes,0);assert.equal((await db.query('SELECT attempts FROM mis_pulse_trip_verifications')).rows[0].attempts,2);
});

test('queue entries commit with scanned vehicle books; rollbacks, manual books and equipment books add no jobs',async t=>{
 const {db,pool,card}=await fixture(t);
 await pool.query('BEGIN');await insertLogBook(pool,'vehicle',{...card.data,scanCardId:randomUUID()},randomUUID(),'MIS tester');await pool.query('ROLLBACK');
 assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM mis_pulse_trip_verifications')).rows[0].count,1);
 const manual={...card.data};delete manual.scanCardId;
 await insertLogBook(pool,'vehicle',manual,randomUUID(),'MIS tester');
 await insertLogBook(pool,'equipment',card.data,randomUUID(),'MIS tester');
 assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM mis_pulse_trip_verifications')).rows[0].count,1);
});

test('status and retry endpoints require admin access and enforce the saved card site',async t=>{
 const {db,pool,card}=await fixture(t);
 const app=express(),pulse={status:()=>({connected:false})};
 const requireSession=(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.session={role:req.headers.authorization};next()};
 registerTripVerification(app,{pool,pulse,requireSession,requireAdministrator:(req,res,next)=>req.session.role==='admin'?next():res.sendStatus(403),getSiteScope:async()=>({sites:['Jayant OC']}),enabled:false});
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));t.after(()=>{server.closeAllConnections();server.close()});const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/api/pulse-trip-verification')).status,401);
 assert.equal((await fetch(base+'/api/pulse-trip-verification',{headers:{Authorization:'normal'}})).status,403);
 const status=await (await fetch(base+'/api/pulse-trip-verification',{headers:{Authorization:'admin'}})).json();assert.deepEqual(status.jobs,[]);assert.deepEqual(status.counts,{});
 assert.equal((await fetch(base+`/api/pulse-trip-verification/${card.id}/retry`,{method:'POST',headers:{Authorization:'admin'}})).status,403);
 assert.equal((await db.query('SELECT reason FROM mis_pulse_trip_verifications')).rows[0].reason,'Waiting for Pulse');
});
