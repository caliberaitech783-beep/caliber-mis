import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {LOG_BOOK_SCHEMA,registerLogBooks} from '../server/routes/log-book.mjs';
process.env.BATCH_COVERAGE_STOP_FROM='off'; // Every machine needs an answer before lock / close: covered in batch-fleet-coverage.test.mjs.

// 23 Nov 2026, after the manual save itself was made quick: a card save still waited 10 to 20 s
// whenever somebody pressed Lock VLB, Lock LMV, Close, Unlock VLB, reopen or saved a machine entry
// for that shift (Unlock VLB: for every site). Each of those built the whole batch page answer
// inside its transaction, so the site, date and shift lock was kept for as long as the page read
// takes, and Lock VLB wrote its machine list one line a statement. The lock is now given back at
// the commit and the answer is read afterwards, the same way the batch page reads it.

process.env.VLB_BATCH_ORDER_FROM='off';
const PAGE_ONLY=[/FROM mis_vlb_batch_audit WHERE batch_id=\$1 ORDER BY id DESC LIMIT 200/,/FROM mis_vlb_reopen_requests WHERE batch_id=\$1 AND withdrawn_at IS NULL/];
const FLEET_PAGE=/FROM mis_vlb_batch_fleet f LEFT JOIN mis_log_books l/;

async function harness(t){
 const previous=process.env.VLB_TWO_STAGE_BATCHES;delete process.env.VLB_TWO_STAGE_BATCHES;
 t.after(()=>{if(previous===undefined)delete process.env.VLB_TWO_STAGE_BATCHES;else process.env.VLB_TWO_STAGE_BATCHES=previous;});
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const masters=[
  ['Equipment master',{category:'Vehicle',door:'V1',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
  ['Users & employees',{login:'alice',employee:'Alice',employeeId:'CM-1',userRoles:'MIS User',status:'active',site:'Sasti OC'}],
  ['Shift Master',{site:'Sasti OC',shiftName:'Shift A',shiftCode:'I',startTime:'05:00:00',endTime:'13:00:00'}],
  ['Equipment master',{category:'Equipment',door:'VPC-019',equipmentName:'VPC 019',group:'Excavator',currentLocation:'Sasti OC'}],
  // A site's machine list is long: Lock VLB lists every machine of the site.
  ...Array.from({length:30},(_,index)=>['Equipment master',{category:'Equipment',door:'DZ-'+String(index+1).padStart(2,'0'),equipmentName:'Dozer '+(index+1),group:'Dozer',currentLocation:'Sasti OC'}]),
 ];
 const ids={};
 for(const [name,data] of masters){const {rows}=await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2) RETURNING id',[name,JSON.stringify(data)]);ids[data.door||data.login||data.shiftName]=String(rows[0].id);}
 const log=[],state={failPage:false};let connections=0;
 const run=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const through=via=>(sql,args)=>{
  log.push({via,sql});
  if(state.failPage&&PAGE_ONLY[0].test(sql))return Promise.reject(new Error('read timed out'));
  return run(sql,args);
 };
 const pool={query:through('pool'),connect:async()=>{const via='connection '+(++connections);return {query:through(via),release(){log.push({via,sql:'(released)'});}};}};
 const app=express();app.use(express.json({limit:'5mb'}));
 const requireSession=(req,res,next)=>{req.session={login:'alice',role:'super',permissions:{adminLevel:'Admin'}};next();};
 registerLogBooks(app,{pool,requireSession,requireAdministrator:(req,res,next)=>next(),pulseMasterSync:{status:()=>({connected:false}),readBreakdownRequests:async()=>[]}});
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(route,method='GET',body)=>{const response=await fetch(base+route,{method,headers:{Authorization:'alice','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
 const created=await call('/api/vlb-batches','POST',{site:'Sasti OC',date:'2026-12-18',shift:'S1',requestKey:randomUUID()});
 assert.equal(created.status,201,JSON.stringify(created.data));
 const batch='/api/vlb-batches/'+created.data.id;
 const card=await call('/api/log-books/vehicle','POST',{bookDate:'2026-12-18',location:'Sasti OC',assetId:ids.V1,employeeId:ids.alice,shiftId:ids['Shift A'],shiftHours:8,cardShift:'I',openingKmr:1000,closingKmr:1050,openingHmr:100,closingHmr:106,timeMode:'without',trips:[{equipmentName:'VPC 019',tripCount:6}],requestKey:randomUUID()});
 assert.equal(card.status,201,JSON.stringify(card.data));
 // One batch action: what it answered, and what its transaction ran while it held the lock.
 const act=async(route,body={})=>{
  log.length=0;
  const answer=await call(batch+route,'POST',body);
  const begin=log.find(entry=>/^\s*BEGIN\b/i.test(entry.sql));
  const own=begin?log.filter(entry=>entry.via===begin.via):[];
  const from=own.findIndex(entry=>/^\s*BEGIN\b/i.test(entry.sql)),to=own.findIndex((entry,index)=>index>from&&entry.sql==='(released)');
  const held=own.slice(from,to<0?undefined:to+1).map(entry=>entry.sql);
  return {answer,held,after:log.slice(log.indexOf(own[to<0?own.length-1:to])+1)};
 };
 return {db,ids,call,batch,act,state,log};
}
const pageReadsIn=statements=>statements.filter(sql=>PAGE_ONLY.some(pattern=>pattern.test(sql))||FLEET_PAGE.test(sql)).length;
const endsAtCommit=statements=>/^\s*COMMIT\b/i.test(statements.at(-2)||'')&&statements.at(-1)==='(released)';

test('Lock VLB, Lock LMV, Lock DLB, a machine entry, Close, reopen and Unlock VLB give the lock back before the batch page is read',async t=>{
 const {db,ids,call,batch,act}=await harness(t);
 const counts={};
 const check=async(name,route,body,{pageReadInside=0}={})=>{
  const {answer,held}=await act(route,body);
  assert.equal(answer.status,200,name+': '+JSON.stringify(answer.data));
  counts[name]=held.length;
  assert.ok(endsAtCommit(held),name+' gives its connection back straight after the commit');
  assert.equal(pageReadsIn(held),pageReadInside,name+' reads nothing for the page while it holds the lock');
  return answer.data;
 };

 const locked=await check('Lock VLB','/lock-vlb');
 assert.equal(locked.stage,'lmv_open');
 assert.deepEqual(locked,(await call(batch)).data,'Lock VLB answers exactly what the batch page reads');
 assert.equal(locked.audit[0].action,'vlb_locked','the answer already shows the action');

 const lmv=await check('Lock LMV','/lock-lmv');
 assert.equal(lmv.stage,'dlb_open');assert.equal(lmv.fleet.length,31,'every machine of the site is listed');
 assert.deepEqual(lmv,(await call(batch)).data);
 const dlb=await check('Lock DLB','/lock-dlb');
 assert.equal(dlb.stage,'elb_open');assert.ok(dlb.dlb_locked_at);
 assert.deepEqual(dlb,(await call(batch)).data);

 const {answer:entry,held:entryHeld}=await act('/fleet/'+ids['VPC-019'],{manualShift:'batch',shiftHours:8,shiftStatus:'working',employeeId:ids.alice,openingHmr:200,closingHmr:205});
 assert.equal(entry.status,200,JSON.stringify(entry.data));
 counts['Machine entry']=entryHeld.length;
 assert.ok(endsAtCommit(entryHeld),'the machine entry gives its connection back straight after the commit');
 assert.equal(entryHeld.filter(sql=>FLEET_PAGE.test(sql)).length,0,'the machine list for the page is read after the commit');
 assert.match(entry.data.record.book_no,/^[A-Z]/);
 const page=(await call(batch)).data;
 assert.deepEqual(entry.data.fleet,page.fleet,'the machine entry answers the machine list the page reads');
 assert.deepEqual(entry.data.fleetProgress,page.fleetProgress);assert.deepEqual(entry.data.closeBlockers,page.closeBlockers);assert.deepEqual(entry.data.machineReport,page.machineReport);
 assert.ok(entry.data.fleet.find(row=>row.assetId===ids['VPC-019']).logbook_id,'and it shows the machine as saved');

 // Close has to judge the whole batch inside the lock (one machine list read); the page answer is separate.
 const closed=await check('Close','/close',{},{pageReadInside:1});
 assert.equal(closed.stage,'closed');assert.ok(closed.closed_at);
 assert.deepEqual(closed,(await call(batch)).data);

 const reopened=await check('Reopen','/reopen');
 assert.equal(reopened.stage,'elb_open');assert.equal(reopened.closed_at,null);
 assert.deepEqual(reopened,(await call(batch)).data);

 const unlocked=await check('Unlock VLB','/unlock-vlb',{reason:'A card was left out'});
 assert.equal(unlocked.stage,'vlb_open');
 assert.deepEqual(unlocked,(await call(batch)).data);
 assert.equal(Number((await db.query('SELECT count(*) AS n FROM mis_vlb_batch_machines')).rows[0].n),0);
 t.diagnostic('statements run while the lock is held: '+JSON.stringify(counts));
});

test('Lock VLB writes the machine list of the site in one statement, with the same lines as before',async t=>{
 const {db,ids,act}=await harness(t);
 const {answer,held}=await act('/lock-vlb');
 assert.equal(answer.status,200,JSON.stringify(answer.data));
 assert.equal(held.filter(sql=>/INSERT INTO mis_vlb_batch_fleet/.test(sql)).length,1,'one statement for 31 machines, not 31');
 assert.equal(held.filter(sql=>/INSERT INTO mis_vlb_batch_machines/.test(sql)).length,1);
 assert.ok(held.length<=30,'Lock VLB ran '+held.length+' statements while it held the lock');
 const machines=(await db.query('SELECT asset_id::text AS id,machine_label,door,trips,source_cards FROM mis_vlb_batch_machines')).rows;
 assert.deepEqual(machines,[{id:ids['VPC-019'],machine_label:machines[0].machine_label,door:'VPC-019',trips:6,source_cards:1}]);
 const fleet=(await db.query('SELECT asset_id::text AS id,door,equipment_name,equipment_group,trips,source_cards,draft,logbook_id,skipped FROM mis_vlb_batch_fleet ORDER BY door')).rows;
 assert.equal(fleet.length,31);
 assert.deepEqual(fleet.find(row=>row.id===ids['VPC-019']),{id:ids['VPC-019'],door:'VPC-019',equipment_name:'VPC 019',equipment_group:'Excavator',trips:6,source_cards:1,draft:null,logbook_id:null,skipped:false});
 assert.deepEqual(fleet.find(row=>row.door==='DZ-07'),{id:ids['DZ-07'],door:'DZ-07',equipment_name:'Dozer 7',equipment_group:'Dozer',trips:0,source_cards:0,draft:null,logbook_id:null,skipped:false});
 // Unlocking and locking again keeps a saved machine and clears a draft, as the line-by-line write did.
 await db.query("UPDATE mis_vlb_batch_fleet SET draft='{\"skipped\":true}'::jsonb WHERE door='DZ-07'");
 assert.equal((await act('/unlock-vlb',{reason:'A card was left out'})).answer.status,200);
 assert.equal((await act('/lock-vlb')).answer.status,200);
 const again=(await db.query('SELECT door,draft,trips FROM mis_vlb_batch_fleet ORDER BY door')).rows;
 assert.equal(again.length,31);assert.equal(again.find(row=>row.door==='DZ-07').draft,null);assert.equal(again.find(row=>row.door==='VPC-019').trips,6);
});

test('a refused action answers its reason and changes nothing',async t=>{
 const {db,act}=await harness(t);
 const early=await act('/lock-lmv');
 assert.equal(early.answer.status,409);assert.match(early.answer.data.error,/LMV must be open/);
 const short=await act('/unlock-vlb',{reason:'no'});
 assert.equal(short.answer.status,400);
 assert.equal((await db.query('SELECT stage FROM mis_vlb_batches')).rows[0].stage,'vlb_open');
});

test('when the page cannot be read back the action is still done and says so',async t=>{
 const {db,call,batch,act,state}=await harness(t);
 state.failPage=true;
 const {answer}=await act('/lock-vlb');
 assert.equal(answer.status,503);
 assert.match(answer.data.error,/done/i,'the message says the action went through');
 assert.match(answer.data.error,/reload/i);
 assert.equal((await db.query('SELECT stage FROM mis_vlb_batches')).rows[0].stage,'lmv_open','VLB is locked');
 state.failPage=false;
 assert.equal((await call(batch)).data.stage,'lmv_open','and the page shows it on its next read');
});
