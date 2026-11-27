import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {DRILL_JOB_TYPES,drillJobMetrics,fixedDrillJobs,isDrillMachine} from '../shared/drill-log-book.mjs';
import {normalizeDrillLogBook,registerLogBooks} from '../server/routes/log-book.mjs';
import {batchDrillPeriods,drillBatchShiftIssue,drillPeriodBatchShift,drillShiftEntryAllowed} from '../shared/drill-batch-shift.mjs';
import {misPageAllowed,misRequestAllowed} from '../shared/mis-application-access.mjs';
import {requestedMisPage} from '../src/mis-navigation.mjs';

const base=()=>({bookDate:'2026-11-24',location:'Jayant OB',assetId:'1',employeeId:'2',shiftId:'3',shiftPeriod:'day',compressorOpening:1000,compressorClosing:1010,machineOpening:1200,machineClosing:1212,jobRows:fixedDrillJobs().map((row,index)=>index?row:{...row,holes:70,holeLength:6}),breakdowns:[],requestKey:'123e4567-e89b-42d3-a456-426614174000'});

test('DLB identifies only drill machines and calculates the supplied form metrics',()=>{
 assert.equal(isDrillMachine({category:'DRILL'}),true);
 assert.equal(isDrillMachine({equipmentName:'Blast Hole Drill Rig'}),true);
 assert.equal(isDrillMachine({category:'Excavator',equipmentName:'PC 1250'}),false);
 assert.deepEqual(drillJobMetrics({holes:70,holeLength:6},10),{totalMetrage:420,holesPerHour:7,metersPerHour:42});
});

test('DLB normalization preserves readings and calculated drill rows',()=>{
 const row=normalizeDrillLogBook(base());
 assert.equal(row.docType,'DLB');assert.equal(row.shiftPeriod,'day');assert.equal(row.shiftHours,12);assert.equal(row.compressorRunning,10);assert.equal(row.machineRunning,12);
 assert.deepEqual(row.jobs.map(job=>job.jobType),DRILL_JOB_TYPES);assert.deepEqual(row.jobs[0],{jobType:'Clay Area',holes:70,holeLength:6,totalMetrage:420,holesPerHour:7,metersPerHour:42});assert.equal(row.jobs[2].holes,0);
 assert.throws(()=>normalizeDrillLogBook({...base(),machineClosing:1201}),/greater than or equal to compressor/);
 assert.throws(()=>normalizeDrillLogBook({...base(),shiftPeriod:''}),/Day or Night/);
});

test('DLB appears below LMV, has its own URL and inherits Equipment Log Book access',()=>{
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 const lmv=main.indexOf("label:'LMV Log Book (LMV)"),dlb=main.indexOf("label:'Drill Log Book (DLB)'"),elb=main.indexOf("label:'Equipment Log Book (ELB)'");
 assert.ok(lmv<dlb&&dlb<elb);assert.match(main,/renderedActive==='Drill Log Book'.*<DrillLogBook session=\{session\}/s);
 assert.equal(requestedMisPage('?page=drill-log-book'),'Drill Log Book');
 const session={permissions:{separateMisCredentials:true,misDesktopAccess:['Equipment Log Book'],misMobileAccess:[]}};
 assert.equal(misPageAllowed(session,'Drill Log Book','desktop'),true);
 assert.equal(misRequestAllowed(session,{path:'/api/drill-log-books',method:'POST'}),true);
});

test('DLB screen explicitly filters site-wise drill machines',()=>{
 const source=readFileSync(new URL('../src/drill-log-book.jsx',import.meta.url),'utf8');
 assert.match(source,/filter\(row=>isDrillMachine\(row\)&&sameSite\(row\)\)/);
 assert.match(source,/only drill machines assigned to the selected site are available/);
 assert.match(source,/label="Door NO"/);assert.match(source,/rigs\.length===1\?rigs\[0\]\.id/);
 assert.match(source,/DRILL_SHIFT_PERIODS\.filter\(row=>drillPeriods\.includes\(row\.id\)\)\.map/);assert.match(source,/needs no Drill Log Book/);assert.match(source,/Fixed job types for every DLB entry/);
});

test('DLB API saves a site drill, numbers it, blocks duplicates and returns the register',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 for(const [name,data] of [['Equipment master',{category:'Equipment',equipmentGroup:'DRILL',door:'DR-01',equipmentName:'D75K',currentLocation:'Jayant OB'}],['C-Dir Employee master',{name:'Drill Operator',empId:'CMPL100',site:'Jayant OB'}],['Shift Master',{site:'Jayant OB',shiftName:'Shift B',startTime:'14:00:00',endTime:'22:00:00'}],['Shift Master',{site:'Jayant OB',shiftName:'Shift A',startTime:'06:00:00',endTime:'14:00:00'}],['Shift Master',{site:'Jayant OB',shiftName:'Shift C',startTime:'22:00:00',endTime:'06:00:00'}],['Shift Master',{site:'Jayant OB',shiftName:'Day',startTime:'06:00:00',endTime:'18:00:00'}],['Shift Master',{site:'Jayant OB',shiftName:'Night',startTime:'18:00:00',endTime:'06:00:00'}]])await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2)',[name,JSON.stringify(data)]);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args),pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());const auth=(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.session={login:'dlb-test',role:'super',permissions:{adminLevel:'Admin'}};next()};registerLogBooks(app,{pool,requireSession:auth,requireAdministrator:auth});app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});const url=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,method='GET',body)=>{const response=await fetch(url+path,{method,headers:{Authorization:'admin','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()}};
 const options=await call('/api/log-books/options');assert.equal(options.status,200);assert.equal(options.data.assets[0].group,'DRILL');assert.equal(isDrillMachine(options.data.assets[0]),true);
 const batchId=randomUUID();await db.query("INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,sequence,created_by,request_key,stage,vlb_locked_at,lmv_locked_at) VALUES($1,'DLB test batch','Jayant OB','2026-11-26','S2',1,'dlb-test',$2,'dlb_open',NOW(),NOW())",[batchId,randomUUID()]);
 const day=await call('/api/drill-log-books','POST',{...base(),batchId,bookDate:'2026-11-26',requestKey:randomUUID()});assert.equal(day.status,409);assert.match(day.data.error,/Day drill shift starts at 06:00, so its card goes in the Shift I batch/);
 const body={...base(),shiftPeriod:'night',batchId,bookDate:'2026-11-26',requestKey:randomUUID()};const saved=await call('/api/drill-log-books','POST',body);
 assert.equal(saved.status,201,JSON.stringify(saved.data));assert.equal(saved.data.book_no,'CAL/DLB/26-11-26/001');assert.equal(saved.data.data.rigNo,'DR-01');assert.equal(saved.data.data.operatorName,'Drill Operator');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_dlb_batch_entries WHERE batch_id=$1',[batchId])).rows[0].n,1);
 const updated=await call('/api/drill-log-books/'+saved.data.id,'PUT',{...body,revision:saved.data.revision,compressorClosing:1011,machineClosing:1213});assert.equal(updated.status,200,JSON.stringify(updated.data));assert.equal(updated.data.data.compressorClosing,1011);assert.equal(updated.data.data.machineOpening,1200);assert.equal(updated.data.revision,2);
 const duplicate=await call('/api/drill-log-books','POST',{...body,requestKey:randomUUID()});assert.equal(duplicate.status,409);assert.match(duplicate.data.error,/already exists/);
 const register=await call('/api/drill-log-books');assert.equal(register.status,200);assert.deepEqual(register.data.records.map(row=>row.book_no),['CAL/DLB/26-11-26/001']);
 const deleted=await call('/api/drill-log-books/'+saved.data.id,'DELETE',{revision:updated.data.revision});assert.equal(deleted.status,200,JSON.stringify(deleted.data));assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_dlb_batch_entries WHERE batch_id=$1',[batchId])).rows[0].n,0);
});

const SHIFTS=[['Shift A','06:00','14:00'],['Shift B','14:00','22:00'],['Shift C','22:00','06:00'],['Day','06:00','18:00'],['Night','18:00','06:00']].map(([shiftName,startTime,endTime])=>({site:'Sasti OC',shiftName,startTime,endTime}));

test('A 12-hour drill shift goes in the 8-hour batch in which it starts',()=>{
 const context={shifts:SHIFTS,site:'Sasti OC',date:'2026-11-27'};
 assert.equal(drillPeriodBatchShift('day',context),'S1');assert.equal(drillPeriodBatchShift('night',context),'S2');
 assert.deepEqual(batchDrillPeriods('S1',context),['day']);assert.deepEqual(batchDrillPeriods('S2',context),['night']);assert.deepEqual(batchDrillPeriods('S3',context),[]);
 assert.equal(drillBatchShiftIssue('night','S2',context),'');
 assert.match(drillBatchShiftIssue('day','S2',context),/Day drill shift starts at 06:00, so its card goes in the Shift I batch .*takes the Night drill shift/);
 assert.match(drillBatchShiftIssue('day','S3',context),/No drill shift starts in this batch: lock DLB without a card/);
 // Without Day / Night entries Day starts with Shift I and Night 12 hours later.
 const eight={...context,shifts:SHIFTS.slice(0,3)};
 assert.equal(drillPeriodBatchShift('day',eight),'S1');assert.equal(drillPeriodBatchShift('night',eight),'S2');
 // With no Shift Master at all the standard 05:00 / 13:00 / 21:00 shifts are used.
 assert.deepEqual(batchDrillPeriods('S1',{site:'Elsewhere'}),['day']);assert.deepEqual(batchDrillPeriods('S2',{site:'Elsewhere'}),['night']);
 // A night starting at 22:00 goes in Shift III.
 assert.deepEqual(batchDrillPeriods('S3',{...context,shifts:[...SHIFTS.slice(0,4),{site:'Sasti OC',shiftName:'Night',startTime:'22:00',endTime:'10:00'}]}),['night']);
 // A 12-hour batch takes the drill shift of its own name.
 assert.deepEqual(batchDrillPeriods('D',context),['day']);assert.deepEqual(batchDrillPeriods('N',context),['night']);
 assert.equal(drillShiftEntryAllowed({shiftName:'Shift B'},'S2','night'),true);assert.equal(drillShiftEntryAllowed({shiftName:'Night'},'S2','night'),true);
 assert.equal(drillShiftEntryAllowed({shiftName:'Day'},'S2','night'),false);assert.equal(drillShiftEntryAllowed({shiftName:'Shift A'},'S2','night'),false);
});
