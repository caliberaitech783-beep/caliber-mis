import {prepareVlbFixture} from './operational-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerLogBooks} from '../server/routes/log-book.mjs';
import {logBookSiteScope} from '../shared/log-book-access.mjs';

// 23 Nov 2026, Dudhichua East, rain day: every manual VLB card took 3 to 4 minutes to save.
// For a site login the save, after writing the card and before its commit, listed the sites by
// reading every card saved since 1 November (20 to 30 s on live) and then looked up the other
// cards for the handover links, all while it held the site, date and shift lock. Each operator
// of that shift waited behind the one in front. The card is now committed first; what the screen
// gets back is read afterwards, outside the transaction, from the server's one site list.

process.env.VLB_TWO_STAGE_BATCHES='0';
const SITE_LIST=/SELECT DISTINCT site FROM mis_log_books/i,HANDOVER_LOOKUP=/mis_vlb_has_handover_trip\(data\)/i;
const masters=[
 ['Equipment master',{category:'Vehicle',door:'V-892',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
 ['C-Dir Employee master',{name:'RAHUL TEST',empId:'CMPL19914',site:'Sasti OC'}],
 ['Shift Master',{site:'Sasti OC',shiftName:'Shift A',startTime:'05:00:00',endTime:'13:00:00'}],
 ['Equipment master',{category:'Equipment',door:'L1',equipmentName:'L1',currentLocation:'Sasti OC'}],
 ['Equipment master',{category:'Vehicle',door:'V-893',currentLocation:'Sasti OC',equipmentName:'Tipper'}]];
const card=changes=>({bookDate:'2026-12-18',location:'Sasti OC',assetId:1,employeeId:2,shiftId:3,shiftHours:8,openingKmr:28344,closingKmr:28344,openingHmr:1599,closingHmr:1599,timeMode:'with',trips:[],requestKey:randomUUID(),...changes});

async function harness(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 for(const [name,data] of masters)await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2)',[name,JSON.stringify(data)]);
 const log=[],state={failLookup:false,stallLookup:false,login:'site-mis',site:'Sasti OB'};
 const run=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const through=via=>(sql,args)=>{
  log.push({via,sql});
  if(state.stallLookup&&HANDOVER_LOOKUP.test(sql))return new Promise(()=>{});
  if(state.failLookup&&HANDOVER_LOOKUP.test(sql))return Promise.reject(new Error('read timed out'));
  return run(sql,args);
 };
 const pool={query:through('pool'),connect:async()=>({query:through('connection'),release(){log.push({via:'connection',sql:'(released)'});}})};
 const app=express();app.use(express.json());
 const requireSession=(req,res,next)=>{req.session={login:state.login};next();};
 // A site login: its scope names one site, so the list of sites that hold cards is needed.
 registerLogBooks(app,{pool,requireSession,requireAdministrator:(req,res,next)=>next(),getSiteScope:async()=>logBookSiteScope({site:state.site}),
  pulseMasterSync:{status:()=>({connected:true}),readBreakdownRequests:async()=>[]}});
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(route,method='GET',body)=>{
  if(body&&method==='POST')await prepareVlbFixture(db,body,'site-mis');
  const response=await fetch(base+route,{method,headers:{Authorization:'site','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,timing:response.headers.get('server-timing')||'',data:await response.json()};
 };
 assert.equal((await call('/api/log-books/vehicle')).status,200);   // creates the tables
 return {db,log,state,call};
}
// The statements one save ran on its own connection, from BEGIN to the moment it gave the connection back.
const transactionOf=entries=>{
 const own=entries.filter(entry=>entry.via==='connection'),begin=own.findIndex(entry=>/^\s*BEGIN\b/i.test(entry.sql));
 assert.ok(begin>=0,'the save opened a transaction');
 const end=own.findIndex((entry,index)=>index>begin&&entry.sql==='(released)');
 return own.slice(begin,end<0?undefined:end+1).map(entry=>entry.sql);
};

test('a site login saves a zero-trip card without the save ever listing the sites',async t=>{
 const {log,call}=await harness(t);
 log.length=0;
 const saved=await call('/api/log-books/vehicle','POST',card());
 assert.equal(saved.status,201,JSON.stringify(saved.data));
 assert.match(saved.data.book_no,/^VLB_M\//);
 assert.equal(saved.data.data.totalTrips,0);
 const statements=transactionOf(log);
 assert.equal(statements.filter(sql=>SITE_LIST.test(sql)).length,0,'no site list read on the save connection');
 assert.match(statements.at(-2),/^\s*COMMIT\b/i,'the connection is given back straight after the commit');
 assert.match(saved.timing,/commit;dur=[\d.]+, handovers;dur=/,'the answer is built after the commit');
});

test('a card with an open trip is committed before the other cards are read for its handover links',async t=>{
 const {db,log,call}=await harness(t);
 // An earlier card of the same tipper, so there is something to read.
 const earlier=await call('/api/log-books/vehicle','POST',card({bookDate:'2026-12-17',closingKmr:28350,closingHmr:1601,trips:[{equipmentName:'L1',loadingTime:'12:40:00',unloadingTime:'',tripCount:1}]}));
 assert.equal(earlier.status,201,JSON.stringify(earlier.data));
 log.length=0;
 const saved=await call('/api/log-books/vehicle','POST',card({openingKmr:28350,closingKmr:28360,openingHmr:1601,closingHmr:1603,trips:[{equipmentName:'',loadingTime:'',unloadingTime:'05:20:00',tripCount:1}]}));
 assert.equal(saved.status,201,JSON.stringify(saved.data));
 const statements=transactionOf(log);
 assert.equal(statements.filter(sql=>SITE_LIST.test(sql)||HANDOVER_LOOKUP.test(sql)).length,0,'nothing is read for the screen inside the save');
 const commit=log.findIndex(entry=>entry.via==='connection'&&/^\s*COMMIT\b/i.test(entry.sql));
 const lookup=log.findIndex(entry=>HANDOVER_LOOKUP.test(entry.sql));
 assert.ok(lookup>commit,'the other cards are read after the commit');
 assert.equal(log[lookup].via,'pool','and not on the connection that held the lock');
 // The answer is the same as before: the unloading is linked to the loading of the earlier card.
 const link=saved.data.data.trips[0].handoverLinks[0];
 assert.equal(link.role,'unloading');assert.equal(link.counterpart.bookNo,earlier.data.book_no);
 assert.equal(saved.data.data.trips[0].tripStatus,'closed');
 assert.equal(Number((await db.query("SELECT count(*) AS n FROM mis_log_books WHERE book_type='vehicle'")).rows[0].n),2);
});

test('when the read for the links fails the card is still saved and still answered as saved',async t=>{
 const {db,state,call}=await harness(t);
 state.failLookup=true;
 const body=card({trips:[{equipmentName:'L1',loadingTime:'12:40:00',unloadingTime:'',tripCount:1}]});
 const saved=await call('/api/log-books/vehicle','POST',body);
 assert.equal(saved.status,201,'a failed read after the commit is not reported as a failed save: '+JSON.stringify(saved.data));
 assert.match(saved.data.book_no,/^VLB_M\//);
 assert.equal(saved.data.data.trips[0].tripStatus,'open');
 assert.deepEqual(saved.data.data.trips[0].handoverLinks,[]);
 assert.equal(Number((await db.query("SELECT count(*) AS n FROM mis_log_books WHERE book_type='vehicle' AND deleted_at IS NULL")).rows[0].n),1);
 // Pressing Save again for the same card answers the saved card, not a second one.
 const again=await call('/api/log-books/vehicle','POST',body);
 assert.equal(again.status,200);assert.equal(again.data.book_no,saved.data.book_no);
 assert.equal(Number((await db.query("SELECT count(*) AS n FROM mis_log_books WHERE book_type='vehicle' AND deleted_at IS NULL")).rows[0].n),1);
});

test('the register under the form and repeated saves share one site list read',async t=>{
 const {log,call}=await harness(t);
 log.length=0;
 for(const door of [1,5]){
  const saved=await call('/api/log-books/vehicle','POST',card({assetId:door}));
  assert.equal(saved.status,201,JSON.stringify(saved.data));
  const list=await call('/api/log-books/vehicle');
  assert.equal(list.status,200);
  assert.ok(list.data.records.some(record=>record.book_no===saved.data.book_no),'the site login sees the card it just saved');
 }
 assert.equal(log.filter(entry=>SITE_LIST.test(entry.sql)).length,0,'the list read when the form opened served two saves and two register reads');
});

test('the first card ever saved at a site shows in that site login\'s register at once',async t=>{
 // The harness opened the register while no card existed, so the held list had no site in it.
 const {call}=await harness(t);
 const saved=await call('/api/log-books/vehicle','POST',card());
 assert.equal(saved.status,201,JSON.stringify(saved.data));
 const list=await call('/api/log-books/vehicle');
 assert.deepEqual(list.data.records.map(record=>record.book_no),[saved.data.book_no]);
});

test('a never-ending optional handover read cannot hold acknowledgement of a committed manual card',async t=>{
 const {db,state,call}=await harness(t);state.stallLookup=true;
 const body=card({trips:[{equipmentName:'L1',loadingTime:'12:40:00',unloadingTime:'',tripCount:1}]});
 const started=Date.now(),saved=await call('/api/log-books/vehicle','POST',body);
 assert.equal(saved.status,201,JSON.stringify(saved.data));
 assert.ok(Date.now()-started<5000,'acknowledge the committed card without waiting minutes for links');
 assert.equal(saved.data.data.trips[0].tripStatus,'open');
 assert.equal(Number((await db.query('SELECT count(*) AS n FROM mis_log_books')).rows[0].n),1);
});

test('save-reference confirmation is exact, scoped to its creator and site, and skips historical reads',async t=>{
 const {state,log,call}=await harness(t),body=card();
 const made=await call('/api/log-books/vehicle','POST',body);assert.equal(made.status,201);
 const route='/api/log-books/vehicle?saveReference='+body.requestKey;
 log.length=0;
 const found=await call(route);
 assert.equal(found.data.saveReference,body.requestKey);
 assert.equal(found.status,200);assert.equal(found.data.records[0].id,made.data.id);
 assert.equal(log.some(entry=>SITE_LIST.test(entry.sql)||HANDOVER_LOOKUP.test(entry.sql)),false);
 assert.deepEqual((await call('/api/log-books/vehicle?saveReference='+randomUUID())).data.records,[]);
 state.login='another-user';assert.deepEqual((await call(route)).data.records,[]);
 state.login='site-mis';state.site='Jayant OC';assert.deepEqual((await call(route)).data.records,[]);
 state.site='Sasti OB';assert.deepEqual((await call('/api/log-books/equipment?saveReference='+body.requestKey)).data.records,[]);
 assert.equal((await call('/api/log-books/vehicle?saveReference=invalid')).status,400);
});
