// Site Sheet vs Trip Card (owner, 23 Nov 2026): the site's hand-kept attendance Excel, saved per login, against Pulse-II
// trip cards, date by shift, both ways; then department-wise, designation-wise or category-wise; then the people and one
// person day by day. Nothing is downloaded. Every ID and name is made up.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {parseAttendanceSheet,checkAttendanceSheet} from '../shared/attendance-sheet-check.mjs';
import {UNKNOWN_SHIFT,DAY_KINDS,GROUP_BYS,NOT_GIVEN,sheetDayLines,dayShiftRows,kindTotals,personDays,shiftName,nearestShift,groupLines,groupKey,inGroup,savedSheetFrom,sheetMonth} from '../shared/site-sheet-days.mjs';
import {openSiteSheet,saveSiteSheet} from '../src/site-sheet-run.mjs';
import {registerSiteSheets,SITE_SHEETS_SCHEMA} from '../server/routes/site-sheets.mjs';
import {buildAFormPeople} from '../shared/a-form-people.mjs';
import {sheetPeopleAnswer} from '../server/routes/attendance-sheet-check.mjs';
import {misRequestAllowed} from '../shared/mis-application-access.mjs';
import {operationReports} from '../src/operations-report-model.mjs';

const day=n=>new Date(Date.UTC(2026,10,n));
const iso=n=>'2026-11-'+String(n).padStart(2,'0');
const SHEET=[
 ['SITE ATTENDANCE NOV 2026'],
 ['SR NO','EMP. ID','NAME','DESIGNATION',day(1),day(2),day(3),'Present Total'],
 [1,'CMPL902001','RAM DRIVER','TIPPER DRIVER','P','A','P',2],
 [2,'CMPL902002','SHYAM DRIVER','TIPPER DRIVER','P','P','P',3],
 [3,'CMPL902003','HARI HELPER','TIPPER HELPER','P','P','P',3],
 [4,'CMPL902004','GOPAL DRIVER','DOZER OPERATOR',null,'PL','-',0],
];
const SITE='Sasti OC',KEY='sasti ob';
const master=(number,name,o={})=>({number:String(number),found:true,name,designation:'',department:'MINING',category:'SKILLED',siteLabel:SITE,atSite:true,working:true,left:false,...o});
const PEOPLE=[master(902001,'RAM DRIVER',{designation:'DRIVER (TIPPER)'}),master(902002,'SHYAM DRIVER',{designation:'TIPPER-DRIVER'}),master(902003,'HARI HELPER'),
 master(902004,'GOPAL DRIVER',{designation:'DOZER OPERATOR',department:'',category:'SEMI SKILLED'})];
const duty=(number,n,shift,o={})=>({date:iso(n),shift,site:SITE,siteKey:KEY,caliberCode:'CMLL'+number,employeeId:'E'+number,employeeName:'N'+number,books:'TC'+number+'-'+n,doors:'V'+number%10,...o});
const LINES=[
 duty(902001,1,'S1'),duty(902001,2,'S2'),                                   // 2 Nov: A in the sheet, a card in Shift B; 3 Nov: P, no card
 duty(902002,1,'S3'),duty(902002,2,'S1',{site:'Majri OC',siteKey:'majri ob'}),duty(902002,3,'S3'), // 2 Nov: the card is at Majri
 duty(902004,1,'S1'),duty(902004,2,'S3'),                                   // blank and PL in the sheet, cards in Shift A and C
];
const LOCKED=[1,2,3].map(n=>KEY+'|'+iso(n)).concat('majri ob|'+iso(2));
const result=()=>checkAttendanceSheet({sheet:parseAttendanceSheet(SHEET),site:SITE,lines:LINES,lockedDays:LOCKED,people:PEOPLE,sitePeople:[],today:iso(23)});

test('each person-day is a line of one way, on the shift of its card; the sheet has no shift for a P without a card',()=>{
 const lines=sheetDayLines(result());
 assert.deepEqual(lines.map(l=>[l.id,l.date,l.kind,l.shift,l.sheetSays]),[
  ['CMPL902004',iso(1),'card','A','(blank)'],
  ['CMPL902002',iso(2),'away','A','P'],
  ['CMPL902001',iso(2),'card','B','A'],
  ['CMPL902004',iso(2),'card','C','PL'],
  ['CMPL902001',iso(3),'noCard',UNKNOWN_SHIFT,'P'],
 ],'date, then shift; the helper with no card is not judged');
 const missing=lines.find(l=>l.kind==='noCard');
 assert.equal(missing.nearest,'Shift B on 02-11','the nearest worked shift is a hint, not a shift');
 assert.equal(nearestShift([{date:iso(1),shifts:['A']},{date:iso(2),shifts:['B','C']},{date:iso(9),shifts:['C']}],iso(5)),'Shift B + Shift C on 02-11 · Shift C on 09-11','the date before and the date after');
 assert.match(missing.correction,/Save the missing card or zero-trip entry, or correct the sheet to A/);
 const blue=lines.find(l=>l.id==='CMPL902001'&&l.kind==='card');
 assert.deepEqual([blue.books,blue.equipment,blue.pulseSays],['TC902001-2','V1','Duty in Shift B on V1']);
 assert.deepEqual([blue.designation,blue.department,blue.category],['DRIVER (TIPPER)','MINING','SKILLED'],"HR Pulse's designation, department and category");
 const away=lines.find(l=>l.kind==='away');
 assert.deepEqual([away.site,away.pulseSays],['Majri OC','Duty at Majri OC in Shift A']);
 assert.equal(shiftName(UNKNOWN_SHIFT),'Shift not in sheet');
 assert.equal(nearestShift([],iso(3)),'No duty at this site on any compared date');
});

test('the date by shift boxes count each way, and the totals count people-days and people',()=>{
 const lines=sheetDayLines(result());
 assert.deepEqual(dayShiftRows(lines).map(r=>[r.date,r.shift,r.total,r.card,r.noCard,r.away]),[
  [iso(1),'A',1,1,0,0],[iso(2),'A',1,0,0,1],[iso(2),'B',1,1,0,0],[iso(2),'C',1,1,0,0],[iso(3),UNKNOWN_SHIFT,1,0,1,0]]);
 assert.deepEqual(kindTotals(lines),{card:{lines:3,people:2},noCard:{lines:1,people:1},away:{lines:1,people:1}});
 assert.deepEqual(DAY_KINDS.map(k=>k.label),['Trip card present, sheet not P','Sheet P, no trip card','Sheet P, trip card at another site']);
});

test('department-wise, designation-wise and category-wise: one job written several ways is one line',()=>{
 const lines=sheetDayLines(result());
 assert.deepEqual(GROUP_BYS.map(g=>g.label),['Department-wise','Designation-wise','Category-wise']);
 for(const [a,b] of [['TIPPER DRIVER','DRIVER (TIPPER)'],['TIPPER-DRIVER','tipper  driver'],['EICHER DRIVER','DRIVER EICHER']])assert.equal(groupKey(a),groupKey(b),a+' = '+b);
 assert.notEqual(groupKey('PC OPERATOR'),groupKey('PC- OPRATOR'),'a misspelling stays its own line, for HR to correct');
 const designations=groupLines(lines,'designation');
 assert.deepEqual(designations.map(g=>[g.label,g.spellings,g.total,g.card,g.noCard,g.away,g.people]),[
  ['DRIVER (TIPPER)',['DRIVER (TIPPER)','TIPPER-DRIVER'],3,1,1,1,2],
  ['DOZER OPERATOR',['DOZER OPERATOR'],2,2,0,0,1]]);
 assert.deepEqual(groupLines(lines,'department').map(g=>[g.label,g.total,g.cardPeople,g.noCardPeople]),[['MINING',3,1,1],[NOT_GIVEN,2,1,0]],'an empty department is said, not hidden');
 assert.deepEqual(groupLines(lines,'category').map(g=>[g.label,g.total]),[['SKILLED',3],['SEMI SKILLED',2]]);
 const key=designations[0].key;
 assert.deepEqual(lines.filter(l=>inGroup(l,'designation',key)).map(l=>l.id),['CMPL902002','CMPL902001','CMPL902001']);
});

test('one person day by day: the mark beside Pulse-II for every date of the sheet',()=>{
 const r=result(),of=id=>r.rows.find(x=>x.id===id);
 assert.deepEqual(personDays(of('CMPL902001')).map(d=>[d.date,d.sheetSays,d.pulseSays,d.result]),[
  [iso(1),'P','Duty in Shift A','Same in both'],[iso(2),'A','Duty in Shift B','Trip card present, sheet not P'],[iso(3),'P','No duty','Sheet P, no trip card']]);
 assert.deepEqual(personDays(of('CMPL902003')).map(d=>d.result),['Not judged: not a driver or operator','Not judged: not a driver or operator','Not judged: not a driver or operator']);
 assert.deepEqual(personDays(of('CMPL902002')).map(d=>d.pulseSays),['Duty in Shift C','Duty at Majri OC','Duty in Shift C']);
});

test('only the lines and marks of the sheet are kept, and a sheet that is not right is refused',()=>{
 const parsed=parseAttendanceSheet(SHEET),kept=savedSheetFrom(parsed);
 assert.deepEqual(Object.keys(kept),['sheetName','headerRow','dates','filledDates','missingDates','noId','people']);
 assert.deepEqual(kept.people[0],{row:3,sr:'1',id:'CMPL902001',number:'902001',name:'RAM DRIVER',designation:'TIPPER DRIVER',marks:['P','A','P']});
 assert.equal(sheetMonth(kept),'2026-11');
 assert.throws(()=>savedSheetFrom({...parsed,dates:['1 Nov']}),/no date columns/);
 assert.throws(()=>savedSheetFrom({...parsed,people:[{...parsed.people[0],marks:['P']}]}),/one mark per date/);
 assert.throws(()=>savedSheetFrom({...parsed,people:[]}),/no employee line/);
 assert.throws(()=>savedSheetFrom({...parsed,people:Array.from({length:5001},()=>parsed.people[0])}),/up to 5000/);
});

// A database that answers the four statements of server/routes/site-sheets.mjs.
function fakePool(){
 const rows=[];let next=1;
 return {rows,async query(sql,params=[]){
  if(sql===SITE_SHEETS_SCHEMA)return {rows:[]};
  if(/^SELECT .*FROM mis_site_attendance_sheets WHERE \(\$1::boolean/s.test(sql))return {rows:rows.filter(r=>params[0]||r.saved_by===params[1]).map(({sheet,...r})=>r)};
  if(/^SELECT .*WHERE id=\$1/s.test(sql))return {rows:rows.filter(r=>r.id===String(params[0]))};
  if(/^INSERT INTO mis_site_attendance_sheets/.test(sql)){
   const [site,site_key,month,first_date,last_date,file_name,sheet_name,people,sheet,saved_by,saved_name]=params;
   let row=rows.find(r=>r.saved_by===saved_by&&r.site_key===site_key&&r.month===month);
   if(!row){row={id:String(next++)};rows.push(row);}
   Object.assign(row,{site,site_key,month,first_date,last_date,file_name,sheet_name,people,sheet:JSON.parse(sheet),saved_by,saved_name,saved_at:new Date('2026-11-23T15:00:00Z')});
   return {rows:[{id:row.id}]};
  }
  if(/^DELETE FROM mis_site_attendance_sheets/.test(sql)){rows.splice(rows.findIndex(r=>r.id===String(params[0])),1);return {rows:[]};}
  throw Error('unexpected '+sql);
 }};
}
function fakeApp(){
 const routes=new Map();
 const add=method=>(path,...handlers)=>routes.set(method+' '+path,handlers);
 const call=async(key,req)=>{
  const res={code:200,headers:{},body:null,status(code){this.code=code;return this;},set(name,value){this.headers[name]=value;return this;},json(body){this.body=body;return this;}};
  for(const handler of routes.get(key)){let went=false;await handler({params:{},query:{},...req},res,error=>{if(error)throw error;went=true;});if(!went)break;}
  return res;
 };
 return {get:add('GET'),post:add('POST'),delete:add('DELETE'),call,routes};
}
test('a sheet is saved per login, replaced for the same site and month, and an MIS administrator sees every sheet',async()=>{
 const app=fakeApp(),pool=fakePool();
 registerSiteSheets(app,{pool,protect:[(req,res,next)=>next()]});
 assert.deepEqual([...app.routes.keys()],['GET /api/reports/manpower/site-sheets','GET /api/reports/manpower/site-sheets/:id','POST /api/reports/manpower/site-sheets','DELETE /api/reports/manpower/site-sheets/:id']);
 const sasti={sites:['sasti ob'],label:'Sasti OC'},every={sites:null};
 const siteLogin={session:{login:'sasti.mis',name:'Sasti MIS',role:'site',permissions:{}},logBookScope:sasti};
 const other={session:{login:'majri.mis',name:'Majri MIS',role:'site',permissions:{}},logBookScope:every};
 const admin={session:{login:'owner',name:'Owner',role:'super',permissions:{adminLevel:'super admin'}},logBookScope:every};
 const sheet=savedSheetFrom(parseAttendanceSheet(SHEET));
 const saveAs=(who,body)=>app.call('POST /api/reports/manpower/site-sheets',{...who,body});
 const first=await saveAs(siteLogin,{site:'Sasti OC',fileName:'sasti.xlsx',sheet});
 assert.deepEqual([first.code,first.body],[200,{id:'1',site:'Sasti OC',month:'2026-11'}]);
 assert.equal((await saveAs(siteLogin,{site:'Sasti OC',fileName:'sasti again.xlsx',sheet})).body.id,'1','the same login, site and month replaces the older sheet');
 assert.equal(pool.rows.length,1);assert.equal(pool.rows[0].file_name,'sasti again.xlsx');
 assert.equal((await saveAs(siteLogin,{site:'Majri OC',sheet})).code,403,'a site the login does not hold');
 assert.equal((await saveAs(siteLogin,{site:'Nowhere',sheet})).code,400);
 assert.deepEqual([(await saveAs(siteLogin,{site:'Sasti OC',sheet:{...sheet,people:[]}})).code],[400]);
 const list=async who=>(await app.call('GET /api/reports/manpower/site-sheets',who)).body;
 assert.deepEqual((await list(siteLogin)).sheets.map(s=>[s.id,s.site,s.month,s.firstDate,s.lastDate,s.people,s.savedName]),[['1','Sasti OC','2026-11',iso(1),iso(3),4,'Sasti MIS']]);
 assert.deepEqual((await list(other)).sheets,[],'another login does not see it');
 assert.deepEqual([(await list(admin)).admin,(await list(admin)).sheets.length],[true,1],'an MIS administrator sees every sheet');
 const one=async(who,id='1')=>app.call('GET /api/reports/manpower/site-sheets/:id',{...who,params:{id}});
 assert.deepEqual([(await one(siteLogin)).body.sheet.people.length,(await one(admin)).code,(await one(other)).code,(await one(siteLogin,'x')).code],[4,200,404,404]);
 assert.equal((await app.call('DELETE /api/reports/manpower/site-sheets/:id',{...other,params:{id:'1'}})).code,404,'another login cannot delete it');
 assert.equal((await app.call('DELETE /api/reports/manpower/site-sheets/:id',{...siteLogin,params:{id:'1'}})).body.deleted,'1');
 assert.equal(pool.rows.length,0);
 for(const [path,method] of [['/api/reports/manpower/site-sheets','GET'],['/api/reports/manpower/site-sheets','POST'],['/api/reports/manpower/site-sheets/1','DELETE']]){
  const login=allowed=>({permissions:{separateMisCredentials:true,misDesktopAccess:allowed,misMobileAccess:[]}});
  assert.equal(misRequestAllowed(login(['Reports']),{path,method}),true,method+' '+path);
  assert.equal(misRequestAllowed(login(['Dashboard']),{path,method}),false,method+' '+path);
 }
});

test('opening a saved sheet reads Pulse-II once for its dates, with no Excel',async()=>{
 const calls=[];
 const kept=savedSheetFrom(parseAttendanceSheet(SHEET));
 const read=async(url,session,options)=>{calls.push([url,session.token,options?.method||'GET']);
  if(url.endsWith('/site-sheets/7'))return {id:'7',site:SITE,month:'2026-11',sheet:kept,savedName:'Sasti MIS'};
  return url.includes('/people')?{site:SITE,people:PEOPLE,sitePeople:[]}:{otDuties:LINES,attendanceEquipment:[],lockedDays:LOCKED};};
 const done=await openSiteSheet({id:'7',session:{token:'T'},today:iso(23),read});
 assert.deepEqual(calls,[['/api/reports/manpower/site-sheets/7','T','GET'],['/api/reports/manpower/attendance?from=2026-11-01&to=2026-11-03&view=attendance','T','GET'],['/api/reports/manpower/attendance-sheet/people','T','POST']]);
 assert.deepEqual([done.lines.length,done.result.counts.duty,'blob' in done],[5,3,false]);
 const sent=[];
 await saveSiteSheet({sheet:parseAttendanceSheet(SHEET),fileName:'s.xlsx',site:SITE,session:{token:'T'},read:async(url,session,options)=>{sent.push(JSON.parse(options.body));return {id:'1'};}});
 assert.deepEqual(Object.keys(sent[0]),['site','fileName','sheet']);assert.equal(sent[0].sheet.people.length,4);
});

test("HR Pulse's department and category reach the sheet's people",()=>{
 const index=buildAFormPeople([{id:1,master_name:'Employee master',record_data:{caliberId:'CMPL902001',employeeId:'CMPL902001',name:'RAM DRIVER',site:SITE,currentLocation:SITE,
  currentDesignationName:'DRIVER (TIPPER)',currentDepartmentName:'MINING',hrCategory:'SKILLED',hrListed:true}}]);
 const [one]=sheetPeopleAnswer(index,SITE,['902001']).people;
 assert.deepEqual([one.designation,one.department,one.category],['DRIVER (TIPPER)','MINING','SKILLED']);
});

test('the tab sits beside Attendance Sheet Mismatch, saves the sheet and downloads nothing',()=>{
 const ids=operationReports.map(r=>r.id);
 assert.deepEqual(operationReports.find(r=>r.id==='attendance-site-sheet'),{id:'attendance-site-sheet',title:'Site Sheet vs Trip Card',group:'Manpower & OT'});
 assert.equal(ids.indexOf('attendance-site-sheet'),ids.indexOf('attendance-sheet')+1);
 const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
 const screen=read('../src/manpower-reports.jsx');
 assert.match(screen,/siteSheet\?<SiteSheetTripCard session=\{session\} ReportSection=\{ReportSection\}\/>:<AttendanceSheetCheck session=\{session\}\/>/);
 const page=read('../src/site-sheet-trip-card.jsx');
 assert.match(page,/accept="\.xlsx,\.xlsm,\.xlk"/);assert.match(page,/Save the sheet/);assert.match(page,/nothing is downloaded/);
 assert.doesNotMatch(page,/downloadBlob/,'no Excel is downloaded');
 for(const step of ["title=\"Step 1 · Saved site sheets\"","'Step 2 · '","'Step 3 · '","'Step 4 · '","'Step 5 · '"])assert.ok(page.includes(step),step);
 assert.match(page,/<DateShiftGrid /);
 assert.match(read('../server/routes/log-book.mjs'),/registerSiteSheets\(app,\{pool,protect\}\);/);
});
