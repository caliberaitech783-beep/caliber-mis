import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createReportBuildPool,reportWorkerCount} from '../server/services/report-build-pool.mjs';
import {buildManpowerWeek} from '../server/rules/manpower-week.mjs';

const site='Sasti OC',date='2026-11-10';
const masters={assets:[{id:'1',door:'V1',site,category:'Vehicle',group:'Tipper',make:'Volvo',model:'FMX'}],employees:[{id:'21',caliberId:'101',caliberCode:'CMLL101',name:'Driver One'}],
 shifts:[{id:'31',site,shiftCode:'A',shiftName:'Shift A',startTime:'05:00',endTime:'13:00',status:'Active'}]};
const rows=[{id:1,book_no:'CARD-1',book_type:'vehicle',book_date:date,site,asset_id:1,batches:[],data:{bookDate:date,location:site,assetId:1,employeeId:21,caliberId:'101',shiftId:31,bookShiftCode:'S1',shiftName:'Shift A',masterShiftStart:'05:00',door:'V1',openingHmr:100,closingHmr:108,openingKmr:1000,closingKmr:1100,totalTrips:5,trips:[]}}];
const input=view=>({rows,attendance:[],masters,batches:[],filters:{from:date,to:date,contextFrom:'2026-11-09',contextTo:'2026-11-11'},view});

test('a week built on a worker thread is the same as one built in the main thread',async t=>{
 const pool=createReportBuildPool({size:1});t.after(()=>pool.close());
 for(const view of ['category-counts','category-cards','ot']){
  const built=await pool.run('manpower-week',input(view));
  assert.deepEqual(built,buildManpowerWeek(input(view)),view);
 }
 assert.equal(pool.status().workers,1);assert.equal(pool.status().inThread,false);
});

test('a build error keeps its message and status; a worker that cannot start or stops leaves the build to the main thread',async t=>{
 const pool=createReportBuildPool({size:1});t.after(()=>pool.close());
 await assert.rejects(pool.run('manpower-week',{...input('ot'),filters:{from:'2026-10-01',to:'2026-10-01'}}),e=>e.status===400&&/1 November 2026/.test(e.message));
 await assert.rejects(pool.run('no-such-build',{}),/Unknown report build/);
 const noWorker=createReportBuildPool({size:1,createWorker:()=>{throw new Error('no threads here');}});
 const original=console.error;console.error=()=>{};t.after(()=>{console.error=original;});
 assert.deepEqual(await noWorker.run('manpower-week',input('ot')),buildManpowerWeek(input('ot')));assert.equal(noWorker.status().inThread,true);
 // A worker that exits during the build: the same build runs here and the report still opens.
 const dying=()=>{const w=new EventEmitter();w.postMessage=()=>setImmediate(()=>w.emit('exit',1));w.terminate=async()=>{};w.unref=()=>{};return w;};
 const lost=createReportBuildPool({size:1,createWorker:dying});
 assert.deepEqual(await lost.run('manpower-week',input('category-counts')),buildManpowerWeek(input('category-counts')));
});

test('worker count: one or two by the processor count, or the MIS_REPORT_BUILD_WORKERS setting from 0 to 4',()=>{
 assert.equal(reportWorkerCount({},1),1);assert.equal(reportWorkerCount({},2),1);assert.equal(reportWorkerCount({},8),2);
 assert.equal(reportWorkerCount({MIS_REPORT_BUILD_WORKERS:'0'},8),0);assert.equal(reportWorkerCount({MIS_REPORT_BUILD_WORKERS:'3'},8),3);
 assert.equal(reportWorkerCount({MIS_REPORT_BUILD_WORKERS:'9'},8),2);assert.equal(reportWorkerCount({MIS_REPORT_BUILD_WORKERS:''},8),2);
});
