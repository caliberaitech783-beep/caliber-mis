import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {insertLogBook,registerLogBooks,resolveLogBookData} from '../server/routes/log-book.mjs';
import {assertSingleVlbCardPerShift,findVlbSheetTarget} from '../server/rules/vlb-duplicate-card.mjs';
import {joinVlbCardSheet} from '../server/routes/log-book.mjs';
import {parseTripCardSheet,isMultiSheet,savedCardSheets} from '../shared/trip-card-sheet.mjs';
import {readTripCardSheet} from '../server/services/trip-card-sheet-reading.mjs';
import {blockingScanWarnings} from '../shared/scan-auto-save.mjs';
import {prepareVlbFixture} from './operational-fixture.mjs';

process.env.VLB_TWO_STAGE_BATCHES='0';

async function harness(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB)');
 const masters=[
  [1,'Equipment master',{category:'Vehicle',door:'V07',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
  [5,'Equipment master',{category:'Vehicle',door:'V08',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
  [2,'C-Dir Employee master',{employee:'Driver',employeeId:'EMP1',site:'Sasti OC'}],
  [6,'C-Dir Employee master',{employee:'Relief driver',employeeId:'EMP2',site:'Sasti OC'}],
  [3,'Shift Master',{site:'Sasti OC',shiftName:'Shift A',shiftCode:'I'}],
  [4,'Shift Master',{site:'Sasti OC',shiftName:'Shift B',shiftCode:'II'}],
  [10,'Users & employees',{login:'alice',userType:'Mobile User',userGroup:'MIS User',site:'Sasti OC'}],
  [30,'Equipment master',{category:'Equipment',door:'VPC28',currentLocation:'Sasti OC'}],
 ];
 for(const [id,name,row] of masters)await db.query('INSERT INTO master_records VALUES($1,$2,$3)',[id,name,JSON.stringify(row)]);
 const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());
 const requireSession=(req,res,next)=>{const login=req.headers.authorization;if(!login)return res.status(401).json({error:'Sign in'});req.session={login,role:'super',permissions:{adminLevel:'Admin',separateMisCredentials:true,misDesktopAccess:['Vehicle Log Book']}};next()};
 registerLogBooks(app,{pool,requireSession,requireAdministrator:(_req,_res,next)=>next(),getSiteScope:async()=>({sites:['sasti ob']})});
 app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(path,method='GET',body,user='alice')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:{Authorization:user,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()}};
 return {db,call};
}
const input={bookDate:'2026-12-30',location:'Sasti OC',assetId:1,employeeId:2,shiftId:3,cardShift:'I',shiftHours:8,openingKmr:1000,closingKmr:1010,openingHmr:100,closingHmr:106,manualBreakdownHours:0,timeMode:'without',trips:[{equipmentName:'VPC28',tripCount:2}]};

test('a relief driver can save a separate manual card within the shared shift limits',async t=>{
 const {db,call}=await harness(t);
 assert.equal((await call('/api/log-books/options')).status,200);
 await prepareVlbFixture(db,input,'alice');
 const first=await call('/api/log-books/vehicle','POST',{...input,requestKey:randomUUID()});assert.equal(first.status,201,JSON.stringify(first.data));
 const second=await call('/api/log-books/vehicle','POST',{...input,requestKey:randomUUID()});
 assert.equal(second.status,409);assert.equal(second.data.code,'duplicate_card');assert.equal(second.data.existing[0].bookNo,first.data.book_no);assert.match(second.data.error,new RegExp(first.data.book_no));
 const short=await call('/api/log-books/vehicle','POST',{...input,requestKey:randomUUID(),duplicateReason:'short'});assert.equal(short.status,409,'a reason under ten characters is not accepted');
 const relief={...input,employeeId:6,openingHmr:106,closingHmr:108};
 const over=await call('/api/log-books/vehicle','POST',{...relief,closingHmr:108.001,requestKey:randomUUID()});
 assert.equal(over.status,409);assert.equal(over.data.code,'shift_hmr_limit');assert.match(over.data.error,/8\.001 hours.*limit is 8 hours/);
 const replaced={...relief,openingKmr:50,closingKmr:40,replacementKmr:240};
 const overKmr=await call('/api/log-books/vehicle','POST',{...replaced,replacementKmr:240.001,requestKey:randomUUID()});
 assert.equal(overKmr.status,409);assert.equal(overKmr.data.code,'shift_kmr_limit');
 assert.match(overKmr.data.error,/250\.001 km.*limit is 250 km/);
 const extra=await call('/api/log-books/vehicle','POST',{...replaced,requestKey:randomUUID()});
 assert.equal(extra.status,201,JSON.stringify(extra.data));assert.equal(extra.data.data.duplicateReason,undefined);assert.equal(extra.data.data.duplicateOf,undefined);
 assert.equal(String(extra.data.data.employeeId),'6');
 assert.equal(extra.data.data.assetId,first.data.data.assetId);
 assert.notEqual(extra.data.book_no,first.data.book_no);
 const audit=(await db.query("SELECT detail FROM mis_vlb_batch_audit WHERE action='card_added_duplicate'")).rows;assert.equal(audit.length,0);
 assert.equal(extra.data.data.totalRunningKmr,240);
 const overKmrEdit=await call('/api/log-books/vehicle/'+first.data.id,'PUT',{...input,closingKmr:1012,revision:first.data.revision});
 assert.equal(overKmrEdit.status,409);assert.equal(overKmrEdit.data.code,'shift_kmr_limit');
 // Editing either card excludes that card from the combined shift total.
 assert.equal((await call('/api/log-books/vehicle/'+first.data.id,'PUT',{...input,revision:first.data.revision})).status,200);
 const rejectedEdit=await call('/api/log-books/vehicle/'+extra.data.id,'PUT',{...relief,closingHmr:109,revision:extra.data.revision});
 assert.equal(rejectedEdit.status,409);assert.equal(rejectedEdit.data.code,'shift_hmr_limit');
 const edited=await call('/api/log-books/vehicle/'+extra.data.id,'PUT',{...relief,closingKmr:1014,revision:extra.data.revision});assert.equal(edited.status,200,JSON.stringify(edited.data));assert.equal(edited.data.data.duplicateReason,relief.duplicateReason);
 const otherVehicle={...input,assetId:5,openingHmr:500,closingHmr:502};
 const driverOver=await call('/api/log-books/vehicle','POST',{...otherVehicle,closingHmr:502.001,requestKey:randomUUID()});
 assert.equal(driverOver.status,409);assert.equal(driverOver.data.code,'driver_shift_hmr_limit');
 assert.match(driverOver.data.error,/8\.001 hours.*shift limit is 8 hours/);
 const other=await call('/api/log-books/vehicle','POST',{...otherVehicle,requestKey:randomUUID()});assert.equal(other.status,201,JSON.stringify(other.data));
 assert.equal(other.data.data.employeeId,first.data.data.employeeId);
 assert.notEqual(other.data.book_no,first.data.book_no);
 const driverOverEdit=await call('/api/log-books/vehicle/'+other.data.id,'PUT',{...otherVehicle,closingHmr:503,revision:other.data.revision});
 assert.equal(driverOverEdit.status,409);assert.equal(driverOverEdit.data.code,'driver_shift_hmr_limit');
 const duplicateEdit=await call('/api/log-books/vehicle/'+other.data.id,'PUT',{...input,revision:other.data.revision});
 assert.equal(duplicateEdit.status,409);assert.equal(duplicateEdit.data.code,'duplicate_card');
 assert.equal((await call('/api/log-books/vehicle/'+other.data.id,'PUT',{...otherVehicle,revision:other.data.revision})).status,200);
 // a different shift or site is a different card
 await prepareVlbFixture(db,{...input,cardShift:'II'},'alice');
 assert.equal((await call('/api/log-books/vehicle','POST',{...input,shiftId:4,cardShift:'II',requestKey:randomUUID()})).status,201);
});

test('a second scanned card for the same driver is allowed only with a different printed card number',async t=>{
 const {db,call}=await harness(t);
 assert.equal((await call('/api/log-books/options')).status,200);
 await prepareVlbFixture(db,input,'alice');
 const first=await call('/api/log-books/vehicle','POST',{...input,aFormNo:'129',requestKey:randomUUID()});
 assert.equal(first.status,201,JSON.stringify(first.data));
 const relief=await resolveLogBookData(db,'vehicle',{...input,employeeId:6,openingHmr:106,closingHmr:108});
 relief.scanCardId=randomUUID();
 const saved=await insertLogBook(db,'vehicle',relief,randomUUID(),'alice');
 assert.equal(saved.data.totalWorkingHmr,2);
 assert.equal(saved.data.duplicateOf,undefined);
 const scan={...first.data.data,scanCardId:randomUUID(),duplicateReason:'Another user uploaded the same PDF'};
 await assert.rejects(
  ()=>assertSingleVlbCardPerShift(db,scan),
  error=>error.status===409&&error.details?.code==='duplicate_card'&&error.details.existing[0].bookNo===first.data.book_no&&/same Trip card NO 129.*Trip card sheet/i.test(error.message)
 );
 const nextCard={...scan,aFormNo:'130',scanCardNumber:'130'};
 assert.deepEqual(await assertSingleVlbCardPerShift(db,nextCard),[]);
});

test('combined Day and Night HMR accepts exactly 12 hours and rejects the next thousandth',async()=>{
 const {assertCombinedShiftMeters}=await import('../server/rules/log-book-shift-hmr.mjs');
 for(const kind of ['vehicle','equipment'])for(const shift of ['Day','Night']){
  const data={assetId:1,location:'Sasti OC',bookDate:'2026-12-30',cardShift:shift,shiftHours:12,openingHmr:107,closingHmr:112};
  const client={query:async()=>({rows:[
   {site:'Sasti OC',data:{cardShift:shift,openingHmr:100,closingHmr:107}},
   {site:'Sasti OC',data:{cardShift:'I',totalWorkingHmr:8}},
  ]})};
  await assertCombinedShiftMeters(client,kind,data);
  await assert.rejects(()=>assertCombinedShiftMeters(client,kind,{...data,closingHmr:112.001}),
   error=>error.details?.code==='shift_hmr_limit'&&/12\.001 hours.*limit is 12 hours/.test(error.message));
 }
});

test('the NO. OF TRIP CARDS box reads as sheet and total',()=>{
 assert.deepEqual(parseTripCardSheet('2/2'),{sheetNo:2,sheetTotal:2});
 assert.deepEqual(parseTripCardSheet(' 1 / 2 '),{sheetNo:1,sheetTotal:2});
 assert.deepEqual(parseTripCardSheet('2 of 3'),{sheetNo:2,sheetTotal:3});
 for(const bad of ['','3/2','0/2','2','2266','1/12',null,undefined])assert.equal(parseTripCardSheet(bad),null,String(bad));
 assert.equal(isMultiSheet('1/1'),false);assert.equal(isMultiSheet('2/2'),true);
 assert.equal(readTripCardSheet(JSON.stringify({fields:{tripCardSheet:{value:'2 / 2',status:'clear'}}})),'2/2');
 assert.equal(readTripCardSheet(JSON.stringify({fields:{tripCardSheet:{value:null,status:'missing'}}})),'');
 assert.equal(readTripCardSheet(JSON.stringify({fields:{}})),'');
 assert.equal(readTripCardSheet('not json'),'');
 assert.deepEqual(savedCardSheets({tripCardSheet:'1/2',joinedSheets:[{sheet:'2/2'}]}),[{sheetNo:1,sheetTotal:2},{sheetNo:2,sheetTotal:2}]);
 assert.deepEqual(blockingScanWarnings(['Sheet 2/2 of this trip card: its trips are added to VLB_X/1 when saved.']),[]);
});

test('sheet 2 of a saved trip card joins that card instead of being refused',async t=>{
 const {db,call}=await harness(t);
 assert.equal((await call('/api/log-books/options')).status,200);
 await prepareVlbFixture(db,input,'alice');
 const first=await call('/api/log-books/vehicle','POST',{...input,aFormNo:'2292',requestKey:randomUUID()});
 assert.equal(first.status,201,JSON.stringify(first.data));
 const scanned=async(sheet,extra={})=>({...(await resolveLogBookData(db,'vehicle',{...input,aFormNo:'2292',closingHmr:107,trips:[{equipmentName:'VPC28',tripCount:3}],...extra})),scanCardId:randomUUID(),scanCardNumber:'2292',...(sheet?{tripCardSheet:sheet}:{})});
 // Without the sheet box the scan is still refused, and the message says how to join it.
 const unmarked=await scanned('');
 assert.equal(await findVlbSheetTarget(db,unmarked),null);
 await assert.rejects(()=>assertSingleVlbCardPerShift(db,unmarked),error=>error.status===409&&/same Trip card NO 2292.*Trip card sheet/i.test(error.message));
 // The first sheet of a card cannot join one whose sheet is unknown.
 assert.equal(await findVlbSheetTarget(db,await scanned('1/2')),null);
 const sheet2=await scanned('2/2');
 const target=await findVlbSheetTarget(db,sheet2);
 assert.equal(target.bookNo,first.data.book_no);
 const joined=await joinVlbCardSheet(db,target,sheet2,{actor:'alice'});
 assert.equal(joined.id,first.data.id);assert.equal(joined.book_no,first.data.book_no);
 assert.equal(joined.data.trips.length,2);assert.equal(joined.data.totalTrips,5);
 assert.equal(joined.data.openingHmr,100);assert.equal(joined.data.closingHmr,107,'a later closing reading widens the card');
 assert.equal(joined.data.totalWorkingHmr,7,'meters copied onto both sheets are counted once');
 assert.equal(joined.data.tripCardSheet,'1/2');
 assert.equal(joined.data.joinedSheets.length,1);assert.equal(joined.data.joinedSheets[0].sheet,'2/2');assert.equal(joined.data.joinedSheets[0].scanCardId,sheet2.scanCardId);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM mis_log_books WHERE deleted_at IS NULL")).rows[0].n,1);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM mis_vlb_batch_audit WHERE action='card_sheet_joined'")).rows[0].n,1);
 // The same sheet scanned again, or a sheet of a different card size, is refused.
 await assert.rejects(()=>scanned('2/2').then(again=>findVlbSheetTarget(db,again)),error=>error.status===409&&/Sheet 2\/2 of Trip card NO 2292.*already saved in/.test(error.message));
 await assert.rejects(()=>scanned('3/3').then(other=>findVlbSheetTarget(db,other)),error=>error.status===409&&/holds sheet 1\/2, 2\/2/.test(error.message));
 // An edit of the joined card keeps its sheets.
 const edited=await call('/api/log-books/vehicle/'+first.data.id,'PUT',{...input,aFormNo:'2292',closingHmr:107,trips:joined.data.trips,revision:joined.revision});
 assert.equal(edited.status,200,JSON.stringify(edited.data));
 assert.equal(edited.data.data.joinedSheets.length,1);assert.equal(edited.data.data.tripCardSheet,'1/2');
});

test('a joined sheet still obeys the shift HMR limit',async t=>{
 const {db,call}=await harness(t);
 assert.equal((await call('/api/log-books/options')).status,200);
 await prepareVlbFixture(db,input,'alice');
 const first=await call('/api/log-books/vehicle','POST',{...input,aFormNo:'77',requestKey:randomUUID()});
 assert.equal(first.status,201,JSON.stringify(first.data));
 const sheet2={...(await resolveLogBookData(db,'vehicle',{...input,aFormNo:'77',openingHmr:104,closingHmr:108.5})),scanCardId:randomUUID(),scanCardNumber:'77',tripCardSheet:'2/2'};
 const target=await findVlbSheetTarget(db,sheet2);
 await assert.rejects(()=>joinVlbCardSheet(db,target,sheet2,{actor:'alice'}),error=>/8\.5 hours|limit/i.test(error.message));
 assert.equal((await db.query('SELECT data FROM mis_log_books WHERE id=$1',[first.data.id])).rows[0].data.closingHmr,106);
});
