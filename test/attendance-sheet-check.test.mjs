// Attendance Sheet Mismatch (owner, 23 Nov 2026): the attendance Excel a site keeps by hand against Pulse-II, the
// corrections given back as an Excel with a colour for each kind of mismatch and the colour key at the top.
// Every ID and name here is made up.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {parseAttendanceSheet,checkAttendanceSheet,attendanceSheetWorkbook,sheetReadRange,sameName,nameDifference,markKind,headingDate,lineNumber,SHEET_FILLS,SHEET_LEGEND,CORRECTION_KINDS} from '../shared/attendance-sheet-check.mjs';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
import {buildAFormPeople} from '../shared/a-form-people.mjs';
import {registerAttendanceSheetCheck,sheetPeopleAnswer} from '../server/routes/attendance-sheet-check.mjs';
import {readAttendanceFile,runSheetCheck} from '../src/attendance-sheet-run.mjs';
import {misRequestAllowed} from '../shared/mis-application-access.mjs';
import {operationReports} from '../src/operations-report-model.mjs';

const day=n=>new Date(Date.UTC(2026,10,n));
const iso=n=>'2026-11-'+String(n).padStart(2,'0');
// The site's sheet: a title line, the headings, then one line per employee. 4 Nov has no column.
const HEAD=['SR NO','EMP. ID','NAME','DESIGNATION',day(1),day(2),day(3),day(5),day(6),'Present Total','PL'];
const line=(sr,id,name,designation,...marks)=>[sr,id,name,designation,...marks,null,null];
const SHEET=[
 ['SITE ATTENDANCE NOV 2026'],
 HEAD,
 line(1,'CMPL901001','RAM KUMAR','TIPPER DRIVER','P','P','P','P',null),
 line(2,'CMPL901002','SHYAM LAL','TIPPER DRIVER','P','A','P','A',null),
 line(3,'CMPL 901003','MD ARIF / RAHIM','PC OPERATOR','p','P','PL','-',null),
 line(4,'CMPL901004','MOHAN DAS','TIPPER HELPER','P','P','P','P',null),
 line(5,'CMPL901005','OLD NAME','DOZER OPERATOR','P','P','P','P',null),
 line(6,'CMPL901006','GONE MAN','TIPPER DRIVER','P','P','A','A',null),
 line(7,'CMPL901007','FAR MAN','TIPPER DRIVER','P','P','P','P',null),
 line(8,'CMPL909999','NOBODY','TIPPER DRIVER','P','P','P','P',null),
 line(9,'TRAINEE','NEW BOY','TIPPER DRIVER','P','P','P','P',null),
 line(10,'CMPL901010','TWICE MAN','TIPPER DRIVER','A','A','A','A',null),
 line(11,'CMPL901010','TWICE MAN','TIPPER DRIVER','A','A','A','A',null),
 line(12,'CMPL901012','ODD MARK','TIPPER DRIVER','P','XX',null,'P',null),
 line(13,'CMPL901013','NEVER SCANNED','VOLVO DRIVER','P','P','P','A',null),
 [null,null,null,null,null,null,null,null,null,null,null],
 line(14,null,'NO ID MAN','TIPPER DRIVER','P','P','P','P',null),
];
const SITE='Sasti OC',KEY='sasti ob';
const master=(number,name,o={})=>({number:String(number),found:true,name,designation:'',siteLabel:SITE,atSite:true,working:true,left:false,...o});
const PEOPLE=[master(901001,'Ram Kumar'),master(901002,'SHYAM LAL'),master(901003,'MOHAMMAD ARIF'),master(901004,'MOHAN DASS'),master(901005,'NEW NAME'),
 master(901006,'GONE MAN',{working:false,left:true,atSite:false,siteLabel:''}),master(901007,'FAR MAN KHAN',{atSite:false,siteLabel:'Majri OC'}),
 {number:'909999',found:false,name:'',designation:'',siteLabel:'',atSite:false,working:false,left:false},
 master(901010,'TWICE MAN'),master(901012,'ODD MARK'),master(901013,'NEVER SCANNED')];
const duty=(number,n,o={})=>({date:iso(n),shift:'S1',site:SITE,siteKey:KEY,caliberCode:'CMLL'+number,employeeId:'E'+number,employeeName:'N'+number,books:'TC'+number+'-'+n,doors:'V1',...o});
const LINES=[
 duty(901001,1),duty(901001,2),duty(901001,3),duty(901001,5),
 duty(901002,1),duty(901002,2,{shift:'S3'}),duty(901002,3),               // 2 Nov: A in the sheet, a duty in Pulse-II
 duty(901003,1),duty(901003,2),duty(901003,3),                             // 3 Nov: PL in the sheet, a duty in Pulse-II
 duty(901004,2),                                                           // a helper: only the day with a duty is judged
 duty(901005,1),duty(901005,2),duty(901005,3),                             // 5 Nov: P in the sheet, no duty
 duty(901007,1),duty(901007,2),duty(901007,3,{site:'Majri OC',siteKey:'majri ob'}),duty(901007,5),
 duty(901012,1),duty(901012,5),
 duty(908888,2,{employeeName:'EXTRA DRIVER'}),duty(908888,4,{employeeName:'EXTRA DRIVER'}),
 duty(901001,6),                                                           // 6 Nov is not locked: not compared
];
const LOCKED=[1,2,3,4,5].map(n=>KEY+'|'+iso(n)).concat('majri ob|'+iso(3));
const check=(over={})=>checkAttendanceSheet({sheet:parseAttendanceSheet(SHEET),site:SITE,lines:LINES,lockedDays:LOCKED,people:PEOPLE,sitePeople:[{number:'901001',name:'RAM KUMAR',designation:'TIPPER DRIVER'},{number:'907777',name:'LISTED ONLY',designation:'TIPPER HELPER'}],today:iso(23),...over});

test('the sheet is read under its title line: IDs, names, dates as Excel dates, day numbers or written dates',()=>{
 const sheet=parseAttendanceSheet(SHEET);
 assert.equal(sheet.headerRow,2);
 assert.deepEqual(sheet.dates,[1,2,3,5,6].map(iso));
 assert.deepEqual(sheet.filledDates,[1,2,3,5].map(iso),'6 Nov has no mark on any line');
 assert.deepEqual(sheet.missingDates,[iso(4)],'the sheet has no column for 4 Nov');
 assert.equal(sheet.people.length,13);
 assert.deepEqual(sheet.people[0],{row:3,sr:'1',id:'CMPL901001',number:'901001',name:'RAM KUMAR',designation:'TIPPER DRIVER',marks:['P','P','P','P','']});
 assert.equal(sheet.people[2].number,'901003','a space inside the ID does not matter');
 assert.equal(sheet.people.find(p=>p.id==='TRAINEE').number,'','an ID that is no Caliber ID is kept and named');
 assert.deepEqual(sheet.noId,[{row:17,name:'NO ID MAN'}]);
 // An Excel day number (a date cell in a format the reader does not know) and a written date are dates too.
 assert.equal(headingDate(46327),'2026-11-01');assert.equal(headingDate('02-11-2026'),'2026-11-02');assert.equal(headingDate('3-Nov-26'),'2026-11-03');
 assert.equal(headingDate(7),'');assert.equal(headingDate('Present Total'),'');
 const other=parseAttendanceSheet([['Employee Code','Employee Name',46327,'02/11/2026'],['901001','A','P','A']]);
 assert.deepEqual([other.dates,other.people[0].number,other.people[0].marks],[[iso(1),iso(2)],'901001',['P','A']]);
});

test('a sheet that is not an attendance sheet is refused with the reason',()=>{
 assert.throws(()=>parseAttendanceSheet([['S.No','No of Total Employees'],[1,1163]]),/no EMP\. ID column with a date column/);
 const numbered=[['SL NO','Emp ID','Name',...Array.from({length:31},(_,i)=>i+1)],[1,'CMPL901001','A','P']];
 assert.throws(()=>parseAttendanceSheet(numbered),/only day numbers.*full date \(01-11-2026\)/);
 assert.throws(()=>parseAttendanceSheet([HEAD]),/No employee line/);
});

test('marks: P in any case is present, A absent, PL and the like leave, "-" not on the roll',()=>{
 for(const [mark,kind] of [['P','present'],['p','present'],['P1','present'],[' P ','present'],['A','absent'],['a','absent'],['PL','leave'],['WO','leave'],['-','none'],['','blank'],[null,'blank'],['XX','unknown'],['P4X','unknown']])assert.equal(markKind(mark),kind,String(mark));
});

test('the same name written two ways is not a name mismatch; another name is',()=>{
 for(const [a,b] of [['RAM KUMAR','Ram  Kumar'],['RAM KUMAR','KUMAR RAM'],['RAMKUMAR','RAM KUMAR'],['MD ARIF / RAHIM','MOHAMMAD ARIF'],['SURESH KU PATEL','SURESH KUMAR PATEL'],['A. K. SINGH','AK SINGH'],['RAVI S/O MOHAN','RAVI']])assert.equal(sameName(a,b),true,a+' = '+b);
 for(const [a,b] of [['OLD NAME','NEW NAME'],['RAM KUMAR','RAM KUMAR YADAV'],['RAM','SHYAM'],['RAM','']])assert.equal(sameName(a,b),false,a+' / '+b);
});

// Owner, 23 Nov 2026 ("Yes, group them"): a site's first sheet gave 299 name mismatches, about 257 of them the same person
// written differently. The sheet keeps one colour; the lists say which kind, so the ones that matter are found at once.
test('a name mismatch is named by kind: spelling, fuller name, or another name',()=>{
 for(const [a,b] of [['RAM KUMAR','Ram  Kumar'],['MD ARIF / RAHIM','MOHAMMAD ARIF']])assert.equal(nameDifference(a,b),'',a+' = '+b);
 // The same words a letter or two apart, a missing space with a letter, or an initial for a word.
 for(const [a,b] of [['AKSHAY VITTHAL MULE','AKSHAY VITHAL MULE'],['DINESH PRAJAPATI','DINESH PRAJAPATHI'],['RAMKUMAR SAHU','RAM KUMAAR SAHU'],['A K SINGH','ANIL KUMAR SINGH'],['MOHAN DAS','MOHAN DASS'],['RAM LAL','RAJ LAL']])
  assert.equal(nameDifference(a,b),'spelling',a+' / '+b);
 // One side has a surname or a father's name more; the rest pair up, a letter apart allowed.
 for(const [a,b] of [['RAM KUMAR','RAM KUMAR YADAV'],['RAM KUMAR YADAV','RAM KUMAR'],['SANTOSH','SANTOSH KUMAR SAKET'],['RAKESH THAMKE','RAKESH MAROTI THAMAKE'],['FAR MAN','FAR MAN KHAN / OLD MAN KHAN']])
  assert.equal(nameDifference(a,b),'fuller',a+' / '+b);
 // Another name: the EMP. ID may belong to someone else.
 for(const [a,b] of [['OLD NAME','NEW NAME'],['RAM','SHYAM'],['RAM KUMAR','SHYAM KUMAR'],['ALI KHAN','ANIL KHAN'],['RAM KUMAR YADAV','SURESH PATEL'],['RAM KUMAR','RAM SINGH YADAV']])
  assert.equal(nameDifference(a,b),'other',a+' / '+b);
 assert.deepEqual(Object.keys(CORRECTION_KINDS).filter(kind=>kind.startsWith('name-')),['name-other','name-fuller','name-spelling'],'the one that matters comes first in every list');
});

test('a Pulse-II duty belongs to its Employee ID when written as an ID, else to its Caliber ID',()=>{
 assert.equal(lineNumber({caliberCode:'CMLL77',employeeId:'CMPL901003'}),'901003','the sheet writes the Employee ID');
 assert.equal(lineNumber({caliberCode:'CMLL901001',employeeId:'55'}),'901001');
 assert.equal(lineNumber({caliberCode:'',employeeId:'cmll 901002'}),'901002');
 assert.equal(lineNumber({caliberCode:'',employeeId:'55'}),'','a bare code could be another person');
});

test('each kind of mismatch is found, with the correction required',()=>{
 const result=check(),of=id=>result.rows.find(r=>r.id===id),cells=id=>of(id).cells.map(c=>c.state);
 // Same person, same marks: nothing.
 assert.deepEqual([of('CMPL901001').idIssue,of('CMPL901001').nameDiffers,cells('CMPL901001'),of('CMPL901001').corrections],['',false,['','','',''],0]);
 assert.deepEqual([of('CMPL901001').sheetP,of('CMPL901001').pulseP,of('CMPL901001').difference],[4,4,0]);
 // A in the sheet, a duty in Pulse-II.
 assert.deepEqual(cells('CMPL901002'),['','duty','','']);
 const duty=result.corrections.find(c=>c.kind==='duty'&&c.id==='CMPL901002');
 assert.deepEqual([duty.date,duty.sheetSays,duty.pulseSays,duty.books],[iso(2),'A','Duty in Shift C on V1','TC901002-2']);
 assert.match(duty.correction,/Correct the sheet to P, or correct the Caliber ID on that card/);
 // A leave in the sheet with a duty that day is the same mismatch; the short form of the name is no mismatch.
 assert.deepEqual([cells('CMPL 901003'),of('CMPL 901003').nameDiffers],[['','','duty',''],false]);
 // A helper works on no trip card: his P days are not judged, only a day Pulse-II has a duty for.
 assert.deepEqual([of('CMPL901004').onCards,of('CMPL901004').judge,cells('CMPL901004'),of('CMPL901004').difference],[false,true,['','','',''],null]);
 assert.match(of('CMPL901004').remark,/Only days with a duty in Pulse-II are compared/);
 // P in the sheet, no duty; and the name differs.
 assert.deepEqual([cells('CMPL901005'),of('CMPL901005').nameDiffers,of('CMPL901005').difference],[['','','','noDuty'],true,1]);
 const name=result.corrections.find(c=>c.kind==='name-other');assert.deepEqual([name.id,name.label,name.sheetSays,name.pulseSays],['CMPL901005','Name differs: another name','OLD NAME','NEW NAME']);
 assert.match(name.correction,/First check that the ID belongs to this person: it may be wrong in the sheet/);
 // The same person written differently is said as such: a fuller name, a spelling.
 assert.deepEqual(result.corrections.filter(c=>c.kind.startsWith('name-')).map(c=>[c.id,c.kind,c.pulseSays]),[['CMPL901004','name-spelling','MOHAN DASS'],['CMPL901005','name-other','NEW NAME'],['CMPL901007','name-fuller','FAR MAN KHAN']]);
 assert.deepEqual(['CMPL901001','CMPL901004','CMPL901005','CMPL901007'].map(id=>of(id).nameKind),['','spelling','other','fuller']);
 assert.match(result.corrections.find(c=>c.kind==='name-fuller').correction,/written fuller on one side/);assert.match(result.corrections.find(c=>c.kind==='name-spelling').correction,/in another spelling/);
 assert.match(result.corrections.find(c=>c.kind==='no-duty'&&c.id==='CMPL901005').correction,/Save the missing card or zero-trip entry, or correct the sheet to A/);
 // HR marks LEFT, the sheet still marks P.
 assert.equal(of('CMPL901006').idIssue,'id-left');assert.equal(result.corrections.find(c=>c.kind==='id-left').pulseSays,'HR marks LEFT');
 // Held at another site, and one duty at that site.
 assert.deepEqual([of('CMPL901007').siteIssue,cells('CMPL901007')],[true,['','','site','']]);
 assert.equal(result.corrections.find(c=>c.kind==='site').pulseSays,'Majri OC');
 assert.equal(result.corrections.find(c=>c.kind==='other-site').pulseSays,'Duty at Majri OC (Shift A)');
 // Not in Employee Master, not a Caliber ID, twice in the sheet, no ID.
 assert.equal(of('CMPL909999').idIssue,'id-not-found');assert.match(of('CMPL909999').remark,/Days not compared/);
 assert.equal(of('TRAINEE').idIssue,'id-unreadable');
 assert.deepEqual(result.rows.filter(r=>r.idIssue==='id-twice').map(r=>r.row),[12,13]);
 assert.match(result.corrections.find(c=>c.kind==='id-twice').correction,/rows 12 and 13/);
 assert.deepEqual(result.corrections.filter(c=>c.kind==='no-id').map(c=>[c.row,c.name]),[[17,'NO ID MAN']]);
 // A mark that is not understood and a blank are not compared, and are asked for.
 assert.deepEqual(cells('CMPL901012'),['','skip','skip','']);
 assert.equal(result.corrections.find(c=>c.kind==='mark').sheetSays,'XX');assert.match(result.corrections.find(c=>c.kind==='blank').correction,/blank in the sheet/);
 // A driver with no duty on any date is one line, not one per day.
 const never=result.corrections.filter(c=>c.id==='CMPL901013');
 assert.deepEqual([never.length,never[0].kind,never[0].sheetSays,never[0].pulseSays,cells('CMPL901013')],[1,'no-duty','P on 3 dates','No duty on any date',['noDuty','noDuty','noDuty','']]);
 // In Pulse-II with a duty here, not in the sheet; and the date the sheet has no column for.
 assert.deepEqual(result.notInSheet.map(p=>[p.id,p.name,p.dates]),[['CMLL908888','EXTRA DRIVER',[iso(2)]]],'4 Nov has no column, so its duty is not held against the sheet');
 assert.deepEqual(result.listedOnly.map(p=>[p.id,p.name]),[['907777','LISTED ONLY']]);
 assert.deepEqual(result.noColumn,[{date:iso(4),duties:1,locked:true}]);
 assert.deepEqual(result.counts,{'no-id':1,'id-unreadable':1,'id-not-found':1,'id-twice':2,'id-left':1,'name-other':1,'name-fuller':1,'name-spelling':1,site:1,'no-duty':3,'card-not-counted':0,duty:2,'other-site':1,mark:1,blank:1,'no-column':1,'not-in-sheet':1});
 // The person HR marks LEFT has P marks and no card: that is said as well, in one line.
 assert.deepEqual(result.corrections.filter(c=>c.id==='CMPL901006').map(c=>c.kind),['id-left','no-duty']);
 assert.equal(result.totals.corrections,result.corrections.length);
 assert.deepEqual(Object.keys(result.counts),Object.keys(CORRECTION_KINDS));
});

test('only locked dates are compared; later dates and dates before Pulse-II started are left out',()=>{
 const unlocked=check({lockedDays:[1,2].map(n=>KEY+'|'+iso(n))});
 assert.deepEqual([unlocked.dates.judged,unlocked.dates.pending],[[iso(1),iso(2)],[iso(3),iso(5)]]);
 assert.deepEqual(unlocked.rows.find(r=>r.id==='CMPL901005').cells.map(c=>c.state),['','','skip','skip'],'a day that is not locked is grey, never a mismatch');
 assert.equal(unlocked.rows.find(r=>r.id==='CMPL909999').cells.every(c=>c.state===''),true,'a person Pulse-II does not know has no day to grey');
 assert.deepEqual(check({today:iso(2)}).dates.compared,[iso(1),iso(2)]);
 const sheet=parseAttendanceSheet(SHEET);
 assert.deepEqual(sheetReadRange(sheet,iso(23)),{from:iso(1),to:iso(5),cut:false});
 assert.deepEqual(sheetReadRange(sheet,iso(2)),{from:iso(1),to:iso(2),cut:false});
 assert.equal(sheetReadRange(parseAttendanceSheet([['EMP ID',new Date(Date.UTC(2026,9,30))],['CMPL901001','P']]),iso(23)),null,'October is before Pulse-II started');
 // Another site's lock does not lock this site.
 assert.deepEqual(check({lockedDays:['majri ob|'+iso(1)]}).dates.judged,[]);
});

const stored=async blob=>{
 const buffer=Buffer.from(await blob.arrayBuffer()),files=new Map();let offset=0;
 while(buffer.readUInt32LE(offset)===0x04034b50){
  const size=buffer.readUInt32LE(offset+18),nameLength=buffer.readUInt16LE(offset+26),extra=buffer.readUInt16LE(offset+28),start=offset+30+nameLength+extra;
  files.set(buffer.subarray(offset+30,offset+30+nameLength).toString('utf8'),buffer.subarray(start,start+size).toString('utf8'));offset=start+size;
 }
 return files;
};

test('the Excel given back: the sheet again, each mismatch in its colour, the colour key at the top',async()=>{
 const book=attendanceSheetWorkbook(check(),{fileName:'site.xlsx',checkedAt:'10:00 AM 23-11-26'});
 assert.deepEqual(book.sheets.map(s=>s.name),['Attendance check','Corrections','Not in sheet','Summary']);
 const [grid,list,others,summary]=book.sheets;
 assert.match(grid.headerRows[0],/^Sasti OC · Attendance sheet mismatch · 01-11-2026 to 05-11-2026 · file: site\.xlsx · checked 10:00 AM 23-11-26$/);
 // The colour key: ID mismatch first, then name mismatch, each line in its own colour.
 assert.deepEqual(grid.headerRows.slice(1),SHEET_LEGEND.map(([,textLine])=>textLine));
 assert.match(grid.headerRows[1],/^RED on EMP\. ID = ID mismatch/);assert.match(grid.headerRows[2],/^YELLOW on NAME = name mismatch/);
 assert.deepEqual(grid.headerFills,{1:'id',2:'name',3:'site',4:'noDuty',5:'uncounted',6:'duty',7:'skip'});
 assert.deepEqual(grid.columns.map(c=>c.label).slice(0,11),['Row in sheet','SR NO','EMP. ID','NAME','Name in Pulse-II','Name mismatch','DESIGNATION','01-11','02-11','03-11','05-11']);
 assert.match(grid.headerRows[2],/the column "Name mismatch" says which kind: another name, fuller name, or spelling\.$/);
 const at=id=>grid.rows.findIndex(r=>r[2]===id);
 assert.deepEqual(grid.cellFills[at('CMPL901001')],{},'a line with nothing wrong has no colour');
 assert.deepEqual(grid.cellFills[at('CMPL901005')],{3:'name',10:'noDuty'},'name in yellow, the day in orange');
 assert.equal(grid.rows[at('CMPL901005')][4],'NEW NAME');assert.equal(grid.rows[at('CMPL901001')][4],'Same');assert.equal(grid.rows[at('CMPL909999')][4],'Not in Pulse-II');
 // One yellow for every name mismatch; the kind is said in the next column.
 assert.deepEqual(['CMPL901001','CMPL901004','CMPL901005','CMPL901007','CMPL909999'].map(id=>grid.rows[at(id)][5]),['','Spelling','Another name','Fuller name','']);
 assert.equal(grid.cellFills[at('CMPL901004')][3],'name');
 assert.deepEqual(grid.cellFills[at('CMPL909999')],{2:'id'},'ID in red');
 assert.deepEqual(grid.cellFills[at('CMPL901007')],{2:'site',3:'name',9:'site'});
 assert.deepEqual(grid.cellFills[at('CMPL901002')],{8:'duty'});
 assert.equal(book.sheets.every(s=>s.plainSerial),true,'no red or orange serial number beside the colour key');
 assert.deepEqual(list.columns.map(c=>c.label),['Row in sheet','EMP. ID','Name in sheet','Name in Pulse-II','Designation','Date','Mismatch','Sheet says','Pulse-II says','Correction required','Trip cards / log books']);
 assert.equal(list.rows.length,check().corrections.length);
 assert.deepEqual(others.rows.map(r=>[r[0],r[3]]),[['CMLL908888','Has a duty at this site in Pulse-II'],['907777','Employee Master holds this person at this site']]);
 assert.ok(summary.rows.some(r=>r[0]==='Dates the sheet has no column for'&&r[1]==='1'&&r[2]==='04-11-2026'));
 // The workbook itself: the colours are in the styles, on the key lines and on the cells; the first columns stay in view.
 const files=await stored(buildXlsxSheetsWorkbook(book.title,book.sheets)),styles=files.get('xl/styles.xml'),sheet1=files.get('xl/worksheets/sheet1.xml');
 const colours=Object.values(SHEET_FILLS);
 assert.match(styles,new RegExp('<fills count="'+(8+colours.length)+'">'));assert.match(styles,new RegExp('<cellXfs count="'+(12+colours.length*2)+'">'));
 for(const colour of colours)assert.ok(styles.includes('<fgColor rgb="'+colour+'"/>'),colour);
 const style=key=>12+colours.indexOf(SHEET_FILLS[key])*2;
 assert.match(sheet1,new RegExp('<c r="A2" s="'+(style('id')+1)+'" t="inlineStr"><is><t xml:space="preserve">RED on EMP\\. ID'));
 assert.match(sheet1,new RegExp('<c r="A3" s="'+(style('name')+1)+'" t="inlineStr"><is><t xml:space="preserve">YELLOW on NAME'));
 const excelRow=at('CMPL901005')+10; // 8 lines above the headings (title and 7 key lines), the headings, then the lines
 assert.match(sheet1,new RegExp('<c r="E'+excelRow+'" s="'+style('name')+'" t="inlineStr"><is><t xml:space="preserve">OLD NAME<'),'the Sr. No. column the builder adds moves NAME to column E');
 assert.match(sheet1,new RegExp('<c r="D'+(at('CMPL909999')+10)+'" s="'+style('id')+'" '));
 assert.match(sheet1,/<pane xSplit="5" ySplit="9" topLeftCell="F10" activePane="bottomRight" state="frozen"\/>/);
 assert.doesNotMatch(sheet1,/ s="(?:9|10|11)"/,'the Sr. No. is not coloured on this sheet');
});

test('a workbook with no coloured cells is written as before',async()=>{
 const files=await stored(buildXlsxSheetsWorkbook('Plain',[{name:'Report',columns:[{label:'Site'}],rows:[['Sasti OC'],['Majri OC']]}]));
 assert.match(files.get('xl/styles.xml'),/<fills count="8">/);assert.match(files.get('xl/styles.xml'),/<cellXfs count="12">/);
 assert.match(files.get('xl/worksheets/sheet1.xml'),/<pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"\/>/);
 assert.match(files.get('xl/worksheets/sheet1.xml'),/<c r="A4" s="9"/,'the Sr. No. keeps its colour in every other report');
});

// ---- The two server reads -------------------------------------------------------------------------------------------
const listRow=(id,master,data)=>({id,master_name:master,record_data:data});
const worker=(id,number,name,site,o={})=>listRow(id,'Employee master',{caliberId:'CMPL'+number,employeeId:'CMPL'+number,name,site,currentDesignationName:'TIPPER DRIVER',...o});
const INDEX=buildAFormPeople([worker(1,901001,'RAM KUMAR','Sasti OC'),worker(2,901006,'GONE MAN','Sasti OC',{hrLeft:true}),worker(3,901007,'FAR MAN','Majri OC'),
 worker(4,901020,'TWO LINES','Majri OC'),worker(5,901020,'TWO LINES','Sasti OB'),worker(6,901021,'NOT LISTED','Sasti OC',{hrListed:false})]);

test('Employee Master answers for the IDs of the sheet, and lists who it holds working at the site',()=>{
 const answer=sheetPeopleAnswer(INDEX,'Sasti OC',['901001','901006','901007','901020','901021','909999']);
 const of=number=>answer.people.find(p=>p.number===number);
 assert.deepEqual(of('901001'),{number:'901001',found:true,name:'RAM KUMAR',designation:'TIPPER DRIVER',siteLabel:'Sasti OC',atSite:true,working:true,left:false});
 assert.deepEqual([of('901006').found,of('901006').working,of('901006').left],[true,false,true]);
 assert.deepEqual([of('901007').atSite,of('901007').siteLabel],[false,'Majri OC']);
 assert.deepEqual([of('901020').atSite,of('901020').siteLabel],[true,'Sasti OC'],'a number on two lines is read at this site first');
 assert.deepEqual([of('901021').found,of('901021').working,of('901021').left],[true,false,false]);
 assert.equal(of('909999').found,false);
 assert.deepEqual(answer.sitePeople.map(p=>p.number).sort(),['901001','901020']);
});

function fakeApp(){
 const routes=new Map();
 const add=method=>(path,...handlers)=>routes.set(method+' '+path,handlers);
 const call=async(key,req)=>{
  const res={code:200,headers:{},body:null,status(code){this.code=code;return this;},set(name,value){this.headers[name]=value;return this;},json(body){this.body=body;return this;}};
  for(const handler of routes.get(key)){let went=false;await handler(req,res,error=>{if(error)throw error;went=true;});if(!went)break;}
  return res;
 };
 return {get:add('GET'),post:add('POST'),call,routes};
}
test('the reads follow the sites of the login and refuse what cannot be checked',async()=>{
 const app=fakeApp();let asked=0;
 registerAttendanceSheetCheck(app,{pool:{},protect:[(req,res,next)=>next()],readIndex:async()=>{asked++;return INDEX;},hrPunches:async()=>({sites:[],punches:[]})});
 assert.deepEqual([...app.routes.keys()],['POST /api/reports/manpower/attendance-sheet/biometric','GET /api/reports/manpower/attendance-sheet/sites','POST /api/reports/manpower/attendance-sheet/people']);
 const everySite={sites:null},oneSite={sites:['sasti ob'],label:'Sasti OC'};
 assert.equal((await app.call('GET /api/reports/manpower/attendance-sheet/sites',{logBookScope:everySite})).body.sites.length,8);
 assert.deepEqual((await app.call('GET /api/reports/manpower/attendance-sheet/sites',{logBookScope:oneSite})).body.sites,['Sasti OC']);
 const people=(scope,body)=>app.call('POST /api/reports/manpower/attendance-sheet/people',{logBookScope:scope,body});
 const good=await people(oneSite,{site:'sasti ob',ids:['CMPL901001','cmpl 901001','TRAINEE','CMLL901007']});
 assert.deepEqual([good.code,good.body.site,good.body.people.map(p=>p.number),good.headers['Cache-Control']],[200,'Sasti OC',['901001','901007'],'private, no-store']);
 assert.deepEqual([(await people(oneSite,{site:'Majri OC',ids:['CMPL901001']})).code,(await people(oneSite,{site:'Nowhere',ids:['CMPL901001']})).code],[403,400]);
 assert.deepEqual([(await people(everySite,{site:'Sasti OC',ids:[]})).code,(await people(everySite,{site:'Sasti OC',ids:Array.from({length:5001},(_,i)=>'CMPL'+(i+1))})).code,(await people(everySite,{site:'Sasti OC'})).code],[400,400,400]);
 assert.equal(asked,1,'Employee Master is read only for a request that can be answered');
});

test('a site MIS login with the Reports menu may call both reads; another menu may not',()=>{
 const session=allowed=>({permissions:{separateMisCredentials:true,misDesktopAccess:allowed,misMobileAccess:[]}});
 for(const [path,method] of [['/api/reports/manpower/attendance-sheet/sites','GET'],['/api/reports/manpower/attendance-sheet/people','POST'],['/api/reports/manpower/attendance','GET']]){
  assert.equal(misRequestAllowed(session(['Reports']),{path,method}),true,path);
  assert.equal(misRequestAllowed(session(['Dashboard']),{path,method}),false,path);
 }
});

// ---- The screen -----------------------------------------------------------------------------------------------------
test('the first worksheet that is an attendance sheet is read; the others are passed over',async()=>{
 const books={'Sheet1':[['S.No','Total'],[1,1163]],'ATTEN':SHEET,'OT':[['SL NO','Emp ID',...Array.from({length:31},(_,i)=>i+1)],[1,'CMPL901001','P']]};
 const reader=names=>({readSheetNames:async()=>names,default:async(file,{sheet})=>books[sheet]});
 const read=await readAttendanceFile({},reader(['Sheet1','ATTEN','OT']));
 assert.deepEqual([read.sheetName,read.people.length],['ATTEN',13]);
 await assert.rejects(readAttendanceFile({},reader(['Sheet1','OT'])),/only day numbers/,'the reason that says most is given');
 await assert.rejects(readAttendanceFile({},reader(['Sheet1'])),/no EMP\. ID column/);
 await assert.rejects(readAttendanceFile({},{readSheetNames:async()=>{throw Error('not a zip');},default:async()=>[]}),/Save it as Excel Workbook \(\.xlsx\)/);
});

test('the check reads Pulse-II once for the dates of the sheet and names the Excel by site and dates',async()=>{
 const calls=[];
 const read=async(url,session,options)=>{calls.push([url,session.token,options?.method||'GET',options?.body?JSON.parse(options.body):null]);
  return url.includes('/people')?{site:'Sasti OC',people:PEOPLE,sitePeople:[]}:{otDuties:LINES.slice(0,-1),attendanceEquipment:LINES.slice(-1),lockedDays:LOCKED};};
 const done=await runSheetCheck({sheet:parseAttendanceSheet(SHEET),fileName:'site.xlsx',site:'Sasti OC',session:{token:'T'},today:iso(23),read,build:(title,sheets)=>({title,sheets})});
 assert.deepEqual(calls.map(c=>c.slice(0,3)),[['/api/reports/manpower/attendance?from=2026-11-01&to=2026-11-05&view=attendance','T','GET'],['/api/reports/manpower/attendance-sheet/people','T','POST']]);
 assert.deepEqual([calls[1][3].site,calls[1][3].ids.length],['Sasti OC',13],'only the site and the ID numbers leave the browser');
 assert.equal(done.name,'Attendance-sheet-mismatch-Sasti-OC-2026-11-01-to-2026-11-05.xlsx');
 assert.equal(done.result.counts.duty,2);assert.equal(done.blob.sheets.length,4);
 await assert.rejects(runSheetCheck({sheet:parseAttendanceSheet(SHEET),site:'Sasti OC',session:{token:'T'},today:'2026-10-31',read}),/No date of this sheet can be compared/);
});

test('the tab sits after the sheet upload tab, which is beside Attendance Month-wise, in the tab row and in the Reports menu',()=>{
 assert.deepEqual(operationReports.find(r=>r.id==='attendance-sheet'),{id:'attendance-sheet',title:'Attendance Sheet Mismatch',group:'Manpower & OT'});
 // Owner, 24 Nov 2026: the tab where the site's sheet is uploaded sits just beside Attendance Month-wise.
 const ids=operationReports.map(r=>r.id);assert.equal(ids.indexOf('attendance-sheet'),ids.indexOf('attendance-month')+2);
 const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
 const screen=read('../src/manpower-reports.jsx');
 assert.match(screen,/\['attendance-month','Attendance Month-wise'\],\['attendance-site-sheet','Site Sheet vs Trip Card'\],\['attendance-sheet','Attendance Sheet Mismatch'\],\['attendance-trip-bio','Trip Card vs Bio-punch'\]\];/);
 assert.match(screen,/if\(!valid\|\|sheetCheck\)\{setBusy\(false\)/,'the tab does not start the Manpower read');
 assert.match(screen,/if\(sheetCheck\)return <section[\s\S]*?<AttendanceSheetCheck session=\{session\}\/>/);
 assert.match(read('../src/operations-reports.jsx'),/'attendance-batch','attendance-month','attendance-sheet','attendance-site-sheet','attendance-trip-bio'\]\.includes\(props\.reportId\)\)return <ManpowerReports/);
 const page=read('../src/attendance-sheet-check.jsx');
 assert.match(page,/accept="\.dat,\.txt,\.csv,\.xlsx,\.xlsm"/,'the device attlog .dat or its export');
 assert.match(page,/Drivers and operators only/);assert.match(page,/Download Excel/);assert.match(page,/Nothing is changed in Pulse-II/);
 assert.match(page,/className="asc-drill-link"/,'employee names and IDs open the detail');
 assert.match(page,/openDrill\(p,'bioDays'\)/);assert.match(page,/openDrill\(p,f\.key\)/,'each numeric count opens its matching detail');
 assert.match(page,/role="dialog" aria-modal="true"/);assert.match(page,/No detail is available for this value/);
 assert.match(read('../server/routes/log-book.mjs'),/registerAttendanceSheetCheck\(app,\{pool,protect\}\);/);
});
