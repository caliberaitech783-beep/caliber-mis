// Owner, 22 Nov 2026: "Once the employee master in Pulse-II is ready we will run this complete report, how many
// changes are there, and solve them at once." Every saved card since 1 Nov is judged again against Employee Master at
// its own site and date; the site names the right driver for each listed card from the paper card; one correction
// run puts those drivers on their cards, keeps who was there before, and can be run again until the list is empty.
// Owner, 23 Nov 2026: "Yes, build one step submit". The sites read "Submit, then wait for Run the corrections" as
// "not submitted" and could not find the run at the top of the page. Submit now corrects the card at once and the
// line leaves the list; Undo puts the earlier person back; the run stays only for the choices that still waited.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {recheckSavedCard,recheckLine,recheckCounts,RECHECK_REASONS,canConfirmSaved,confirmationHolds} from '../shared/caliber-recheck.mjs';
import {planSiteMove} from '../shared/employee-site-moves.mjs';
import {registerCaliberRecheck,pickRefusal,RECHECK_MAX_DAYS,CALIBER_RECHECK_SCHEMA} from '../server/routes/caliber-recheck.mjs';
import {misPageAllowed,misRequestAllowed} from '../shared/mis-application-access.mjs';
import {requestedMisPage,misPageUrl} from '../src/mis-navigation.mjs';
import {recheckDates,emptyRecheck,addRecheckAnswer,recheckSiteRows,cardsOfSite,recheckSlotRows,cardsOfSlot,lookAlikeText,reasonCounts,recheckListSheets,recheckRecordSheets,recheckConfirmedSheets,EVERY} from '../src/caliber-recheck-model.mjs';

const MAJRI='Majri OC',SASTI='Sasti OC';
const person=(id,number,name,designation,extra={})=>({id,master_name:'Employee master',record_data:{caliberId:'CMPL'+number,caliberCode:'CMLL'+number,name,currentDesignationName:designation,site:MAJRI,currentLocation:MAJRI,hrListed:true,hrLeft:false,status:'Active',...extra}});
const form=(id,aFormNo,number,site=MAJRI)=>({id,master_name:'A Form master',record_data:{aFormNo,employeeId:'CMLL'+number,site}});
const lists=()=>[
 person(1,4400,'DRIVER ONE','VOLVO DRIVER'),person(2,4401,'DRIVER TWO','TIPPER DRIVER'),
 person(3,1826,'GONE MAN','VOLVO DRIVER',{status:'Resigned',hrListed:undefined,hrLeft:undefined}),person(4,18126,'REAL MAN','VOLVO DRIVER'),
 person(5,1610,'SASTI MAN','TIPPER DRIVER',{site:SASTI,currentLocation:SASTI}),person(6,1618,'LOOK ALIKE','PC OPERATOR'),
 person(7,15970,'HELPING HAND','HELPER'),person(8,2000,'NOT LISTED','VOLVO DRIVER',{hrListed:false}),person(9,2100,'LEFT MAN','DRIVER',{hrLeft:true,status:'Left'}),
 person(10,3000,'TWIN A','VOLVO DRIVER'),person(11,3000,'TWIN B','VOLVO DRIVER'),person(12,12227,'ABC','',{hrListed:undefined,hrLeft:undefined,status:undefined}),
 form(101,'12',4400),form(102,'15',4401),form(103,'900',18126),
];
const card=(caliberId,more={})=>({kind:'vehicle',site:MAJRI,date:'2026-11-20',employeeId:'',caliberId,aFormNo:'',...more});

test('a saved card stands when its driver is a working driver of that site on that date',()=>{
 const masters=lists();
 assert.equal(recheckSavedCard(masters,card('CMPL4401')),null);
 assert.equal(recheckSavedCard(masters,card('4401',{aFormNo:'15'})),null,'the FORM A box agrees');
 assert.equal(recheckSavedCard(masters,card('CMPL4401',{aFormNo:'777'})),null,'a FORM A box that names nobody stops no card');
 assert.equal(recheckSavedCard(masters,card('CMPL12227')),null,'the dummy ID of the site');
 assert.equal(recheckSavedCard(masters,card('',{employeeId:'2'})),null,'an old card that kept only the master line: the number comes from that line');
 assert.equal(recheckSavedCard(masters,card('',{employeeId:''})),null,'a card saved with nobody on it has nothing to judge');
 assert.equal(recheckSavedCard(masters,card('CMPL4401',{kind:'equipment'})),null);
});

test('a card is listed, with one plain line, when its driver does not stand',()=>{
 const masters=lists(),listed=(caliberId,more)=>recheckSavedCard(masters,card(caliberId,more));
 const pair=row=>[row.reason,row.line];
 assert.deepEqual(pair(listed('CMPL21999')),['unknown','ID not found. Please contact your HR team.']);
 assert.deepEqual(pair(listed('CMPL2000')),['not-listed','ID not found. Please contact your HR team.']);
 assert.deepEqual(pair(listed('CMPL2100')),['left',"2100 is LEFT MAN, DRIVER. HR's list says this person has left. Please contact your HR team."]);
 assert.deepEqual(pair(listed('CMPL1610')),['other-site','1610 is SASTI MAN, TIPPER DRIVER, of Sasti OC on this date.']);
 assert.deepEqual(pair(listed('CMPL15970')),['not-driver','15970 is HELPING HAND, HELPER: not a driver or operator.']);
 assert.deepEqual(pair(listed('CMPL3000')),['several','More than one employee at Majri OC has number 3000.']);
 assert.deepEqual(pair(listed('',{employeeId:'999'})),['unknown',"The saved driver's line is no longer in Employee Master."]);
 // The case that started this work: a number with its thin 1 dropped, saved under a person who had resigned.
 const gone=listed('CMPL1826',{aFormNo:'900'});
 assert.equal(gone.reason,'left');
 assert.equal(gone.line,'1826 is GONE MAN, VOLVO DRIVER. Employee Master says this person has resigned. Please contact your HR team. The FORM A box says 900: at Majri OC that is 18126 (REAL MAN).');
 assert.deepEqual(gone.lookAlikes,[{id:'18126',name:'REAL MAN'}]);
 assert.deepEqual(gone.aForm,{no:'900',id:'18126',name:'REAL MAN'});
 // The misread that lands on a colleague of the same site: only the FORM A box shows it.
 const colleague=listed('CMPL4400',{aFormNo:'15'});
 assert.deepEqual(pair(colleague),['a-form-differs','4400 is DRIVER ONE, VOLVO DRIVER. But the FORM A box says 15: at Majri OC that is 4401 (DRIVER TWO), one digit away.']);
 assert.equal(listed('CMPL4400',{kind:'equipment',aFormNo:'15'}),null,'a job card has no FORM A box');
 assert.deepEqual(listed('CMPL1610').lookAlikes,[{id:'1618',name:'LOOK ALIKE'}]);
 assert.deepEqual(recheckCounts([listed('CMPL2000'),listed('CMPL2100'),listed('CMPL1610'),listed('CMPL1610')]),{'not-listed':1,left:1,unknown:0,'other-site':2,'a-form-differs':0,'not-driver':0,several:0});
 for(const reason of Object.keys(RECHECK_REASONS))assert.notEqual(recheckLine({reason,read:'1',at:MAJRI,name:'A'},'vehicle'),'',reason);
});

test('an approved site move counts from its date: cards before it stand at the old site',()=>{
 const masters=lists(),mover=masters[4];
 mover.record_data={...mover.record_data,...planSiteMove(mover.record_data,{to:MAJRI,fromDate:'2026-11-20',by:'majri.operator',approvedBy:['sasti.pm']}).patch};
 assert.equal(recheckSavedCard(masters,card('CMPL1610',{date:'2026-11-21'})),null,'at Majri from the move date');
 assert.equal(recheckSavedCard(masters,card('CMPL1610',{site:SASTI,date:'2026-11-19'})),null,'still a Sasti card before it');
 assert.equal(recheckSavedCard(masters,card('CMPL1610',{date:'2026-11-19'})).reason,'other-site');
 assert.equal(recheckSavedCard(masters,card('CMPL1610',{site:SASTI,date:'2026-11-21'})).reason,'other-site');
});

const fixture=async({scope={sites:null,label:'All sites'}}={})=>{
 const db=new PGlite();
 await db.exec(`CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);
  CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_no TEXT,book_type TEXT,book_date DATE,site TEXT,asset_id BIGINT,data JSONB,revision INTEGER DEFAULT 1,deleted_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE mis_vlb_batch_entries(batch_id TEXT,logbook_id BIGINT PRIMARY KEY,snapshot JSONB);
  CREATE TABLE mis_elb_batch_entries(batch_id TEXT,logbook_id BIGINT PRIMARY KEY,snapshot JSONB);`);
 for(const row of lists())await db.query('INSERT INTO master_records(id,master_name,record_data) VALUES($1,$2,$3)',[row.id,row.master_name,JSON.stringify(row.record_data)]);
 const book=async(id,type,date,site,data)=>{
  const full={bookDate:date,location:site,assetId:String(data.assetId||50),door:'V942',bookShiftCode:'S1',trips:[{equipmentName:'LPC01',tripCount:3}],openingKmr:100,closingKmr:140,...data};
  await db.query('INSERT INTO mis_log_books(id,book_no,book_type,book_date,site,asset_id,data,revision) VALUES($1,$2,$3,$4,$5,$6,$7,3)',[id,'BOOK-'+id,type,date,site,full.assetId,JSON.stringify(full)]);
  const table=type==='vehicle'?'mis_vlb_batch_entries':type==='equipment'?'mis_elb_batch_entries':null;
  if(table)await db.query('INSERT INTO '+table+'(batch_id,logbook_id,snapshot) VALUES($1,$2,$3)',['batch-1',id,JSON.stringify({id,book_no:'BOOK-'+id,book_type:type,data:full,revision:3})]);
 };
 // 20 Nov at Majri: one good card, one saved under the resigned man, one under the Sasti man, one helper; one ELB; one Sasti card.
 await book(1,'vehicle','2026-11-20',MAJRI,{employeeId:'2',caliberId:'CMPL4401',employeeName:'DRIVER TWO',aFormNo:'A-1',scanCardId:'s1'});
 await book(2,'vehicle','2026-11-20',MAJRI,{employeeId:'3',caliberId:'CMPL1826',employeeName:'GONE MAN',aFormNo:'900',scanCardId:'s2',assetId:51});
 await book(3,'vehicle','2026-11-20',MAJRI,{employeeId:'5',caliberId:'CMPL1610',employeeName:'SASTI MAN',aFormNo:'A-3',assetId:52,bookShiftCode:'S2'});
 await book(4,'equipment','2026-11-20',MAJRI,{employeeId:'7',caliberId:'CMPL15970',employeeName:'HELPING HAND',jobCardNo:'J-4',assetId:60});
 await book(5,'vehicle','2026-11-20',SASTI,{employeeId:'5',caliberId:'CMPL1610',employeeName:'SASTI MAN',aFormNo:'A-5',assetId:53});
 await book(6,'vehicle','2026-11-21',MAJRI,{employeeId:'8',caliberId:'CMPL2000',employeeName:'NOT LISTED',aFormNo:'A-6',assetId:54});
 // A second card of vehicle 51 in the same shift, under the man who really drove card 2.
 await book(7,'vehicle','2026-11-20',MAJRI,{employeeId:'4',caliberId:'CMPL18126',employeeName:'REAL MAN',aFormNo:'A-7',assetId:51,duplicateReason:''});
 const query=(sql,params)=>!params&&sql.includes(';')?db.exec(sql):db.query(sql,params);
 const pool={query,connect:async()=>({query,release(){}})};
 const state={admin:true,login:'majri.operator',name:'Majri Operator'},audits=[];
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{res.on('finish',()=>{if(req.audit)audits.push(req.audit)});next()});
 registerCaliberRecheck(app,{pool,requireSession:(req,res,next)=>{req.session={login:state.login,name:state.name,role:'super',permissions:{adminLevel:state.admin?'Admin':'User'}};next()},requireAdministrator:(req,res,next)=>next(),
  getSiteScope:async()=>scope,readMasters:async client=>client.query('SELECT id,master_name,record_data FROM master_records ORDER BY id')});
 const server=app.listen(0),base='http://127.0.0.1:'+server.address().port;
 const call=async(path,body,method=body?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>({}))};};
 const saved=async id=>(await db.query('SELECT data,revision FROM mis_log_books WHERE id=$1',[id])).rows[0];
 const day=date=>call('/api/caliber-recheck?from='+date+'&to='+date);
 // A choice made before Submit became one step: the row the old Submit wrote, waiting for the run.
 await db.exec(CALIBER_RECHECK_SCHEMA);
 const wait=async(logbookId,employeeId,reason='')=>{
  const row=(await db.query('SELECT book_no,book_type,book_date::text AS date,site,data FROM mis_log_books WHERE id=$1',[logbookId])).rows[0],person=lists().find(one=>one.id===employeeId).record_data;
  await db.query("UPDATE mis_caliber_corrections SET status='cancelled' WHERE logbook_id=$1 AND status='pending'",[logbookId]);
  await db.query('INSERT INTO mis_caliber_corrections(logbook_id,book_no,book_type,book_date,site,reason,old_employee_id,old_caliber_id,old_name,new_employee_id,new_caliber_id,new_name,picked_by,picked_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
   [logbookId,row.book_no,row.book_type,row.date,row.site,reason,String(row.data.employeeId||''),String(row.data.caliberId||''),String(row.data.employeeName||''),String(employeeId),person.caliberId,person.name,'majri.operator','Majri Operator']);
 };
 return {db,call,saved,day,wait,state,audits,book,close:async()=>{server.close();await db.close();}};
};

test('the report: one day judged, the cards to check listed by site with their line and look-alike IDs',async()=>{
 const f=await fixture();
 try{
  const report=(await f.day('2026-11-20')).body;
  assert.deepEqual([report.cards,report.listed.length,report.picked,report.canApply],[6,3,0,true]);
  assert.deepEqual(report.sites.map(site=>[site.site,site.cards,site.listed]),[[MAJRI,5,3],[SASTI,1,0]]);
  assert.deepEqual(report.counts,{'not-listed':0,left:1,unknown:0,'other-site':1,'a-form-differs':0,'not-driver':1,several:0});
  const gone=report.listed.find(row=>row.id==='2');
  assert.deepEqual([gone.bookNo,gone.book,gone.kind,gone.date,gone.shift,gone.site,gone.door,gone.cardNo,gone.scanned,gone.scanCardId,gone.savedId,gone.savedName,gone.reason,gone.reasonLabel],['BOOK-2','VLB','vehicle','2026-11-20','S1',MAJRI,'V942','900',true,'s2','CMPL1826','GONE MAN','left','Has left']);
  assert.equal(gone.line,'1826 is GONE MAN, VOLVO DRIVER. Employee Master says this person has resigned. Please contact your HR team. The FORM A box says 900: at Majri OC that is 18126 (REAL MAN).');
  assert.deepEqual(gone.lookAlikes,[{id:'18126',name:'REAL MAN'}]);
  const helper=report.listed.find(row=>row.id==='4');
  assert.deepEqual([helper.book,helper.kind,helper.cardNo,helper.scanned,helper.reason],['ELB','equipment','J-4',false,'not-driver']);
  assert.equal(report.listed.find(row=>row.id==='3').shift,'S2');
  assert.equal((await f.day('2026-11-21')).body.listed[0].reason,'not-listed');
  assert.equal((await f.call('/api/caliber-recheck?from=2026-11-01&to=2026-11-0'+(RECHECK_MAX_DAYS+1))).status,400,'no more than a week of cards at a time');
  assert.equal((await f.call('/api/caliber-recheck?from=2026-11-01&to=2026-11-0'+RECHECK_MAX_DAYS)).status,200);
 }finally{await f.close();}
});

test('a login of one site sees and chooses only for its own site',async()=>{
 const f=await fixture({scope:{sites:['sasti ob'],label:SASTI}});
 try{
  const report=(await f.day('2026-11-20')).body;
  assert.deepEqual([report.cards,report.listed.length,report.sites.map(site=>site.site)],[1,0,[SASTI]]);
  assert.equal((await f.call('/api/caliber-recheck/pick',{logbookId:'2',employeeId:'4'})).status,403);
 }finally{await f.close();}
});

test('Submit corrects the card at once: the driver goes on the card, its batch copy follows and the line leaves the list',async()=>{
 const f=await fixture();
 try{
  const pick=(logbookId,employeeId)=>f.call('/api/caliber-recheck/pick',{logbookId,employeeId});
  // Who may be put on a card: only a working driver or operator of the card's site on its date.
  assert.equal((await pick('2','5')).body.error,'This is SASTI MAN, TIPPER DRIVER, Sasti OC. This number is not at Majri OC. Check the number on the card.');
  assert.equal((await pick('2','8')).body.error,'ID not found. Please contact your HR team.');
  assert.equal((await pick('2','7')).body.error,'HELPING HAND is HELPER. Confirm on the Fetch box that this person drove the vehicle, then choose again.');
  assert.equal((await pick('2','3')).body.error,'Employee Master says this person has resigned. Choose the person who drove the vehicle.');
  assert.equal((await pick('2','999')).body.error,'This employee is no longer in Employee Master.');
  assert.equal((await pick('999','4')).status,404);assert.equal((await pick('x','4')).status,400);
  assert.deepEqual((await pick('1','2')).body,{same:true,pick:null,confirmed:false},'the person already on a card that stands: nothing to correct, nothing to confirm');
  // Only a card on the list is changed here: card 1 stands under DRIVER TWO.
  const standing=await pick('1','1');
  assert.deepEqual([standing.status,standing.body.error],[409,'Card BOOK-1 is not on the list: its driver stands at this site on this date. Nothing was changed.']);
  assert.equal((await f.saved(1)).data.caliberId,'CMPL4401');

  // A refusal that shows only as the driver is put on the card: REAL MAN already holds card 7 of that vehicle and shift.
  const twin=await pick('2','4');
  assert.deepEqual([twin.status,twin.body.error],[409,'REAL MAN already has card BOOK-7 for this vehicle in this shift. Check both cards.']);
  assert.equal((await f.saved(2)).data.caliberId,'CMPL1826','a refused Submit changes nothing');
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM mis_caliber_corrections')).rows[0].n,0,'and leaves nothing behind');

  // A site login, not an administrator, submits the look-alike for card 3: the card changes there and then.
  f.state.admin=false;
  const before=await f.saved(3);
  const done=await pick('3','6');
  assert.equal(done.status,201);
  assert.deepEqual([done.body.same,done.body.pick,done.body.corrected,done.body.still],[false,null,true,'']);
  const {id:correctionId,...made}=done.body.correction;
  assert.match(correctionId,/^[0-9]+$/);
  assert.deepEqual(made,{bookNo:'BOOK-3',from:'CMPL1610',fromName:'SASTI MAN',to:'CMPL1618',toName:'LOOK ALIKE'});
  const after=await f.saved(3);
  assert.deepEqual([after.data.employeeId,after.data.caliberId,after.data.employeeName,after.revision],['6','CMPL1618','LOOK ALIKE',before.revision+1]);
  assert.deepEqual([after.data.caliberCorrection.correctionId,after.data.caliberCorrection.fromEmployeeId,after.data.caliberCorrection.fromCaliberId,after.data.caliberCorrection.fromName,after.data.caliberCorrection.reason,after.data.caliberCorrection.pickedBy,after.data.caliberCorrection.by],[correctionId,'5','CMPL1610','SASTI MAN','other-site','majri.operator','majri.operator']);
  assert.equal('earlier' in after.data.caliberCorrection,false,'a first correction carries no older mark');
  for(const key of ['trips','openingKmr','closingKmr','door','aFormNo','bookShiftCode','assetId','bookDate','location'])assert.deepEqual(after.data[key],before.data[key],key+' is not touched');
  const copy=(await f.db.query('SELECT snapshot FROM mis_vlb_batch_entries WHERE logbook_id=3')).rows[0].snapshot;
  assert.deepEqual([copy.data.caliberId,copy.data.employeeName,copy.revision,copy.book_no],['CMPL1618','LOOK ALIKE',after.revision,'BOOK-3'],"the batch's copy follows the card");
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM mis_caliber_corrections WHERE status='pending'")).rows[0].n,0,'nothing waits for a run');

  // The list now: card 3 has left it and is counted as corrected, on its own date and site.
  const today=(await f.day('2026-11-20')).body;
  assert.equal(today.listed.some(row=>row.id==='3'),false);
  assert.deepEqual([today.corrected,today.picked,today.canApply,today.sites.find(site=>site.site===MAJRI).corrected,today.sites.find(site=>site.site===SASTI).corrected],[1,0,false,1,0]);
  assert.equal((await f.day('2026-11-21')).body.corrected,0);
  // Pressed again from a second tab: the card stands now, so nothing more happens to it.
  assert.equal((await pick('3','1')).status,409);
  assert.equal((await f.saved(3)).data.caliberId,'CMPL1618');

  // The record for HR.
  const record=(await f.call('/api/caliber-recheck/record')).body.corrections;
  assert.equal(record.length,1);
  assert.deepEqual([record[0].id,record[0].logbookId,record[0].bookNo,record[0].book,record[0].date,record[0].site,record[0].reason,record[0].from,record[0].fromName,record[0].to,record[0].toName,record[0].pickedBy,record[0].appliedBy],[correctionId,'3','BOOK-3','VLB','2026-11-20',MAJRI,'Another site','CMPL1610','SASTI MAN','CMPL1618','LOOK ALIKE','Majri Operator','Majri Operator']);
  assert.deepEqual(recheckRecordSheets(record)[0].rows[0].slice(0,9),[MAJRI,'20-11-2026','VLB','BOOK-3','Another site','CMPL1610','SASTI MAN','CMPL1618','LOOK ALIKE']);
  const audit=f.audits.find(row=>row.action==='Correct the driver');
  assert.deepEqual([audit.targetReference,audit.details.from,audit.details.to,audit.details.site,audit.details.date,audit.details.correction],['BOOK-3','CMPL1610','CMPL1618',MAJRI,'2026-11-20',correctionId]);
 }finally{await f.close();}
});

test('Undo puts the earlier person back, only while the card is as the correction left it',async()=>{
 const f=await fixture();
 try{
  const pick=(logbookId,employeeId)=>f.call('/api/caliber-recheck/pick',{logbookId,employeeId});
  const undo=id=>f.call('/api/caliber-recheck/correction/'+id,null,'DELETE');
  const original=await f.saved(3);
  const first=(await pick('3','6')).body.correction.id;
  const back=await undo(first);
  assert.deepEqual([back.status,back.body],[200,{removed:true,card:{bookNo:'BOOK-3',employeeId:'CMPL1610',name:'SASTI MAN'}}]);
  const restored=await f.saved(3);
  assert.deepEqual(restored.data,original.data,'the card is exactly as it was, with no mark of the correction');
  assert.equal(restored.revision,original.revision+2,'each change raises the revision, so the stored attendance of the day is built again');
  const copy=(await f.db.query('SELECT snapshot FROM mis_vlb_batch_entries WHERE logbook_id=3')).rows[0].snapshot;
  assert.deepEqual([copy.data.caliberId,copy.data.employeeName,copy.revision],['CMPL1610','SASTI MAN',restored.revision],"the batch's copy follows the card back");
  const today=(await f.day('2026-11-20')).body;
  assert.deepEqual([today.listed.find(row=>row.id==='3').reason,today.corrected],['other-site',0],'listed again');
  assert.deepEqual((await f.call('/api/caliber-recheck/record')).body.corrections,[]);
  assert.deepEqual((await undo(first)).body,{removed:false},'twice is harmless');
  assert.equal((await undo('x')).status,400);assert.deepEqual((await undo('999')).body,{removed:false});
  const audit=f.audits.find(row=>row.action==='Take back the correction');
  assert.deepEqual([audit.targetReference,audit.details.from,audit.details.to,audit.details.correction],['BOOK-3','CMPL1618','CMPL1610',first]);

  // A card changed after its correction is not touched.
  const second=(await pick('6','1')).body.correction.id;
  await f.db.query("UPDATE mis_log_books SET data=data||'{\"employeeId\":\"2\",\"caliberId\":\"CMPL4401\",\"employeeName\":\"DRIVER TWO\"}'::jsonb,revision=revision+1 WHERE id=6");
  const refused=await undo(second);
  assert.deepEqual([refused.status,refused.body.error],[409,'The card was changed after this correction, so it cannot be taken back from here.']);
  assert.equal((await f.saved(6)).data.caliberId,'CMPL4401');
  assert.equal((await f.call('/api/caliber-recheck/record')).body.corrections.length,1,'that correction stays on the record');

  // A number that is on two people of the site: the card is corrected, and said to be still on the list.
  const twin=await pick('3','10');
  assert.deepEqual([twin.status,twin.body.corrected,twin.body.still],[201,true,'More than one employee at Majri OC has number 3000.']);
  assert.equal((await f.day('2026-11-20')).body.listed.find(row=>row.id==='3').reason,'several');
  // Corrected a second time: taking the newer correction back leaves the older one in place, mark and all.
  const third=(await pick('3','6')).body.correction.id;
  assert.equal((await f.saved(3)).data.caliberCorrection.earlier.correctionId,twin.body.correction.id);
  assert.equal((await undo(twin.body.correction.id)).status,409,'the older correction is not taken back from under the newer one');
  assert.equal((await undo(third)).body.card.employeeId,'CMPL3000');
  const middle=await f.saved(3);
  assert.deepEqual([middle.data.caliberId,middle.data.employeeName,middle.data.caliberCorrection.correctionId,middle.data.caliberCorrection.fromCaliberId],['CMPL3000','TWIN A',twin.body.correction.id,'CMPL1610']);
  assert.equal((await undo(twin.body.correction.id)).body.card.employeeId,'CMPL1610');
  assert.deepEqual((await f.saved(3)).data,original.data);
 }finally{await f.close();}
});

test('a login of one site cannot take back a correction of another site',async()=>{
 const f=await fixture({scope:{sites:['sasti ob'],label:SASTI}});
 try{
  await f.db.query("INSERT INTO mis_caliber_corrections(logbook_id,book_no,book_type,book_date,site,old_employee_id,old_caliber_id,old_name,new_employee_id,new_caliber_id,new_name,picked_by,status,applied_by,applied_at) VALUES(3,'BOOK-3','vehicle','2026-11-20',$1,'5','CMPL1610','SASTI MAN','6','CMPL1618','LOOK ALIKE','majri.operator','applied','majri.operator',NOW())",[MAJRI]);
  assert.equal((await f.call('/api/caliber-recheck/correction/1',null,'DELETE')).status,403);
  assert.deepEqual((await f.call('/api/caliber-recheck/record')).body.corrections,[],'and does not see it');
 }finally{await f.close();}
});

test('a submitted driver whose FORM A box names a look-alike colleague: the number typed from the paper card settles the card',async()=>{
 const f=await fixture();
 try{
  // Card 9: saved under the Sasti man; its FORM A box 15 names DRIVER TWO (4401). The paper card shows DRIVER ONE (4400).
  await f.book(9,'vehicle','2026-11-21',MAJRI,{employeeId:'5',caliberId:'CMPL1610',employeeName:'SASTI MAN',aFormNo:'15',assetId:56});
  const done=await f.call('/api/caliber-recheck/pick',{logbookId:'9',employeeId:'1'});
  assert.deepEqual([done.status,done.body.corrected,done.body.still],[201,true,'']);
  let day=(await f.day('2026-11-21')).body;
  assert.deepEqual([day.listed.map(row=>row.id),day.confirmed,day.corrected],[['6'],1,1],'corrected, and not listed again for its FORM A box');
  const kept=(await f.call('/api/caliber-recheck/confirmed')).body.confirmed;
  assert.deepEqual([kept[0].bookNo,kept[0].driver,kept[0].driverName,kept[0].formA,kept[0].namedId,kept[0].by],['BOOK-9','CMPL4400','DRIVER ONE','15','4401','Majri Operator']);
  // Undo takes the correction and that confirmation back together.
  assert.equal((await f.call('/api/caliber-recheck/correction/'+done.body.correction.id,null,'DELETE')).body.removed,true);
  day=(await f.day('2026-11-21')).body;
  assert.deepEqual([day.listed.map(row=>[row.id,row.reason]),day.confirmed,day.corrected],[[['6','not-listed'],['9','other-site']],0,0]);
  assert.equal((await f.call('/api/caliber-recheck/confirmed')).body.confirmed.length,0);
 }finally{await f.close();}
});

test('the choices that waited before Submit became one step: shown, removed, replaced by a Submit, or put on their cards by the run',async()=>{
 const f=await fixture();
 try{
  await f.wait('3',1,'other-site');
  let today=(await f.day('2026-11-20')).body;
  const line=today.listed.find(row=>row.id==='3');
  assert.deepEqual([line.pick.employeeId,line.pick.name,line.pick.by,today.picked],['CMPL4400','DRIVER ONE','Majri Operator',1]);
  assert.equal((await f.saved(3)).data.caliberId,'CMPL1610','a waiting choice has not touched the card');
  assert.equal((await f.call('/api/caliber-recheck/pick/3',null,'DELETE')).body.removed,true);
  assert.equal((await f.call('/api/caliber-recheck/pick/3',null,'DELETE')).body.removed,false);
  assert.equal((await f.day('2026-11-20')).body.listed.find(row=>row.id==='3').pick,null);

  // A Submit on a line that had a waiting choice: the card is corrected at once and the waiting choice is dropped.
  await f.wait('3',1,'other-site');
  assert.equal((await f.call('/api/caliber-recheck/pick',{logbookId:'3',employeeId:'6'})).body.correction.to,'CMPL1618');
  assert.deepEqual((await f.db.query('SELECT status,new_caliber_id FROM mis_caliber_corrections WHERE logbook_id=3 ORDER BY id')).rows.map(row=>[row.status,row.new_caliber_id]),[['cancelled','CMPL4400'],['cancelled','CMPL4400'],['applied','CMPL1618']]);

  // The run: card 2 waits for the man card 7 already holds for that vehicle and shift, card 6 for a driver, card 4 for an operator.
  await f.wait('2',4,'left');await f.wait('6',1,'not-listed');await f.wait('4',6,'not-driver');
  f.state.admin=false;
  assert.equal((await f.call('/api/caliber-recheck/apply',{})).status,403,'the run is an administrator\'s action');
  assert.equal((await f.day('2026-11-20')).body.canApply,false);
  f.state.admin=true;f.state.login='mis.admin';f.state.name='MIS Admin';
  // Card 6 is edited by someone else before the run: its choice no longer holds.
  await f.db.query("UPDATE mis_log_books SET data=data||'{\"employeeId\":\"2\",\"caliberId\":\"CMPL4401\",\"employeeName\":\"DRIVER TWO\"}'::jsonb,revision=revision+1 WHERE id=6");
  const run=await f.call('/api/caliber-recheck/apply',{});
  assert.deepEqual([run.status,run.body.applied,run.body.waiting,run.body.refused.length],[200,1,3,2]);
  assert.deepEqual(run.body.refused.find(row=>row.bookNo==='BOOK-2'),{bookNo:'BOOK-2',why:'REAL MAN already has card BOOK-7 for this vehicle in this shift. Check both cards.'});
  assert.deepEqual(run.body.refused.find(row=>row.bookNo==='BOOK-6'),{bookNo:'BOOK-6',why:'The card was changed after this driver was chosen. Choose again.'});
  const operator=await f.saved(4);
  assert.deepEqual([operator.data.caliberId,operator.data.employeeName,operator.data.caliberCorrection.pickedBy,operator.data.caliberCorrection.by],['CMPL1618','LOOK ALIKE','majri.operator','mis.admin']);
  assert.equal((await f.db.query('SELECT snapshot FROM mis_elb_batch_entries WHERE logbook_id=4')).rows[0].snapshot.data.caliberId,'CMPL1618',"the ELB batch's copy follows the card");
  assert.equal((await f.saved(2)).data.caliberId,'CMPL1826','a refused choice changes nothing');

  // The list now: card 4 has left it; card 2 still waits, with why it was not corrected.
  today=(await f.day('2026-11-20')).body;
  assert.equal(today.listed.some(row=>row.id==='4'),false);
  assert.equal(today.listed.find(row=>row.id==='2').pick.note,'REAL MAN already has card BOOK-7 for this vehicle in this shift. Check both cards.');
  const done=(await f.call('/api/caliber-recheck/record')).body.corrections.find(row=>row.bookNo==='BOOK-4');
  assert.deepEqual([done.book,done.reason,done.from,done.to,done.pickedBy,done.appliedBy],['ELB','Not a driver or operator','CMPL15970','CMPL1618','Majri Operator','MIS Admin']);
  // The run can be repeated: nothing new is applied, the two refused choices are tried again.
  const again=await f.call('/api/caliber-recheck/apply',{});
  assert.deepEqual([again.body.applied,again.body.waiting],[0,2]);
  assert.deepEqual(f.audits.filter(audit=>audit.action==='Run the corrections').map(audit=>audit.details.applied),[1,0]);
 }finally{await f.close();}
});

test('a helper is refused until someone confirms this person drives; an operator card is corrected in its ELB batch copy',async()=>{
 const f=await fixture();
 try{
  const pick=(logbookId,employeeId)=>f.call('/api/caliber-recheck/pick',{logbookId,employeeId});
  assert.equal((await pick('3','7')).status,409,'the helper is not put on a card unconfirmed');
  // Card 4 (ELB) is under the helper: the operator from the paper card goes on it, in the ELB batch's copy too.
  const done=await pick('4','6');
  assert.equal(done.status,201);
  assert.equal((await f.db.query('SELECT snapshot FROM mis_elb_batch_entries WHERE logbook_id=4')).rows[0].snapshot.data.caliberId,'CMPL1618');
  assert.equal((await f.call('/api/caliber-recheck/correction/'+done.body.correction.id,null,'DELETE')).body.removed,true);
  assert.equal((await f.db.query('SELECT snapshot FROM mis_elb_batch_entries WHERE logbook_id=4')).rows[0].snapshot.data.caliberId,'CMPL15970');
  assert.equal((await f.day('2026-11-20')).body.listed.find(row=>row.id==='4').reason,'not-driver');
  // Someone confirms on the Fetch box that the helper drives: his own card stands, and he may be put on another.
  await f.db.query("UPDATE master_records SET record_data=record_data||'{\"driverConfirmedAt\":\"2026-11-23T05:00:00.000Z\"}'::jsonb WHERE id=7");
  assert.equal((await f.day('2026-11-20')).body.listed.some(row=>row.id==='4'),false,'the confirmed helper stands on his own card');
  assert.equal((await pick('3','7')).body.correction.to,'CMPL15970');
  assert.equal(pickRefusal(lists()[6].record_data,{site:MAJRI,date:'2026-11-20',kind:'equipment'}),'HELPING HAND is HELPER. Confirm on the Fetch box that this person operated the machine, then choose again.');
 }finally{await f.close();}
});

// Owner, 23 Nov 2026: "Yes add it" to a "This card is right" button for lines where the saved driver is correct.
test('which card a person may confirm as right, and how long the confirmation holds',()=>{
 const masters=lists(),listed=(caliberId,more)=>recheckSavedCard(masters,card(caliberId,more));
 const colleague=listed('CMPL4400',{aFormNo:'15',employeeId:'1'});
 assert.equal(canConfirmSaved(colleague),true,'only the FORM A box points away from the saved driver');
 for(const [number,reason] of [['CMPL2000','not-listed'],['CMPL2100','left'],['CMPL1610','other-site'],['CMPL15970','not-driver'],['CMPL3000','several'],['CMPL21999','unknown']]){
  assert.equal(listed(number).reason,reason);assert.equal(canConfirmSaved(listed(number)),false,reason+' is about the saved person: never settled with a tick');
 }
 assert.equal(canConfirmSaved(null),false);
 const said={employee_id:'1',a_form:'15'};
 assert.equal(confirmationHolds(said,{employeeId:'1',aFormNo:'15'},colleague),true);
 assert.equal(confirmationHolds(said,{employeeId:1,aFormNo:' 15 '},colleague),true);
 assert.equal(confirmationHolds(said,{employeeId:'2',aFormNo:'15'},colleague),false,'another driver is on the card now');
 assert.equal(confirmationHolds(said,{employeeId:'1',aFormNo:'12'},colleague),false,'the FORM A number on the card was changed');
 assert.equal(confirmationHolds(said,{employeeId:'1',aFormNo:'15'},{...colleague,reason:'left'}),false,'the driver has since left: listed again');
 assert.equal(confirmationHolds(null,{employeeId:'1',aFormNo:'15'},colleague),false);
});

test('"This card is right": the card leaves the list, nothing on it changes, who confirmed is kept, and it can be taken back',async()=>{
 const f=await fixture();
 try{
  // Card 8: saved under DRIVER ONE (4400), a working driver of Majri; its FORM A box 15 names DRIVER TWO (4401).
  await f.book(8,'vehicle','2026-11-21',MAJRI,{employeeId:'1',caliberId:'CMPL4400',employeeName:'DRIVER ONE',aFormNo:'15',scanCardId:'s8',assetId:55});
  const confirm=logbookId=>f.call('/api/caliber-recheck/confirm',{logbookId});
  let day=(await f.day('2026-11-21')).body;
  assert.deepEqual(day.listed.map(row=>[row.id,row.reason,row.canConfirm]),[['6','not-listed',false],['8','a-form-differs',true]]);
  assert.equal(day.confirmed,0);

  // Only a card whose saved driver stands may be confirmed.
  const refused=await confirm('6');
  assert.equal(refused.status,409);assert.equal(refused.body.error,'This card cannot be confirmed as right. ID not found. Please contact your HR team.');
  assert.deepEqual([(await confirm('2')).status,(await confirm('3')).status,(await confirm('4')).status],[409,409,409],'has left, another site, a helper');
  const stands=await confirm('1');
  assert.deepEqual([stands.status,stands.body],[200,{confirmed:false,stands:true}],'a card that stands has nothing to confirm');
  assert.equal((await confirm('999')).status,404);assert.equal((await confirm('x')).status,400);

  // A driver had been chosen for card 8 before Submit became one step, so the choice waits; the paper card then
  // shows the saved driver is right.
  await f.wait('8',2,'a-form-differs');
  const before=await f.saved(8);
  const done=await confirm('8');
  assert.equal(done.status,201);assert.deepEqual(done.body,{confirmed:true,card:{bookNo:'BOOK-8',employeeId:'CMPL4400',name:'DRIVER ONE'}});
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM mis_caliber_corrections WHERE logbook_id=8 AND status='pending'")).rows[0].n,0,'the choice that waited is dropped');
  assert.deepEqual(await f.saved(8),before,'nothing on the card changes');
  day=(await f.day('2026-11-21')).body;
  assert.deepEqual(day.listed.map(row=>row.id),['6'],'the card has left the list');
  assert.deepEqual([day.confirmed,day.sites.find(site=>site.site===MAJRI).confirmed,day.cards],[1,1,2]);
  assert.equal((await f.day('2026-11-20')).body.confirmed,0,'counted on its own date only');
  const audit=f.audits.find(row=>row.action==='Confirm the saved driver');
  assert.deepEqual([audit.targetReference,audit.details.driver,audit.details.formA,audit.details.formANames],['BOOK-8','CMPL4400','15','4401']);

  // The record for HR.
  const record=(await f.call('/api/caliber-recheck/confirmed')).body.confirmed;
  assert.equal(record.length,1);
  assert.deepEqual([record[0].logbookId,record[0].bookNo,record[0].book,record[0].date,record[0].site,record[0].driver,record[0].driverName,record[0].formA,record[0].namedId,record[0].namedName,record[0].by],['8','BOOK-8','VLB','2026-11-21',MAJRI,'CMPL4400','DRIVER ONE','15','4401','DRIVER TWO','Majri Operator']);
  assert.deepEqual(recheckConfirmedSheets(record)[0].rows[0].slice(0,10),[MAJRI,'21-11-2026','VLB','BOOK-8','CMPL4400','DRIVER ONE','15','4401','DRIVER TWO','Majri Operator']);
  assert.equal(recheckConfirmedSheets(record)[0].columns.length,recheckConfirmedSheets(record)[0].rows[0].length);

  // The run has nothing to do with a confirmed card.
  assert.deepEqual([(await f.call('/api/caliber-recheck/apply',{})).body.applied,(await f.saved(8)).data.caliberId],[0,'CMPL4400']);

  // Taken back: listed again. Twice is harmless.
  assert.equal((await f.call('/api/caliber-recheck/confirm/8',null,'DELETE')).body.removed,true);
  assert.equal((await f.call('/api/caliber-recheck/confirm/8',null,'DELETE')).body.removed,false);
  assert.equal((await f.call('/api/caliber-recheck/confirm/x',null,'DELETE')).status,400);
  day=(await f.day('2026-11-21')).body;
  assert.deepEqual([day.listed.map(row=>row.id),day.confirmed],[['6','8'],0]);
  assert.equal((await f.call('/api/caliber-recheck/confirmed')).body.confirmed.length,0);

  // Typing the saved driver's own number and pressing Submit is the same answer.
  assert.deepEqual((await f.call('/api/caliber-recheck/pick',{logbookId:'8',employeeId:'1'})).body,{same:true,pick:null,confirmed:true});
  assert.deepEqual((await f.day('2026-11-21')).body.listed.map(row=>row.id),['6']);
  // Confirming again changes nothing: one confirmation per card.
  assert.equal((await confirm('8')).status,201);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM mis_caliber_confirmed_cards WHERE logbook_id=8 AND status='confirmed'")).rows[0].n,1);

  // Another driver submitted afterwards: the confirmation no longer stands and the card is corrected at once.
  // FORM A 15 names DRIVER TWO, so the card stands now.
  const other=await f.call('/api/caliber-recheck/pick',{logbookId:'8',employeeId:'2'});
  assert.deepEqual([other.status,other.body.corrected,other.body.still],[201,true,'']);
  day=(await f.day('2026-11-21')).body;
  assert.deepEqual([day.listed.map(row=>row.id),day.confirmed,day.corrected],[['6'],0,1]);
  assert.equal((await f.call('/api/caliber-recheck/confirmed')).body.confirmed.length,0);
  // Undo: DRIVER ONE is back on the card, which is listed again.
  assert.equal((await f.call('/api/caliber-recheck/correction/'+other.body.correction.id,null,'DELETE')).body.removed,true);
  assert.deepEqual((await f.day('2026-11-21')).body.listed.map(row=>row.id),['6','8']);

  // A confirmation is for the card as it was: when the card is saved again under another driver it is judged afresh.
  assert.equal((await confirm('8')).status,201);
  await f.db.query("UPDATE mis_log_books SET data=data||'{\"employeeId\":\"2\",\"caliberId\":\"CMPL4401\",\"employeeName\":\"DRIVER TWO\",\"aFormNo\":\"12\"}'::jsonb WHERE id=8");
  day=(await f.day('2026-11-21')).body;
  assert.deepEqual([day.listed.find(row=>row.id==='8').reason,day.confirmed],['a-form-differs',0],'FORM A 12 names DRIVER ONE now: listed again');
 }finally{await f.close();}
});

test('a login of one site cannot confirm, or take back, a card of another site',async()=>{
 const f=await fixture({scope:{sites:['sasti ob'],label:SASTI}});
 try{
  await f.book(8,'vehicle','2026-11-21',MAJRI,{employeeId:'1',caliberId:'CMPL4400',employeeName:'DRIVER ONE',aFormNo:'15',assetId:55});
  assert.equal((await f.call('/api/caliber-recheck/confirm',{logbookId:'8'})).status,403);
  await f.db.query("INSERT INTO mis_caliber_confirmed_cards(logbook_id,book_no,book_type,book_date,site,reason,employee_id,caliber_id,name,a_form,confirmed_by) VALUES(8,'BOOK-8','vehicle','2026-11-21',$1,'a-form-differs','1','CMPL4400','DRIVER ONE','15','majri.operator')",[MAJRI]);
  assert.equal((await f.call('/api/caliber-recheck/confirm/8',null,'DELETE')).status,403);
  assert.deepEqual((await f.call('/api/caliber-recheck/confirmed')).body.confirmed,[],'and does not see it');
 }finally{await f.close();}
});

test('MIS logins: the page and each action are on the allowed list, the run for administrators only',()=>{
 const login=(pages,extra={})=>({...extra,permissions:{separateMisCredentials:true,misDesktopAccess:pages,misMobileAccess:[]}});
 const admin=pages=>login([...pages,'Users & employees'],{role:'super'});
 for(const page of ['Trip Card Bulk Scan','Job Card Bulk Scan','Vehicle Log Book','Equipment Log Book','Employee master'])assert.equal(misPageAllowed(login([page]),'Caliber ID Re-check','desktop'),true,page);
 assert.equal(misPageAllowed(login(['Reports','Dashboard']),'Caliber ID Re-check','desktop'),false);
 const allowed=(session,path,method)=>misRequestAllowed(session,{path,method});
 const site=login(['Trip Card Bulk Scan']);
 assert.equal(allowed(site,'/api/caliber-recheck','GET'),true);assert.equal(allowed(site,'/api/caliber-recheck/record','GET'),true);
 assert.equal(allowed(site,'/api/caliber-recheck/pick','POST'),true);assert.equal(allowed(site,'/api/caliber-recheck/pick/12','DELETE'),true);
 assert.equal(allowed(site,'/api/caliber-recheck/confirm','POST'),true,'"This card is right" follows choosing the driver');
 assert.equal(allowed(site,'/api/caliber-recheck/confirm/12','DELETE'),true);assert.equal(allowed(site,'/api/caliber-recheck/confirmed','GET'),true);
 assert.equal(allowed(site,'/api/caliber-recheck/confirm','GET'),false);assert.equal(allowed(site,'/api/caliber-recheck/confirm/12','POST'),false);assert.equal(allowed(site,'/api/caliber-recheck/confirmed','POST'),false);
 assert.equal(allowed(login(['Reports']),'/api/caliber-recheck/confirm','POST'),false);
 assert.equal(allowed(site,'/api/caliber-recheck/correction/12','DELETE'),true,'Undo of a correction follows choosing the driver');
 assert.equal(allowed(site,'/api/caliber-recheck/correction/12','POST'),false);assert.equal(allowed(site,'/api/caliber-recheck/correction','DELETE'),false);
 assert.equal(allowed(login(['Reports']),'/api/caliber-recheck/correction/12','DELETE'),false);
 assert.equal(allowed(site,'/api/caliber-recheck/apply','POST'),false,'a site login cannot run the choices that still wait');
 assert.equal(allowed(admin(['Trip Card Bulk Scan']),'/api/caliber-recheck/apply','POST'),true);
 assert.equal(allowed(site,'/api/caliber-recheck','POST'),false);assert.equal(allowed(site,'/api/caliber-recheck/pick','GET'),false);
 assert.equal(allowed(site,'/api/caliber-recheck/anything-else','GET'),false,'anything not listed fails closed');
 assert.equal(allowed(login(['Reports']),'/api/caliber-recheck','GET'),false);
});

test('the screen adds the days up, and a day asked again replaces its earlier answer',()=>{
 assert.deepEqual(recheckDates('2026-10-30','2026-11-03'),['2026-11-01','2026-11-02','2026-11-03'],'never before the first operating day');
 const line=(id,date,shift,siteKey,site,pick=null)=>({id,date,shift,siteKey,site,bookNo:'B'+id,book:'VLB',door:'V1',cardNo:'A'+id,scanned:true,savedId:'CMPL1',savedName:'X',reason:'other-site',reasonLabel:'Another site',line:'why',lookAlikes:[{id:'1618',name:'LOOK ALIKE'}],more:2,pick});
 const sites=[{key:'majri ob',site:MAJRI,cards:100,listed:0},{key:'sasti ob',site:SASTI,cards:50,listed:0}];
 let held=addRecheckAnswer(emptyRecheck(),{from:'2026-11-20',to:'2026-11-20',cards:150,sites,listed:[line('1','2026-11-20','S1','majri ob',MAJRI),line('2','2026-11-20','S2','majri ob',MAJRI)],canApply:true});
 held=addRecheckAnswer(held,{from:'2026-11-21',to:'2026-11-21',cards:150,sites,listed:[line('3','2026-11-21','S1','sasti ob',SASTI)],canApply:true});
 assert.deepEqual([held.cards,held.listed.length,held.days,held.canApply],[300,3,2,true]);
 // 20 Nov asked again after a driver was chosen for card 1.
 held=addRecheckAnswer(held,{from:'2026-11-20',to:'2026-11-20',cards:150,sites,listed:[line('1','2026-11-20','S1','majri ob',MAJRI,{employeeId:'CMPL1618',name:'LOOK ALIKE',by:'Operator'}),line('2','2026-11-20','S2','majri ob',MAJRI)],canApply:true});
 assert.deepEqual([held.cards,held.listed.length,held.days],[300,3,2],'not counted twice');
 // The cards confirmed right are added up by day and by site, and a day asked again replaces its earlier count.
 let counted=addRecheckAnswer(emptyRecheck(),{from:'2026-11-20',cards:10,confirmed:2,corrected:4,sites:[{key:'majri ob',site:MAJRI,cards:10,confirmed:2,corrected:4}],listed:[]});
 counted=addRecheckAnswer(counted,{from:'2026-11-21',cards:5,confirmed:1,corrected:2,sites:[{key:'majri ob',site:MAJRI,cards:3,confirmed:0,corrected:0},{key:'sasti ob',site:SASTI,cards:2,confirmed:1,corrected:2}],listed:[]});
 counted=addRecheckAnswer(counted,{from:'2026-11-20',cards:10,confirmed:3,corrected:5,sites:[{key:'majri ob',site:MAJRI,cards:10,confirmed:3,corrected:5}],listed:[]});
 assert.deepEqual([counted.confirmed,recheckSiteRows(counted).total.confirmed,recheckSiteRows(counted).rows.map(row=>[row.site,row.confirmed])],[4,4,[[MAJRI,3],[SASTI,1]]]);
 // The cards corrected (owner, 23 Nov 2026: Submit corrects at once) are added up the same way.
 assert.deepEqual([counted.corrected,recheckSiteRows(counted).total.corrected,recheckSiteRows(counted).rows.map(row=>[row.site,row.corrected])],[7,7,[[MAJRI,5],[SASTI,2]]]);
 assert.equal(recheckSiteRows(held).total.confirmed,0,'an older server answer without the count reads as none');
 assert.deepEqual([emptyRecheck().corrected,recheckSiteRows(held).total.corrected,recheckSiteRows(held).rows.map(row=>row.corrected)],[0,0,[0,0]]);
 const step1=recheckSiteRows(held);
 assert.deepEqual(step1.rows.map(row=>[row.site,row.cards,row.listed,row.picked,row.open]),[[MAJRI,200,2,1,1],[SASTI,100,1,0,1]]);
 assert.deepEqual([step1.total.site,step1.total.cards,step1.total.listed,step1.total.picked,step1.total.open,step1.total.total],['All sites',300,3,1,2,true]);
 const majri=cardsOfSite(held,'majri ob');
 assert.deepEqual(recheckSlotRows(majri).map(row=>[row.date,row.shift,row.count,row.picked,row.open]),[['2026-11-20','S1',1,1,0],['2026-11-20','S2',1,0,1]]);
 assert.equal(recheckSlotRows(cardsOfSite(held,EVERY),{manySites:true}).length,3);
 assert.deepEqual(cardsOfSlot(majri,{key:'k',date:'2026-11-20',shift:'S2',siteKey:''}).map(row=>row.id),['2']);
 assert.equal(cardsOfSlot(majri,{key:EVERY}).length,2);
 assert.equal(lookAlikeText(held.listed[0]),'1618 (LOOK ALIKE) and 2 more');
 assert.deepEqual(reasonCounts(held.listed),[{reason:'other-site',label:'Another site',count:3}]);
 const sheet=recheckListSheets(held.listed)[0];
 assert.equal(sheet.columns.length,sheet.rows[0].length);
 assert.deepEqual(sheet.rows[0].slice(0,5).concat(sheet.rows[0].slice(-2)),[MAJRI,'20-11-2026','S1','VLB','B1','CMPL1618 LOOK ALIKE','Operator']);
});

test('the page is in the menu, drawn in the report steps, with the Fetch box on each card',()=>{
 assert.equal(requestedMisPage('?page=caliber-recheck'),'Caliber ID Re-check');
 assert.match(misPageUrl('https://pulse-ll.cmll.in/','Caliber ID Re-check'),/\?page=caliber-recheck$/);
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/'A Form Master','Employee Current Location','Caliber ID Re-check','Equipment master'/);
 assert.ok(main.includes("renderedActive==='Caliber ID Re-check' ? (<CaliberRecheck session={session} ReportSection={ReportSection}/>)"));
 assert.ok(main.includes("if(name==='Caliber ID Re-check')return session?.permissions?.separateMisCredentials?misPageAllowed(session,name,responsiveMobile?'mobile':'desktop'):isAdministrator;"));
 const page=readFileSync(new URL('../src/caliber-recheck.jsx',import.meta.url),'utf8');
 for(const title of ["'Step 1 · Caliber ID re-check · All sites · '","'Step 2 · Caliber ID re-check · '","'Step 3 · Caliber ID re-check · '"])assert.ok(page.includes(title),title);
 assert.ok(page.includes('<DateShiftGrid grid={grid}'),'Step 2 is the shared date by shift table');
 assert.ok(page.includes('<EmployeeIdLookup key={row.id+'),'each card has the Fetch box');
 assert.ok(page.includes("{key:'scan',label:'Trip Card Scanned'"),'the original scan column is beside the right driver');
 assert.ok(page.includes('>View Original Card</button>'),'a scanned card opens its original image');
 assert.ok(page.includes("fetch('/api/scan-cards/'+card.scanCardId+'/image'"),'the preview reads the exact saved scan');
 assert.ok(page.includes('role="dialog" aria-modal="true"'),'the original card opens in a same-page preview');
 // Owner, 23 Nov 2026: a Submit button on every line; what it did is said on that line.
 assert.ok(page.includes(`<EmployeeIdLookup key={row.id+'|'+(row.pick?.id||'')} submitLabel="Submit" scanMode`),'each card has its Submit button');
 assert.ok(page.includes("{said?.id===row.id&&<small className={'cr-said'+(said.bad?' cr-said-bad':'')} role={said.bad?'alert':'status'}>{said.text}</small>}"),'the result of Submit is said on the line');
 // Owner, 23 Nov 2026: "build one step submit". Submit corrects the card at once; what changed is said above
 // Step 3 with Undo; the run and its columns show only while a choice made earlier still waits.
 assert.ok(page.includes('else if(answer.corrected)corrected(row,answer);'),'Submit corrects at once');
 assert.ok(page.includes("setKept({id:row.id,date:row.date,undo:'correction',correctionId:made.id,text:'Card '+row.bookNo+' corrected: now under '"),'what changed is said above Step 3');
 assert.ok(page.includes("api('/api/caliber-recheck/correction/'+correctionId,{method:'DELETE'})"),'Undo takes the correction back');
 assert.ok(page.includes("onClick={()=>kept.undo==='correction'?uncorrect(kept.correctionId,kept.date,kept.id):unconfirm(kept.id,kept.date)}>Undo</button>"),'one Undo on the line above Step 3');
 assert.ok(page.includes('<button type="button" onClick={()=>uncorrect(row.id,row.date,row.logbookId)}>Undo</button>'),'and on each line of Corrections done');
 assert.ok(page.includes('{held.canApply&&picked>0&&!confirming&&<button type="button" className="cr-run"'),'the run shows only while an earlier choice waits');
 assert.ok(page.includes("{key:'corrected',label:'Corrected',value:row=>row.corrected}"),'Step 1 counts the corrected cards');
 assert.ok(page.includes('<span><strong>{count(held.corrected)}</strong> corrected</span>'));
 assert.equal(page.includes('when the corrections are run'),false,'no line of the page says the card waits for a run');
 // Owner, 23 Nov 2026: "This card is right" on a line whose saved driver can stand, asked once by name, with Undo.
 assert.ok(page.includes('{row.canConfirm&&(asking===row.id'),'the button is only on a line the server says may be confirmed');
 assert.ok(page.includes('>This card is right</button>'));
 assert.ok(page.includes("'Yes, '+(row.savedName||row.savedId)+(row.kind==='equipment'?' operated this machine':' drove this vehicle')"),'the yes names the driver');
 assert.ok(page.includes("api('/api/caliber-recheck/confirm',{method:'POST',body:JSON.stringify({logbookId:row.id})})"));
 assert.ok(page.includes('{level>=3&&kept&&<p className="cr-notice cr-kept" role="status">'),'what happened to a card that left the list is said above Step 3');
 assert.ok(page.includes("{key:'confirmed',label:'Confirmed right',value:row=>row.confirmed}"),'Step 1 counts them');
 assert.ok(page.includes('<summary>Cards confirmed right'),'and HR has the list, with Undo');
 assert.ok(page.includes('const mine=fresh?++run.current:run.current;'),'reading one date again after a Submit does not stop a full read');
 assert.ok(page.includes("'/api/caliber-recheck?from='+dates[i]+'&to='+dates[i]"),'the server is asked day by day');
 assert.ok(readFileSync(new URL('../server.mjs',import.meta.url),'utf8').includes('registerCaliberRecheck(app,{pool,requireSession,requireAdministrator,getSiteScope:logBookScope});'));
});
