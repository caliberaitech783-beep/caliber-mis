// Caliber Punch Re-check (owner, 24 Nov 2026: "caliber punch recheck mis me hi, caliber id recheck ke niche"): the
// drivers and operators who punched but get no attendance because a VLB, ELB or LMV card of their site and date has an
// error, set beside those cards and put right on the same line through the Caliber ID Re-check routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {punchRecheck} from '../shared/caliber-punch-recheck.mjs';
import {cardRecheck,cardsOfView,CARD_VIEWS} from '../shared/caliber-card-recheck.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {registerCaliberRecheck,CALIBER_RECHECK_SCHEMA} from '../server/routes/caliber-recheck.mjs';
import {misPageAllowed,misRequestAllowed} from '../shared/mis-application-access.mjs';
import {requestedMisPage} from '../src/mis-navigation.mjs';
import {emptyPunchRecheck,addPunchAnswer,punchSiteRows,punchSlotRows,cardAction,punchDefaultRange,linesOfSite,PUNCH_VIEWS} from '../src/caliber-punch-recheck-model.mjs';

const MAJRI='Majri OC',DATE='2026-11-20',KEY=canonicalSiteName(MAJRI);
const person=(id,number,name,designation,extra={})=>({id,master_name:'Employee master',record_data:{caliberId:'CMPL'+number,caliberCode:'CMLL'+number,name,currentDesignationName:designation,site:MAJRI,currentLocation:MAJRI,hrListed:true,hrLeft:false,status:'Active',...extra}});
const masters=()=>[person(1,4400,'DRIVER ONE','VOLVO DRIVER'),person(2,4401,'DRIVER TWO','TIPPER DRIVER'),person(3,4402,'DRIVER THREE','VOLVO DRIVER'),
 person(4,4403,'DRIVER FOUR','PC OPERATOR'),person(5,15970,'HELPING HAND','HELPER'),person(6,4404,'DRIVER FIVE','VOLVO DRIVER')];

test('a punch is matched with the cards with an error at its site and date, the own card first',()=>{
 const listed=[{id:'10',date:DATE,siteKey:KEY,site:MAJRI,shift:'S1',savedId:'CMPL9999',reason:'unknown'},{id:'11',date:DATE,siteKey:KEY,site:MAJRI,shift:'S2',savedId:'CMPL4402',reason:'no-shift',pickShift:true}];
 const days=[{caliberCode:'4400',date:DATE,site:MAJRI,inTime:'06:01',outTime:'14:05',source:'machine'},{caliberCode:'4402',date:DATE,site:MAJRI,inTime:'14:00',outTime:'',source:'machine'},
  {caliberCode:'4401',date:DATE,site:MAJRI,inTime:'06:00',source:'imported'},{caliberCode:'15970',date:DATE,site:MAJRI,inTime:'06:00',source:'machine'},
  {caliberCode:'4403',date:'2026-11-21',site:MAJRI,inTime:'06:00',source:'machine'}];
 const counted=new Map([['4401|'+DATE,[{id:'7',book:'VLB',bookNo:'BOOK-7',door:'V7',site:MAJRI,shift:'S1'}]]]);
 const all=punchRecheck({days,listed,masters:masters(),standing:counted}),{sites}=all,lines=all.lines.filter(line=>line.status==='toFix');
 // Every punched driver or operator has a line, so each figure of Step 1 drills down (owner, 24 Nov 2026).
 assert.deepEqual(all.lines.map(line=>[line.number,line.status]).sort(),[['4400','toFix'],['4401','counted'],['4402','toFix'],['4403','noCard']]);
 assert.deepEqual(all.lines.find(line=>line.number==='4401').countedCards.map(card=>card.bookNo),['BOOK-7']);
 assert.equal(all.lines.find(line=>line.number==='4401').shift,'S1');
 assert.equal(punchRecheck({days,listed,masters:masters(),standing:new Set(['4401|'+DATE])}).lines.find(line=>line.number==='4401').status,'counted','a Set of keys is read too');
 assert.deepEqual(sites,[{key:KEY,site:MAJRI,punched:4,counted:1,toFix:2,noCard:1,received:5,unknown:0,notDriver:1}],'the helper is left out; 4401 has a card that counts; 4403 has no card at all');
 assert.deepEqual(lines.map(line=>[line.number,line.ownCard,line.cards.map(card=>card.id),line.shift]),[['4402',true,['11','10'],'S2'],['4400',false,['10','11'],'—']]);
 assert.equal(lines[0].rowId,'3');assert.equal(lines[0].name,'DRIVER THREE');
 assert.equal(cardAction(lines[0],lines[0].cards[0]),'shift','own card with no shift: Save shift');
 assert.equal(cardAction(lines[1],lines[1].cards[1]),'other','another standing driver\'s card with no shift is not this person\'s');
 assert.equal(cardAction(lines[1],lines[1].cards[0]),'submit');
 assert.equal(punchRecheck({days,listed,masters:masters(),allowed:()=>false}).lines.length,0,'a site the login does not hold is not shown');
 // Punches received, before the driver filter: an ID in no employee list is counted at its site, or as on no site.
 const strange=punchRecheck({days:[{caliberCode:'777',date:DATE,site:MAJRI},{caliberCode:'778',date:DATE,site:''}],masters:masters()});
 assert.deepEqual([strange.sites[0].received,strange.sites[0].unknown,strange.sites[0].punched,strange.unplaced],[1,1,0,1]);
});

test('the screen adds the days up and draws Step 1 and Step 2',()=>{
 let held=emptyPunchRecheck();
 held=addPunchAnswer(held,{from:DATE,punches:5,machine:{error:'HR Pulse did not give the machine punches (x).'},sites:[{key:KEY,site:MAJRI,punched:4,counted:1,toFix:2,noCard:1}],lines:[{id:'a',date:DATE,shift:'S1',siteKey:KEY,site:MAJRI,ownCard:true},{id:'b',date:DATE,shift:'S1',siteKey:KEY,site:MAJRI,ownCard:false}]});
 held=addPunchAnswer(held,{from:DATE,punches:5,machine:{},sites:[{key:KEY,site:MAJRI,punched:4,counted:2,toFix:1,noCard:1}],lines:[{id:'a',date:DATE,shift:'S1',siteKey:KEY,site:MAJRI,ownCard:true}]});
 const rows=punchSiteRows(held);
 assert.deepEqual([rows.rows[0].toFix,rows.total.counted,held.machineErrors.length],[1,2,0],'a date read again replaces its answer');
 assert.deepEqual(punchSlotRows(held.lines).map(row=>[row.count,row.own]),[[1,1]]);
 const viewed={lines:[{siteKey:'a',status:'toFix'},{siteKey:'a',status:'noCard'},{siteKey:'b',status:'counted'}]};
 assert.deepEqual(PUNCH_VIEWS.map(one=>linesOfSite(viewed,'*',one.key).length),[3,1,1,1],'punched, counted, to fix, no card');
 assert.equal(linesOfSite(viewed,'a','noCard').length,1);
 assert.deepEqual(punchDefaultRange('2026-11-24'),{from:'2026-11-18',to:'2026-11-24'});
 assert.deepEqual(punchDefaultRange('2026-11-03'),{from:'2026-11-01',to:'2026-11-03'});
});

test('the server matches the machine and imported punches with the cards, and Submit from the line puts the person on the card',async()=>{
 const db=new PGlite();
 await db.exec(`CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);
  CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_no TEXT,book_type TEXT,book_date DATE,site TEXT,asset_id BIGINT,data JSONB,revision INTEGER DEFAULT 1,deleted_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE mis_vlb_batch_entries(batch_id TEXT,logbook_id BIGINT PRIMARY KEY,snapshot JSONB);
  CREATE TABLE mis_elb_batch_entries(batch_id TEXT,logbook_id BIGINT PRIMARY KEY,snapshot JSONB);
  CREATE TABLE mis_biometric_punches(caliber_code TEXT,punch_date DATE,in_time TEXT,out_time TEXT,site TEXT);`);
 await db.exec(CALIBER_RECHECK_SCHEMA);
 for(const row of masters())await db.query('INSERT INTO master_records(id,master_name,record_data) VALUES($1,$2,$3)',[row.id,row.master_name,JSON.stringify(row.record_data)]);
 const book=async(id,data)=>{const full={bookDate:DATE,location:MAJRI,assetId:String(50+id),door:'V9'+id,bookShiftCode:'S1',trips:[{equipmentName:'LPC01',tripCount:3}],openingKmr:100,closingKmr:140,...data};
  await db.query('INSERT INTO mis_log_books(id,book_no,book_type,book_date,site,asset_id,data,revision) VALUES($1,$2,$3,$4,$5,$6,$7,3)',[id,'BOOK-'+id,'vehicle',DATE,MAJRI,full.assetId,JSON.stringify(full)]);};
 await book(1,{employeeId:'2',caliberId:'CMPL4401',employeeName:'DRIVER TWO',aFormNo:'A-1'});
 await book(2,{employeeId:'',caliberId:'',employeeName:'',aFormNo:'A-2'});
 await book(3,{employeeId:'6',caliberId:'CMPL4404',employeeName:'DRIVER FIVE',aFormNo:'A-3',bookShiftCode:'',cardShift:'',shiftName:''});
 await db.query("INSERT INTO mis_biometric_punches VALUES('4400',$1,'06:00','14:00',$2)",[DATE,MAJRI]);
 const query=(sql,params)=>!params&&sql.includes(';')?db.exec(sql):db.query(sql,params);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());
 registerCaliberRecheck(app,{pool,requireSession:(req,res,next)=>{req.session={login:'majri.hr',name:'Majri HR',role:'super',permissions:{adminLevel:'User'}};next()},requireAdministrator:(req,res,next)=>next(),
  getSiteScope:async()=>({sites:null,label:'All sites'}),readMasters:async client=>client.query('SELECT id,master_name,record_data FROM master_records ORDER BY id'),
  hrPunches:async()=>({sites:[MAJRI],punches:[['CMLL4401','4401',DATE+' 06:02:00',0,'0'],['CMLL4404','4404',DATE+' 06:03:00',0,'0']]})});
 const server=app.listen(0),base='http://127.0.0.1:'+server.address().port;
 const call=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 try{
  // Trip cards view (owner, 24 Nov 2026): every card, its status and the bio-punch of the person on it.
  let cards=await call('/api/caliber-recheck/cards?from='+DATE+'&to='+DATE);
  assert.equal(cards.status,200,JSON.stringify(cards.body));
  assert.deepEqual(cards.body.lines.map(line=>[line.id,line.book,line.status,Boolean(line.punch)]),[['1','VLB','counted',true],['2','VLB','error',false],['3','VLB','error',true]]);
  assert.equal(cards.body.lines[1].error.reason,'no-driver');assert.equal(cards.body.lines[2].error.pickShift,true);
  const majri=cards.body.sites.find(site=>site.site===MAJRI);
  assert.deepEqual([majri.cards,majri.vlb,majri.counted,majri.error,majri.punch,majri.noPunch],[3,3,1,2,1,0]);
  assert.equal(cards.body.sites.length,8,'every site of the login');
  let day=await call('/api/caliber-recheck/punches?from='+DATE+'&to='+DATE);
  assert.equal(day.status,200);
  assert.equal(day.body.machine.connected,true);
  assert.deepEqual(day.body.machine.sites,[{site:MAJRI,days:2}],'the sites HR Pulse sent punches for');
  assert.equal(day.body.imported,1);
  // Every site of the login has a line (owner, 24 Nov 2026: "not able to see all sites"), by its own name; Majri first.
  assert.equal(day.body.sites.length,8);
  assert.deepEqual(day.body.sites.map(site=>site.site).sort(),['Dhoptala OC (2nd)','Dudhichua East OC','Dudhichua OC','Gauri Pauni OC (2nd)','Jayant OC','Lalpeth OC','Majri OC','Sasti OC']);
  assert.deepEqual(day.body.sites.slice(0,2).map(site=>[site.site,site.punched,site.counted,site.toFix,site.noCard]),[['Majri OC',3,1,2,0],['Dhoptala OC (2nd)',0,0,0,0]]);
  const byNumber=Object.fromEntries(day.body.lines.filter(line=>line.status==='toFix').map(line=>[line.number,line]));
  assert.deepEqual(day.body.lines.find(line=>line.number==='4401').countedCards.map(card=>card.bookNo),['BOOK-1']);
  assert.deepEqual(byNumber['4404'].cards.map(card=>[card.id,card.own,card.reason]),[['3',true,'no-shift'],['2',false,'no-driver']]);
  assert.deepEqual(byNumber['4400'].cards.map(card=>card.id),['2','3']);
  assert.equal(byNumber['4400'].source,'imported');
  // Submit on the line of 4400: the card with no driver takes DRIVER ONE, and the line leaves the list.
  const put=await call('/api/caliber-recheck/pick',{logbookId:'2',employeeId:byNumber['4400'].rowId});
  assert.equal(put.status,201,JSON.stringify(put.body));
  // Save shift on the own card of 4404.
  assert.equal((await call('/api/caliber-recheck/shift',{logbookId:'3',shift:'D'})).status,200);
  day=await call('/api/caliber-recheck/punches?from='+DATE+'&to='+DATE);
  assert.deepEqual(day.body.lines.filter(line=>line.status==='toFix'),[]);
  cards=await call('/api/caliber-recheck/cards?from='+DATE+'&to='+DATE);
  assert.deepEqual(cards.body.lines.map(line=>line.status),['counted','counted','counted'],'put right, the cards mark attendance');
  // Any card may take another driver on the Trip cards view (owner, 24 Nov 2026: "correction section not showing"):
  // Caliber ID Re-check still changes only a listed card; the Trip cards view says anyCard, and the change is recorded.
  assert.equal((await call('/api/caliber-recheck/pick',{logbookId:'1',employeeId:'1'})).status,409,'a card whose driver stands is not changed without anyCard');
  const changed=await call('/api/caliber-recheck/pick',{logbookId:'1',employeeId:'1',anyCard:true});
  assert.equal(changed.status,201,JSON.stringify(changed.body));
  assert.equal(changed.body.correction.to,'CMPL4400');
  const record=await call('/api/caliber-recheck/record');
  assert.equal(record.body.corrections.find(row=>row.bookNo==='BOOK-1').reason,'Changed on Trip cards (driver stood)');
  assert.deepEqual(day.body.lines.map(line=>line.status),['counted','counted','counted']);
  assert.deepEqual([day.body.sites[0].punched,day.body.sites[0].counted,day.body.sites[0].toFix],[3,3,0]);
 }finally{server.close();await db.close();}
});

test('the page sits under Caliber ID Re-check, for the same people',()=>{
 const login=pages=>({permissions:{separateMisCredentials:true,misDesktopAccess:pages,misMobileAccess:[]}});
 assert.equal(misPageAllowed(login(['Employee master']),'Caliber Punch Re-check','desktop'),true);
 assert.equal(misPageAllowed(login(['Trip Card Bulk Scan']),'Caliber Punch Re-check','desktop'),true);
 assert.equal(misPageAllowed(login(['Reports']),'Caliber Punch Re-check','desktop'),false);
 assert.equal(misRequestAllowed(login(['Employee master']),{path:'/api/caliber-recheck/punches',method:'GET'}),true);
 assert.equal(misRequestAllowed(login(['Employee master']),{path:'/api/caliber-recheck/punches',method:'POST'}),false);
 assert.equal(requestedMisPage('?page=caliber-punch-recheck'),'Caliber Punch Re-check');
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/'Caliber ID Re-check','Caliber Punch Re-check','Machine Category Re-check','Equipment master'/);
 assert.ok(main.includes("renderedActive==='Caliber Punch Re-check' ? (<CaliberPunchRecheck session={session} ReportSection={ReportSection}/>)"));
 assert.ok(main.includes("if(name==='Caliber Punch Re-check')return canOpenAdminPage('Caliber ID Re-check');"));
});

test('the trip cards view counts each site by book, attendance, error and bio-punch, and each figure opens its cards',()=>{
 const card=(id,book,status,number,more={})=>({id,book,bookNo:'B'+id,door:'D'+id,date:DATE,shift:'S1',siteKey:KEY,site:MAJRI,number,savedId:number?'CMPL'+number:'',savedName:'',status,...more});
 const cards=[card('1','VLB','counted','4400'),card('2','ELB','counted','4401'),card('3','LMV','error','4402'),card('4','VLB','idle','')];
 const {lines,sites}=cardRecheck({cards,days:[{caliberCode:'CMLL4400',date:DATE,inTime:'06:00',site:MAJRI,source:'machine'}],cardSites:[{key:'x',site:'Gauri Pauni OC (2nd)'}]});
 assert.deepEqual(sites.map(site=>[site.site,site.cards,site.vlb,site.elb,site.lmv,site.counted,site.error,site.idle,site.punch,site.noPunch]),[[MAJRI,4,2,1,1,2,1,1,1,1],['Gauri Pauni OC (2nd)',0,0,0,0,0,0,0,0,0]]);
 assert.deepEqual(lines.find(line=>line.id==='1').punch,{inTime:'06:00',outTime:'',site:MAJRI,source:'machine'});
 assert.deepEqual(CARD_VIEWS.map(view=>cardsOfView(lines,view.key).map(line=>line.id).join('')),['2314','14','2','3','21','3','1','2','4']);
});
