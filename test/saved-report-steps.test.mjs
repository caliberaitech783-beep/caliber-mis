import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildOperationReport,operationReports,requirements} from '../src/operations-report-model.mjs';
import {STEP_REPORTS,LINE_REPORTS,EVERY,hasReportSteps,stepItems,openedItems,stepLines,stepTable,assetCategoryOf} from '../src/saved-report-steps-model.mjs';

const site='Dhoptala OB (2nd)';
const assets=[{id:'1',door:'V103',site,kind:'vehicle',group:'TIPPER'},{id:'2',door:'V104',site,kind:'vehicle',group:'TIPPER'},{id:'3',door:'EX7',site,kind:'equipment',group:'EXCAVATOR'},{id:'4',door:'V9',site:'Majri OB',kind:'vehicle',group:'WATER TANKER'}];
const shifts=[{id:'1',site,name:'Shift A'},{id:'2',site,name:'Shift B'}];
const rec=(id,assetId,door,date,shiftId,shiftName,extra={})=>({id,book:'B'+id,kind:door.startsWith('EX')?'equipment':'vehicle',assetId,door,bookDate:date,location:assets.find(a=>a.id===assetId)?.site||site,shiftId,shiftName,employeeName:'SAMPLE '+id,caliberId:'C'+id,shiftHours:8,hours:6,openingHmr:10,closingHmr:16,openingKmr:100,closingKmr:140,km:40,tripsTotal:5,trips:[],...extra});
const records=[rec(1,'1','V103','2026-11-01',1,'Shift A'),rec(2,'2','V104','2026-11-01',1,'Shift A'),rec(3,'3','EX7','2026-11-01',2,'Shift B'),rec(4,'1','V103','2026-11-02',1,'Shift A',{closingHmr:30,hours:20}),rec(5,'4','V9','2026-11-01',1,'Shift A')];
const filters={from:'2026-11-01',to:'2026-11-02'};

test('every Operations report that was one long table now opens in steps',()=>{
 const own=['timing','loading','batch-status','meter-continuity','manpower','manpower-reconciliation','employee','attendance','ot','attendance-batch','attendance-month','attendance-sheet','attendance-site-sheet','attendance-trip-bio','door-production','machine-production'];
 const left=operationReports.map(r=>r.id).filter(id=>!own.includes(id)&&!requirements[id]&&!hasReportSteps(id));
 assert.deepEqual(left,[],'reports with no steps: '+left.join(', '));
 for(const id of Object.keys(LINE_REPORTS))assert.ok(STEP_REPORTS.includes(id));
});

test('the equipment category comes from the saved asset, else from a door that is one asset at the site',()=>{
 const of=assetCategoryOf(assets);
 assert.equal(of({assetId:'3',door:'',site}),'Excavator');
 assert.equal(of({assetId:null,door:'V104',site}),'Tipper');
 assert.equal(of({assetId:null,door:'V104',site:'Majri OB'}),'Group missing in master');
});

test('a line report opens its own lines: site, date and shift, category, with the rows it already had',()=>{
 const report=buildOperationReport('vehicle',records,{assets,shifts,filters});
 const items=stepItems('vehicle',{records,report,assets});
 assert.equal(items.length,4,'one item per vehicle log book');
 const sites=stepLines(items,'site');
 // Sites read by their OC name (owner, 22 Nov 2026).
 assert.deepEqual(sites.rows.map(r=>[r.site,r.count]),[['Dhoptala OC (2nd)',3],['Majri OC',1]]);
 assert.equal(sites.total.count,4);
 const atSite=openedItems(items,{site:sites.rows[0].key});
 const slots=stepLines(atSite,'slot');
 assert.deepEqual(slots.rows.map(r=>[r.date,r.shift,r.count]),[['2026-11-01','Shift A',2],['2026-11-02','Shift A',1]]);
 const inSlot=openedItems(atSite,{slot:'2026-11-01|Shift A'});
 const categories=stepLines(inSlot,'category');
 assert.deepEqual(categories.rows.map(r=>[r.category,r.count,r.assets]),[['Tipper',2,2]]);
 const table=stepTable('vehicle',report,openedItems(inSlot,{category:'Tipper'}),()=>assert.fail('a line report is not built again'));
 assert.deepEqual(table.columns,report.columns);
 assert.deepEqual(table.rows.map(r=>r[2]),['B1','B2']);
});

test('the meter exceptions count exceptions, and Potential missing logbooks are found by door and shift',()=>{
 const meters=buildOperationReport('meters',records,{assets,shifts,filters});
 const items=stepItems('meters',{records,report:meters,assets});
 assert.ok(items.length>=1&&items.every(i=>i.date&&i.site&&i.shift));
 const missing=buildOperationReport('missing',records,{assets,shifts,filters});
 const found=stepItems('missing',{records,report:missing,assets});
 assert.ok(found.some(i=>i.source[6]==='Potential missing'&&i.category==='Tipper'&&i.shift==='Shift B'));
});

test('a built report is built again from the log books opened',()=>{
 const report=buildOperationReport('daily',records,{assets,shifts,filters});
 const items=stepItems('daily',{records,report,assets});
 assert.equal(items.length,records.length);
 const opened=openedItems(items,{site:EVERY,slot:'2026-11-01|Shift B',category:EVERY});
 const table=stepTable('daily',report,opened,list=>buildOperationReport('daily',list,{assets,shifts,filters}));
 assert.equal(table.rows.length,1);
 assert.equal(table.rows[0][2],'Shift B');
});

test('the Vehicle-wise Trip Report counts only vehicles in its steps, as its own table does',()=>{
 const items=stepItems('vehicle-trips',{records,report:{rows:[]},assets});
 assert.equal(items.length,4,'the excavator log book is left out');
 assert.ok(!stepLines(items,'category').rows.some(r=>r.category==='Excavator'));
 assert.equal(stepItems('daily',{records,report:{rows:[]},assets}).length,5,'other built reports keep every log book');
});

test('Potential missing logbooks over 18 days and 1,600 assets are found in seconds, not minutes',()=>{
 const sites=['S1','S2','S3','S4','S5','S6','S7','S8'];
 const many=Array.from({length:1600},(_,i)=>({id:String(i+1),door:'D'+(i+1),site:sites[i%8],kind:'vehicle',group:'TIPPER'}));
 const manyShifts=sites.flatMap((s,j)=>['A','B','C'].map((n,k)=>({id:String(j*3+k+1),site:s,name:'Shift '+n})));
 const books=[];
 for(let day=1;day<=18;day++)for(const a of many)for(const s of manyShifts.filter(s=>s.site===a.site))if((Number(a.id)+day+Number(s.id))%3)books.push({id:books.length+1,book:'B'+books.length,kind:'vehicle',assetId:Number(a.id),door:a.door,bookDate:'2026-11-'+String(day).padStart(2,'0'),location:a.site,shiftId:Number(s.id),shiftName:s.name,employeeName:'',caliberId:'',trips:[]});
 const started=Date.now();
 const report=buildOperationReport('missing',books,{assets:many,shifts:manyShifts,filters:{from:'2026-11-01',to:'2026-11-18'}});
 assert.ok(Date.now()-started<5000,'took '+(Date.now()-started)+' ms');
 const expected=18*1600*3-books.length;
 assert.equal(report.rows.filter(r=>r[6]==='Potential missing').length,expected);
});

test('scanned cards open by their own date, site, shift and door',()=>{
 const cards=[{id:9,scanned_date:'2026-11-02',status:'pending',draft:{bookDate:'2026-11-01',location:site,shiftName:'Shift A',door:'V103'}},{id:10,scanned_date:'2026-11-02',status:'failed',draft:null}];
 const items=stepItems('scans',{records,cards,report:{rows:[]},assets});
 assert.deepEqual(items.map(i=>[i.date,i.site,i.shift,i.category]),[['2026-11-01','Dhoptala OC (2nd)','Shift A','Tipper'],['2026-11-02','Site not recorded','Shift not recorded','Group missing in master']]);
});

test('a scanned card with no shift name of its own takes the shift marked on its batch, named as the site names it',()=>{
 const master=[{id:'1',site,name:'SHIFT A',shiftCode:'A'},{id:'2',site,name:'Shift B',shiftCode:'B'},{id:'7',site:'Majri OB',name:'Day',shiftCode:'D'}];
 const cards=[
  {id:1,card_shift:'II',draft:{bookDate:'2026-11-16',location:'sasti ob',door:'V103'}},
  {id:2,card_shift:'I',draft:{bookDate:'2026-11-16',location:site,door:'V104'}},
  {id:3,card_shift:'II',draft:{bookDate:'2026-11-16',location:'Dhoptala OB 2nd',door:'V104'}},
  {id:4,card_shift:'Day',draft:{bookDate:'2026-11-16',location:'Majri OB'}},
  {id:5,card_shift:'',draft:{bookDate:'2026-11-16',location:site,shiftId:'2'}},
  {id:6,card_shift:'III',draft:{bookDate:'2026-11-16',location:site,shiftName:'shift c'}},
  {id:7,card_shift:null,draft:{bookDate:'2026-11-16',location:site}}];
 const items=stepItems('scans',{cards,report:{rows:[]},assets,shifts:master});
 assert.deepEqual(items.map(i=>i.shift),['Shift B','Shift A','Shift B','Day','Shift B','Shift C','Shift not recorded']);
});

test('the Operations reading sends each card the shift of its batch and each shift its code',()=>{
 const server=readFileSync(new URL('../server/routes/log-book.mjs',import.meta.url),'utf8');
 assert.match(server,/expected_context'->>'cardShift' AS card_shift/);
 assert.match(server,/OPERATIONS_SCAN_CARD_FIELDS=\[[^\]]*'card_shift'/);
 assert.match(server,/site:text\(r\.site\|\|r\.siteName\),shiftCode:text\(r\.shiftCode\)\}\)\);/);
});

test('the Operations screen draws these reports through the steps, each step under the one before',()=>{
 const screen=readFileSync(new URL('../src/operations-reports.jsx',import.meta.url),'utf8');
 assert.match(screen,/const stepped=hasReportSteps\(id\);/);
 assert.match(screen,/<SavedReportSteps key=\{id\} id=\{id\} [^>]*levels=\{step\.result\.levels\}/,'the steps draw the server’s answer');
 assert.match(screen,/const open=stepsOpen\.id===id\?stepsOpen\.open:CLOSED_STEPS/,'another report starts again at Step 1');
 const steps=readFileSync(new URL('../src/saved-report-steps.jsx',import.meta.url),'utf8');
 for(const n of [1,2,3,4])assert.match(steps,new RegExp("'Step "+n+" · '"));
 assert.match(steps,/level>=2&&/);assert.match(steps,/level>=3&&/);assert.match(steps,/level>=4&&/);
 assert.doesNotMatch(steps,/level===\d/);
 assert.match(steps,/<DateShiftGrid /);
});

test('old log books read the site by its OC name on every date (owner, 22 Nov 2026)',async()=>{
 const {normalise,siteDisplayName,filterRecords}=await import('../src/operations-report-model.mjs');
 const {canonicalSiteName}=await import('../shared/site-location.mjs');
 // Log books saved before the rename keep what was written; the report reads them by the OC name.
 const saved=[['dhoptala ob 2nd',1],['Dhoptala OC (2nd)',2],['gauri pauni ob 2nd',3],['JAYANT OB 2nd',4],['Jayant OB',5],['-',6]]
  .map(([location,id])=>({id,book_no:'B'+id,book_type:'vehicle',data:{bookDate:'2026-11-01',location,shiftName:'SHIFT A',trips:[]}}));
 const rows=normalise(saved);
 assert.deepEqual(rows.map(r=>r.location),['Dhoptala OC (2nd)','Dhoptala OC (2nd)','Gauri Pauni OC (2nd)','Jayant OC','Jayant OC','-']);
 assert.equal(saved[0].data.location,'dhoptala ob 2nd','the saved log book is not changed');
 // The site filter still finds every old spelling.
 assert.equal(filterRecords(rows,{site:'Dhoptala OB 2nd'}).length,2);
 // Step 1: one line per site, named once by its OC name.
 const report=buildOperationReport('vehicle',rows,{filters:{}});
 const lines=stepLines(stepItems('vehicle',{records:rows,report}),'site').rows;
 assert.deepEqual(lines.map(l=>[l.site,l.count]),[['-',1],['Dhoptala OC (2nd)',2],['Gauri Pauni OC (2nd)',1],['Jayant OC',2]]);
 // A scanned card read before the rename reads the same way.
 assert.equal(stepItems('scans',{cards:[{draft:{bookDate:'2026-11-01',location:'gouri pouni ob 2nd'}}]})[0].site,'Gauri Pauni OC (2nd)');
 // The OC name never moves a log book to another site.
 for(const name of ['dhoptala ob 2nd','gouri ob','jayant ii','majri o b','dudhicua east ob','sasti ii','lalpeth'])assert.equal(canonicalSiteName(siteDisplayName(name)),canonicalSiteName(name),name);
});
