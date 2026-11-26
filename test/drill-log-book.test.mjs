import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {DRILL_JOB_TYPES,drillJobMetrics,fixedDrillJobs,isDrillMachine} from '../shared/drill-log-book.mjs';
import {normalizeDrillLogBook,registerLogBooks} from '../server/routes/log-book.mjs';
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
 assert.match(source,/DRILL_SHIFT_PERIODS\.map/);assert.match(source,/Fixed job types for every DLB entry/);
});

test('DLB API saves a site drill, numbers it, blocks duplicates and returns the register',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 for(const [name,data] of [['Equipment master',{category:'Equipment',equipmentGroup:'DRILL',door:'DR-01',equipmentName:'D75K',currentLocation:'Jayant OB'}],['C-Dir Employee master',{name:'Drill Operator',empId:'CMPL100',site:'Jayant OB'}],['Shift Master',{site:'Jayant OB',shiftName:'Shift B',startTime:'12:00:00',endTime:'21:00:00'}]])await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2)',[name,JSON.stringify(data)]);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args),pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());const auth=(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.session={login:'dlb-test',role:'super',permissions:{adminLevel:'Admin'}};next()};registerLogBooks(app,{pool,requireSession:auth,requireAdministrator:auth});app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});const url=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,method='GET',body)=>{const response=await fetch(url+path,{method,headers:{Authorization:'admin','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()}};
 const options=await call('/api/log-books/options');assert.equal(options.status,200);assert.equal(options.data.assets[0].group,'DRILL');assert.equal(isDrillMachine(options.data.assets[0]),true);
 const batchId=randomUUID();await db.query("INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,sequence,created_by,request_key,stage,vlb_locked_at,lmv_locked_at) VALUES($1,'DLB test batch','Jayant OB','2026-11-26','S2',1,'dlb-test',$2,'dlb_open',NOW(),NOW())",[batchId,randomUUID()]);
 const body={...base(),batchId,bookDate:'2026-11-26',requestKey:randomUUID()};const saved=await call('/api/drill-log-books','POST',body);
 assert.equal(saved.status,201,JSON.stringify(saved.data));assert.equal(saved.data.book_no,'CAL/DLB/26-11-26/001');assert.equal(saved.data.data.rigNo,'DR-01');assert.equal(saved.data.data.operatorName,'Drill Operator');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_dlb_batch_entries WHERE batch_id=$1',[batchId])).rows[0].n,1);
 const duplicate=await call('/api/drill-log-books','POST',{...body,requestKey:randomUUID()});assert.equal(duplicate.status,409);assert.match(duplicate.data.error,/already exists/);
 const register=await call('/api/drill-log-books');assert.equal(register.status,200);assert.deepEqual(register.data.records.map(row=>row.book_no),['CAL/DLB/26-11-26/001']);
});
