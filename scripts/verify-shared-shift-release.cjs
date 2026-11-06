const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {Pool}=require('pg');

(async()=>{
 const root=pathToFileURL(path.resolve(process.env.SHARED_SHIFT_ROOT||'/home/site/wwwroot')+path.sep);
 const load=name=>import(new URL(name,root));
 const {misDatabaseConfig}=await load('server/rules/mis-database-config.mjs');
 const {LOG_BOOK_SCHEMA,insertLogBook,resolveLogBookData}=await load('server/routes/log-book.mjs');
 const {saveFleetEntry}=await load('server/rules/vlb-batch-stages.mjs');
 const {machineReportRows,twoStageEnabled}=await load('server/rules/vlb-two-stage.mjs');
 const {buildProductionReport}=await load('shared/production-report.mjs');
 assert.ok(twoStageEnabled());
 const db=new Pool({...misDatabaseConfig(),connectionTimeoutMillis:12000,statement_timeout:20000,max:1});
 try{
  const c=await db.connect();
  try{
   await c.query('BEGIN');
   const schema='shared_shift_verify_'+randomUUID().replaceAll('-','');
   await c.query('CREATE SCHEMA '+schema);
   await c.query('SET LOCAL search_path TO '+schema);
   await c.query('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
   const site='Sasti OC',actor='shared-shift-verification';
   const vehicle={id:'1',category:'Vehicle',door:'V-VERIFY',currentLocation:site,make:'Fixture',model:'Fixture'};
   const equipment={id:'2',category:'Equipment',door:'EQ-VERIFY',currentLocation:site};
   const shifts=[
    {id:'5',site,shiftName:'I',shiftCode:'I',startTime:'05:00',endTime:'13:00'},
    {id:'6',site,shiftName:'Day',shiftCode:'Day',startTime:'08:00',endTime:'20:00'},
   ];
   for(const [id,name,data] of [
    [1,'Equipment master',vehicle],[2,'Equipment master',equipment],
    [3,'C-Dir Employee master',{name:'Operator One',employeeId:'VERIFY1',site}],
    [4,'C-Dir Employee master',{name:'Operator Two',employeeId:'VERIFY2',site}],
    ...shifts.map(shift=>[shift.id,'Shift Master',shift]),
   ])await c.query('INSERT INTO master_records VALUES($1,$2,$3)',[id,name,JSON.stringify(data)]);
   for(const [index,limit] of [8,12].entries()){
    const date=index?'2026-12-19':'2026-12-18',shift=index?'D':'S1',batchId=randomUUID();
    const batch={id:batchId,site,name:'Verification '+shift,report_date:date,shift,stage:'elb_open'};
    await c.query("INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,sequence,creator_login,request_key,continuous_entry,saved_lock_policy) VALUES($1,$2,$3,$4,$5,1,$6,$7,true,true)",[batchId,batch.name,site,date,shift,actor,randomUUID()]);
    const body={bookDate:date,location:site,shiftId:shifts[index].id,shiftHours:limit,cardShift:shifts[index].shiftCode,manualBreakdownHours:0,timeMode:'without'};
    const vehicleCard=async(employeeId,openingHmr,closingHmr)=>{
     const data=await resolveLogBookData(c,'vehicle',{...body,assetId:1,employeeId,openingHmr,closingHmr,openingKmr:100,closingKmr:120,trips:[{equipmentName:equipment.door,tripCount:1}]});
     data.scanCardId=randomUUID();
     return insertLogBook(c,'vehicle',data,randomUUID(),actor);
    };
    const saveVehicle=await vehicleCard(3,100,106);
    await assert.rejects(()=>vehicleCard(4,106,100+limit+0.001),{status:409,details:{code:'shift_hmr_limit'}});
    const reliefVehicle=await vehicleCard(4,106,100+limit);
    assert.notEqual(saveVehicle.book_no,reliefVehicle.book_no);
    await c.query("UPDATE mis_vlb_batches SET stage='elb_open',vlb_locked_at=NOW() WHERE id=$1",[batchId]);
    const firstElb=await insertLogBook(c,'equipment',await resolveLogBookData(c,'equipment',{...body,assetId:2,employeeId:3,openingHmr:200,closingHmr:206,shiftStatus:'working'}),randomUUID(),actor);
    const ops={resolve:resolveLogBookData,insert:insertLogBook};
    const relief={shiftStatus:'working',employeeId:4,openingHmr:206,closingHmr:200+limit,additionalCard:true,requestKey:randomUUID()};
    await assert.rejects(()=>saveFleetEntry(c,batch,2,{...relief,closingHmr:200+limit+0.001},actor,ops),{status:409,details:{code:'shift_hmr_limit'}});
    const reliefElb=await saveFleetEntry(c,batch,2,relief,actor,ops);
    assert.notEqual(firstElb.book_no,reliefElb.book_no);
    await c.query("UPDATE mis_vlb_batches SET stage='closed',closed_at=NOW(),closure_revision=1 WHERE id=$1",[batchId]);
    const {rows:records}=await c.query('SELECT *,book_date::text FROM mis_log_books WHERE book_date=$1 ORDER BY id',[date]);
    assert.equal(records.length,4);
    const processed={...batch,closed_at:new Date().toISOString(),closure_revision:1};
    for(const card of records){
     if(card.book_type==='vehicle'){
      card.batches=[{...processed,snapshotRevision:card.revision}];
      card.data.trips=card.data.trips.map(trip=>({...trip,completedTrips:trip.tripCount}));
     }
    }
    const result=buildProductionReport({
     filters:{site,date,shift,mode:'shift'},records,assets:[vehicle,equipment],shifts,batches:[processed],
     capacities:[{id:'fixture',make:'Fixture',model:'Fixture',capacity:1,effectiveFrom:date}],
    });
    assert.equal(result.ready,true,JSON.stringify(result.issues));
    assert.deepEqual(result.doorRows.map(row=>[row.totalHours,row.totalTrips]),[[limit,2]]);
    assert.deepEqual(result.machineRows.map(row=>[row.totalHours,row.totalTrips]),[[limit,2]]);
    const fleet=(await c.query('SELECT * FROM mis_vlb_batch_fleet WHERE batch_id=$1',[batchId])).rows;
    assert.deepEqual(machineReportRows(fleet,records.filter(row=>row.book_type==='equipment')).others.map(row=>row.hours),[limit]);
    console.log(JSON.stringify({shift,vehicleCards:2,equipmentCards:2,rejectedExcessHmr:limit+0.001,vehicleRows:1,equipmentRows:1,combinedHmr:limit}));
   }
  }finally{
   await c.query('ROLLBACK');
   c.release();
  }
 }finally{await db.end();}
 console.log('Verification fixtures rolled back.');
})().catch(error=>{console.error(error.name,error.code||'',error.message.replace(/postgres(?:ql)?:\S+/gi,'[redacted]'));process.exitCode=1});
