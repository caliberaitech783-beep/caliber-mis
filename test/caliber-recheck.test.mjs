// Owner, 22 Nov 2026: "Once the employee master in Pulse-II is ready we will run this complete report, how many
// changes are there, and solve them at once." Every saved card since 1 Nov is judged again against Employee Master at
// its own site and date; the site names the right driver for each listed card from the paper card; one correction
// run puts those drivers on their cards, keeps who was there before, and can be run again until the list is empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {recheckSavedCard,recheckLine,recheckCounts,RECHECK_REASONS} from '../shared/caliber-recheck.mjs';
import {planSiteMove} from '../shared/employee-site-moves.mjs';
import {registerCaliberRecheck,pickRefusal,RECHECK_MAX_DAYS} from '../server/routes/caliber-recheck.mjs';
import {misPageAllowed,misRequestAllowed} from '../shared/mis-application-access.mjs';
import {requestedMisPage,misPageUrl} from '../src/mis-navigation.mjs';
import {recheckDates,emptyRecheck,addRecheckAnswer,recheckSiteRows,cardsOfSite,recheckSlotRows,cardsOfSlot,lookAlikeText,reasonCounts,recheckListSheets,recheckRecordSheets,EVERY} from '../src/caliber-recheck-model.mjs';

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
 assert.deepEqual(pair(listed('CMPL21999')),['unknown','No employee has number 21999.']);
 assert.deepEqual(pair(listed('CMPL2000')),['not-listed',"2000 is NOT LISTED, VOLVO DRIVER, who is not in HR's list for any site."]);
 assert.deepEqual(pair(listed('CMPL2100')),['left',"2100 is LEFT MAN, DRIVER. HR's list says this person has left."]);
 assert.deepEqual(pair(listed('CMPL1610')),['other-site','1610 is SASTI MAN, TIPPER DRIVER, of Sasti OC on this date.']);
 assert.deepEqual(pair(listed('CMPL15970')),['not-driver','15970 is HELPING HAND, HELPER: not a driver or operator.']);
 assert.deepEqual(pair(listed('CMPL3000')),['several','More than one employee at Majri OC has number 3000.']);
 assert.deepEqual(pair(listed('',{employeeId:'999'})),['unknown',"The saved driver's line is no longer in Employee Master."]);
 // The case that started this work: a number with its thin 1 dropped, saved under a person who had resigned.
 const gone=listed('CMPL1826',{aFormNo:'900'});
 assert.equal(gone.reason,'left');
 assert.equal(gone.line,'1826 is GONE MAN, VOLVO DRIVER. Employee Master says this person has resigned. The FORM A box says 900: at Majri OC that is 18126 (REAL MAN).');
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
 return {db,call,saved,day,state,audits,close:async()=>{server.close();await db.close();}};
};

test('the report: one day judged, the cards to check listed by site with their line and look-alike IDs',async()=>{
 const f=await fixture();
 try{
  const report=(await f.day('2026-11-20')).body;
  assert.deepEqual([report.cards,report.listed.length,report.picked,report.canApply],[6,3,0,true]);
  assert.deepEqual(report.sites.map(site=>[site.site,site.cards,site.listed]),[[MAJRI,5,3],[SASTI,1,0]]);
  assert.deepEqual(report.counts,{'not-listed':0,left:1,unknown:0,'other-site':1,'a-form-differs':0,'not-driver':1,several:0});
  const gone=report.listed.find(row=>row.id==='2');
  assert.deepEqual([gone.bookNo,gone.book,gone.kind,gone.date,gone.shift,gone.site,gone.door,gone.cardNo,gone.scanned,gone.savedId,gone.savedName,gone.reason,gone.reasonLabel],['BOOK-2','VLB','vehicle','2026-11-20','S1',MAJRI,'V942','900',true,'CMPL1826','GONE MAN','left','Has left']);
  assert.equal(gone.line,'1826 is GONE MAN, VOLVO DRIVER. Employee Master says this person has resigned. The FORM A box says 900: at Majri OC that is 18126 (REAL MAN).');
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

test('choosing the right driver changes nothing on the card; the correction run puts every choice on its card',async()=>{
 const f=await fixture();
 try{
  const pick=(logbookId,employeeId)=>f.call('/api/caliber-recheck/pick',{logbookId,employeeId});
  // Who may be chosen: only a working driver or operator of the card's site on its date.
  assert.equal((await pick('2','5')).body.error,'This is SASTI MAN, TIPPER DRIVER, Sasti OC. This number is not at Majri OC. Check the number on the card.');
  assert.equal((await pick('2','8')).body.error,"This is NOT LISTED, VOLVO DRIVER, who is not in HR's list for any site. Check the number on the card.");
  assert.equal((await pick('2','7')).body.error,'HELPING HAND is HELPER. Confirm on the Fetch box that this person drove the vehicle, then choose again.');
  assert.equal((await pick('2','3')).body.error,'Employee Master says this person has resigned. Choose the person who drove the vehicle.');
  assert.equal((await pick('2','999')).body.error,'This employee is no longer in Employee Master.');
  assert.equal((await pick('999','4')).status,404);assert.equal((await pick('x','4')).status,400);
  assert.deepEqual((await pick('1','2')).body,{same:true,pick:null},'the person already on the card: nothing to correct');

  const first=await pick('3','1');
  assert.equal(first.status,201);assert.deepEqual([first.body.pick.employeeId,first.body.pick.name,first.body.pick.by],['CMPL4400','DRIVER ONE','Majri Operator']);
  const second=await pick('3','6');
  assert.equal(second.body.pick.employeeId,'CMPL1618','a new choice replaces the earlier one');
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM mis_caliber_corrections WHERE status='pending'")).rows[0].n,1);
  assert.equal((await f.saved(3)).data.caliberId,'CMPL1610','choosing does not touch the card');
  assert.equal((await f.day('2026-11-20')).body.listed.find(row=>row.id==='3').pick.employeeId,'CMPL1618');
  assert.equal((await f.call('/api/caliber-recheck/pick/3',null,'DELETE')).body.removed,true);
  assert.equal((await f.call('/api/caliber-recheck/pick/3',null,'DELETE')).body.removed,false);
  assert.equal((await f.day('2026-11-20')).body.listed.find(row=>row.id==='3').pick,null);

  // Three choices wait: card 3 gets the look-alike, card 2 the man card 7 already holds for that vehicle and shift, card 6 a driver.
  await pick('3','6');await pick('2','4');await pick('6','1');
  f.state.admin=false;
  assert.equal((await f.call('/api/caliber-recheck/apply',{})).status,403,'the run is an administrator\'s action');
  assert.equal((await f.day('2026-11-20')).body.canApply,false);
  f.state.admin=true;f.state.login='mis.admin';f.state.name='MIS Admin';
  // Card 6 is edited by someone else before the run: its choice no longer holds.
  await f.db.query("UPDATE mis_log_books SET data=data||'{\"employeeId\":\"2\",\"caliberId\":\"CMPL4401\",\"employeeName\":\"DRIVER TWO\"}'::jsonb,revision=revision+1 WHERE id=6");
  const before=await f.saved(3);
  const run=await f.call('/api/caliber-recheck/apply',{});
  assert.equal(run.status,200);
  assert.deepEqual([run.body.applied,run.body.waiting,run.body.refused.length],[1,3,2]);
  assert.deepEqual(run.body.refused.find(row=>row.bookNo==='BOOK-2'),{bookNo:'BOOK-2',why:'REAL MAN already has card BOOK-7 for this vehicle in this shift. Check both cards.'});
  assert.deepEqual(run.body.refused.find(row=>row.bookNo==='BOOK-6'),{bookNo:'BOOK-6',why:'The card was changed after this driver was chosen. Choose again.'});

  const after=await f.saved(3);
  assert.deepEqual([after.data.employeeId,after.data.caliberId,after.data.employeeName,after.revision],['6','CMPL1618','LOOK ALIKE',before.revision+1]);
  assert.deepEqual([after.data.caliberCorrection.fromEmployeeId,after.data.caliberCorrection.fromCaliberId,after.data.caliberCorrection.fromName,after.data.caliberCorrection.reason,after.data.caliberCorrection.pickedBy,after.data.caliberCorrection.by],['5','CMPL1610','SASTI MAN','other-site','majri.operator','mis.admin']);
  for(const key of ['trips','openingKmr','closingKmr','door','aFormNo','bookShiftCode','assetId','bookDate','location'])assert.deepEqual(after.data[key],before.data[key],key+' is not touched');
  const copy=(await f.db.query('SELECT snapshot FROM mis_vlb_batch_entries WHERE logbook_id=3')).rows[0].snapshot;
  assert.deepEqual([copy.data.caliberId,copy.data.employeeName,copy.revision,copy.book_no],['CMPL1618','LOOK ALIKE',after.revision,'BOOK-3'],"the batch's copy follows the card");
  assert.equal((await f.saved(2)).data.caliberId,'CMPL1826','a refused choice changes nothing');

  // The list now: card 3 has left it; cards 2 and 6 still wait, each with why it was not corrected.
  const today=(await f.day('2026-11-20')).body;
  assert.equal(today.listed.some(row=>row.id==='3'),false);
  assert.equal(today.listed.find(row=>row.id==='2').pick.note,'REAL MAN already has card BOOK-7 for this vehicle in this shift. Check both cards.');
  // The record for HR.
  const record=(await f.call('/api/caliber-recheck/record')).body.corrections;
  assert.equal(record.length,1);
  assert.deepEqual([record[0].bookNo,record[0].book,record[0].date,record[0].site,record[0].reason,record[0].from,record[0].fromName,record[0].to,record[0].toName,record[0].pickedBy,record[0].appliedBy],['BOOK-3','VLB','2026-11-20',MAJRI,'Another site','CMPL1610','SASTI MAN','CMPL1618','LOOK ALIKE','Majri Operator','MIS Admin']);
  assert.deepEqual(recheckRecordSheets(record)[0].rows[0].slice(0,9),[MAJRI,'20-11-2026','VLB','BOOK-3','Another site','CMPL1610','SASTI MAN','CMPL1618','LOOK ALIKE']);
  // The run can be repeated: nothing new is applied, the two refused choices are tried again.
  const again=await f.call('/api/caliber-recheck/apply',{});
  assert.deepEqual([again.body.applied,again.body.waiting],[0,2]);
  assert.deepEqual(f.audits.filter(audit=>audit.action==='Run the corrections').map(audit=>audit.details.applied),[1,0]);
 }finally{await f.close();}
});

test('an operator card is corrected in its ELB batch copy, and a confirmed helper may be chosen',async()=>{
 const f=await fixture();
 try{
  await f.db.query("UPDATE master_records SET record_data=record_data||'{\"driverConfirmedAt\":\"2026-11-23T05:00:00.000Z\"}'::jsonb WHERE id=7");
  assert.equal((await f.day('2026-11-20')).body.listed.some(row=>row.id==='4'),false,'the confirmed helper stands on his own card');
  assert.equal((await f.call('/api/caliber-recheck/pick',{logbookId:'4',employeeId:'6'})).status,201);
  assert.equal((await f.call('/api/caliber-recheck/apply',{})).body.applied,1);
  assert.equal((await f.db.query('SELECT snapshot FROM mis_elb_batch_entries WHERE logbook_id=4')).rows[0].snapshot.data.caliberId,'CMPL1618');
  assert.equal(pickRefusal(lists()[6].record_data,{site:MAJRI,date:'2026-11-20',kind:'equipment'}),'HELPING HAND is HELPER. Confirm on the Fetch box that this person operated the machine, then choose again.');
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
 assert.equal(allowed(site,'/api/caliber-recheck/apply','POST'),false,'a site login cannot run the corrections');
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
 assert.ok(page.includes("'/api/caliber-recheck?from='+dates[i]+'&to='+dates[i]"),'the server is asked day by day');
 assert.ok(readFileSync(new URL('../server.mjs',import.meta.url),'utf8').includes('registerCaliberRecheck(app,{pool,requireSession,requireAdministrator,getSiteScope:logBookScope});'));
});
