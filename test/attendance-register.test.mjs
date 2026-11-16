// Attendance Batch-wise and Month-wise (owner, 15 Nov 2026): uKnowva-style attendance from saved log book duties.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {buildAttendanceRegister,batchPeople,batchCategories,registerCategories,personCategories,shiftDigit,strongest,registerDays} from '../src/attendance-register-model.mjs';
import {operationReports} from '../src/operations-report-model.mjs';

const JAYANT='jayant oc',DUDHI='dudhichua oc';
const duty=(who,date,shift,extra={})=>({id:[who,date,shift,extra.siteKey||JAYANT].join('|'),date,shift,site:extra.siteKey===DUDHI?'Dudhichua OC':'Jayant OC',siteKey:JAYANT,employeeKey:'CMLL'+who,employeeId:'CMLL'+who,caliberCode:'CMLL'+who,employeeName:'Driver '+who,category:'Tipper Driver',equipment:'Tipper',doors:'T-'+who,logBook:'VLB',flag:'normal',flagLabel:'Normal duty',hours:7,trips:10,km:50,books:'B-'+who+'-'+date+shift,...extra});
const batch=(siteKey,date,shift,state)=>({siteKey,date,shift,state,batch:siteKey+' '+date+' '+shift});
const days=['2026-11-10','2026-11-11','2026-11-12'];
// Jayant: 10th all three shifts locked; 11th Shift 3 still open (VLB stage); 12th Shift 1 locked, Shift 2 not created, Shift 3 not ended.
const shifts=[...['S1','S2','S3'].map(s=>batch(JAYANT,days[0],s,'closed')),batch(JAYANT,days[1],'S1','closed'),batch(JAYANT,days[1],'S2','closed'),batch(JAYANT,days[1],'S3','vlb_open'),
 batch(JAYANT,days[2],'S1','closed'),batch(JAYANT,days[2],'S2','none'),batch(JAYANT,days[2],'S3','not_due'),...days.flatMap(d=>['S1','S2','S3'].map(s=>batch(DUDHI,d,s,'closed')))];
const duties=[
 duty('101',days[0],'S1'),duty('101',days[0],'S3',{flag:'orange',flagLabel:'ORANGE — Shift 1 and Shift 3 with a shift gap'}),duty('101',days[1],'S1'),
 duty('102',days[0],'S2'),duty('102',days[1],'S2',{siteKey:DUDHI}),
 duty('103',days[1],'S1',{logBook:'ELB',trips:null,km:null,hours:6.5}),duty('103',days[2],'S1',{logBook:'ELB',trips:null,km:null,hours:7.5}),
];
// A zero-trip entry without a card (present) and a Shift Attendance line that repeats a card duty (not counted twice).
const presence=[{actual:true,employeeKey:'CMLL104',employeeId:'CMLL104',caliberCode:'CMLL104',employeeName:'Driver 104',date:days[0],shift:'S1',site:'Jayant OC',siteKey:JAYANT,equipment:'Tipper',doors:'T-104',trips:0,flag:'zero',flagLabel:'BLUE — Present with 0 trips'},
 {actual:true,employeeKey:'CMLL101',date:days[0],shift:'S1',siteKey:JAYANT,site:'Jayant OC'},{actual:false,employeeKey:'CMLL105',date:days[0],shift:'S1',siteKey:JAYANT}];
const sites=[{siteKey:DUDHI,site:'Dudhichua OC'},{siteKey:JAYANT,site:'Jayant OC'}];
const build=()=>buildAttendanceRegister({duties,presence,shifts,sites,from:days[0],to:'2026-11-13',today:'2026-11-12'});
const codes=(register,siteKey)=>Object.fromEntries(register.register(siteKey).map(p=>[p.caliberCode,p.cells.map(c=>c.code).join(' ')]));

test('a day is P with its shifts, TR at another site, A only once every batch of the day is locked, ? before that, blank later',()=>{
 const r=build();
 assert.deepEqual(r.days,['2026-11-10','2026-11-11','2026-11-12','2026-11-13']);
 assert.deepEqual(codes(r,JAYANT),{
  'CMLL101':'P1+3 P1 ? ',   // 12th: Shift 2 has no batch and Shift 3 has not ended, so the day is pending, not absent
  'CMLL102':'P2 TR ? ',     // 11th worked at Dudhichua
  'CMLL103':'A P1 P1 ',     // 10th: every Jayant batch locked and no card anywhere
  'CMLL104':'P1 ? ? ',      // zero-trip entry counts as present; 11th Shift 3 still open
 });
 const p101=r.register(JAYANT).find(p=>p.caliberCode==='CMLL101');
 assert.equal(p101.cells[0].flag,'orange','a double duty carries the OT colour of its duties');
 assert.deepEqual([p101.duties,p101.shiftCounts.S1,p101.shiftCounts.S3,p101.double,p101.present,p101.absent,p101.pending,p101.hours,p101.trips,p101.km],[3,2,1,1,2,0,1,21,30,150]);
 const p103=r.register(JAYANT).find(p=>p.caliberCode==='CMLL103');
 assert.deepEqual([p103.present,p103.absent,p103.attendance,p103.trips],[2,1,'66.7%',null],'attendance % = present ÷ (present + absent); ELB has no trips');
 assert.equal(r.register(JAYANT).find(p=>p.caliberCode==='CMLL104').cells[0].flag,'zero');
 assert.deepEqual(codes(r,DUDHI),{'CMLL102':'TR P2 A '},'the Dudhichua register shows the Jayant day as TR');
});

test('Step 1 counts people, duties, shifts, double-duty days, absent and pending person-days and locked batches per site',()=>{
 const r=build(),jayant=r.siteRows.find(s=>s.siteKey===JAYANT);
 assert.deepEqual([jayant.people,jayant.duties,jayant.S1,jayant.S2,jayant.S3,jayant.double,jayant.present,jayant.absent,jayant.pending,jayant.locked,jayant.due,jayant.attendance],[4,7,5,1,1,1,6,1,4,6,8,'85.7%']);
 assert.deepEqual(r.siteRows.map(s=>s.site),['Dudhichua OC','Jayant OC']);
 assert.equal(r.allSites.people,5,'a person at two sites is counted at each');
});

test('Step 2 batch-wise: one line per batch with the people present, colours and state; Step 3 lists that batch',()=>{
 const r=build(),lines=r.batchLines(JAYANT);
 const line=(date,shift)=>lines.find(l=>l.date===date&&l.shift===shift);
 assert.deepEqual([line(days[0],'S1').present,line(days[0],'S1').status,line(days[0],'S1').orange,line(days[0],'S1').zero],[2,'locked',1,1]);
 assert.deepEqual([line(days[1],'S3').status,line(days[2],'S2').status,line(days[2],'S3').status],['open','none','not_due']);
 const people=batchPeople(r,{siteKey:JAYANT,date:days[0],shift:'S1'});
 assert.deepEqual(people.map(p=>[p.caliberCode,p.employeeName,p.code,p.flag,p.trips]),[['CMLL101','Driver 101','P1+3','orange',10],['CMLL104','Driver 104','P1','zero',0]]);
 assert.deepEqual(r.dayPeople(JAYANT,days[0]).filter(x=>x.cell.kind!=='present').map(x=>[x.person.caliberCode,x.cell.code]),[['CMLL103','A']]);
});

test('Step 3 batch-wise (owner, 16 Nov 2026): the batch by equipment category, a person on two categories in both',()=>{
 const r=buildAttendanceRegister({duties:[...duties,duty('106',days[0],'S1',{equipment:'Excavator',flag:'red',flagLabel:'RED'}),duty('107',days[0],'S1',{id:'107a',equipment:''}),
  duty('108',days[0],'S1',{id:'108a',equipment:'Excavator'}),duty('108',days[0],'S1',{id:'108b',equipment:'Tipper'})],presence,shifts,sites,from:days[0],to:'2026-11-13',today:'2026-11-12'});
 const people=batchPeople(r,{siteKey:JAYANT,date:days[0],shift:'S1'});
 assert.deepEqual(people.map(p=>[p.caliberCode,p.categories.join('+')]),[['CMLL101','Tipper'],['CMLL104','Tipper'],['CMLL106','Excavator'],['CMLL107','Group missing in master'],['CMLL108','Excavator+Tipper']]);
 const {rows,total}=batchCategories(people);
 assert.deepEqual(rows.map(c=>[c.equipment,c.present,c.double,c.red,c.orange,c.zero]),[['Tipper',3,2,0,1,1],['Excavator',2,1,1,0,0],['Group missing in master',1,0,0,0,0]],'most people first; two cards in one shift is a double day (P1+1), as in the register');
 assert.deepEqual([total.equipment,total.present,total.red,total.orange,total.zero],['All categories',5,1,1,1],'each person once in All categories');
});

test('small rules: shift digits, strongest colour, at most 32 days',()=>{
 assert.deepEqual(['S1','S2','S3','D'].map(shiftDigit),['1','2','3','D']);
 assert.equal(strongest(['normal','orange','zero']),'orange');assert.equal(strongest(['zero','normal']),'zero');
 assert.equal(registerDays('2026-11-01','2026-12-31').length,32);
});

test('the two tabs are listed under Manpower & OT and routed to the manpower reports',()=>{
 for(const [id,title] of [['attendance-batch','Attendance Batch-wise'],['attendance-month','Attendance Month-wise']]){
  assert.deepEqual(operationReports.find(r=>r.id===id),{id,title,group:'Manpower & OT'});
 }
 const route=fs.readFileSync(new URL('../src/operations-reports.jsx',import.meta.url),'utf8');
 assert.match(route,/'attendance-batch','attendance-month'\]\.includes\(props\.reportId\)\)return <ManpowerReports/);
 const screen=fs.readFileSync(new URL('../src/manpower-reports.jsx',import.meta.url),'utf8');
 assert.match(screen,/register\?\{from:filters\.from,to:filters\.to,view:'attendance'\}/,'the register reads every shift and site');
 assert.match(screen,/register\?'\/api\/reports\/manpower\/attendance\?'/,'through its own lighter read');
 assert.match(screen,/register\?<AttendanceRegister /);
});

// Draws the real screen with stand-ins for the app's ReportSection and step-back button.
async function load(file,names){
 const source=fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export default function/gm,'function').replace(/^export /gm,'');
 const {code}=await transformWithOxc(source,file,{jsx:{runtime:'classic'}});
 return code;
}
async function screen(state){
 const grid=await load('date-shift-grid.jsx'),register=await load('attendance-register.jsx');
 const parts=new Function('React',grid+';return {DateShiftGrid,dateShiftGrid,dateShiftExport};')(React);
 const ReportSection=({title,rows,columns,children})=>React.createElement('section',{'data-title':title},React.createElement('h2',null,title),children||React.createElement('table',null,React.createElement('tbody',null,rows.map((r,i)=>React.createElement('tr',{key:i},columns.map(c=>React.createElement('td',{key:c.key},String(c.value(r)))))))));
 let slot=0;const useState=initial=>{const value=state[slot++]??(typeof initial==='function'?initial():initial);return [value,()=>{}];};
 const env={React,useMemo:fn=>fn(),useState,...parts,StepBackButton:()=>null,buildAttendanceRegister,batchPeople,batchCategories,registerCategories,personCategories};
 const Register=new Function(...Object.keys(env),register+';return AttendanceRegister;')(...Object.values(env));
 const report={otDuties:duties,attendanceEquipment:presence,attendanceShifts:shifts};
 return mode=>{slot=0;return renderToStaticMarkup(React.createElement(Register,{report,filters:{from:days[0],to:'2026-11-13'},mode,ReportSection,sites,query:'q'}));};
}

test('Batch-wise draws Step 1, the date by shift table, the batch by equipment category and its people, one below the other',async()=>{
 const html=(await screen([JAYANT,{date:days[0],shift:'S1'},'']))('attendance-batch');
 const titles=[...html.matchAll(/data-title="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(titles.slice(0,3),['Step 1 · All sites · 10-11-26 to 13-11-26','Step 2 · Jayant OC · date by shift · 10-11-26 to 13-11-26','Step 3 · Jayant OC · 10-11-26 · Shift 1 · by equipment category']);
 assert.ok(!titles.some(t=>t.startsWith('Step 4')),'the people wait for a category');
 assert.match(html,/aria-label="2 persons present · 10-11-26 · Shift 1 · Locked"/);
 assert.match(html,/<td>Tipper<\/td><td>2<\/td>/);
 assert.match(html,/not on any card here that day/);
 const opened=(await screen([JAYANT,{date:days[0],shift:'S1'},'','Tipper']))('attendance-batch');
 assert.ok(opened.includes('data-title="Step 4 · Jayant OC · 10-11-26 · Shift 1 · Tipper · people"'));
 assert.match(opened,/<td>CMLL101<\/td><td>Driver 101<\/td>/,'Caliber ID and Name side by side');
});

test('Month-wise Step 2 (owner, 16 Nov 2026): the site\'s people by equipment category, a person on two categories in both',()=>{
 const r=buildAttendanceRegister({duties:[...duties,duty('101',days[1],'S2',{id:'101x',equipment:'Excavator'})],presence,shifts,sites,from:days[0],to:'2026-11-13',today:'2026-11-12'});
 const {rows,total}=registerCategories(r.register(JAYANT));
 assert.deepEqual(rows.map(c=>[c.equipment,c.people,c.duties]),[['Tipper',4,7],['Excavator',1,1]],'most people first; duties are on that category');
 assert.deepEqual([total.equipment,total.people,total.duties],['All categories',4,8],'each person once in All categories');
 assert.deepEqual(personCategories(r.register(JAYANT).find(p=>p.caliberCode==='CMLL101')),['Tipper','Excavator']);
});

test('Month-wise draws its categories, then the register grid with Caliber ID beside Name, day codes and totals, and a person’s duties',async()=>{
 const first=(await screen([JAYANT,{date:'',shift:''},'']))('attendance-month');
 assert.match(first,/data-title="Step 2 · Jayant OC · by equipment category · 10-11-26 to 13-11-26"/);
 assert.doesNotMatch(first,/data-title="Step 3/,'the register waits for a category');
 const html=(await screen([JAYANT,{date:'',shift:''},'CMLL101','*']))('attendance-month');
 assert.match(html,/Step 3 · Jayant OC · All categories · month-wise register/);
 assert.match(html,/<td class="ar-sticky ar-id">CMLL101<\/td><th scope="row" class="ar-sticky ar-name">/);
 assert.match(html,/class="ar-code ar-present ar-flag-orange"[^>]*>P1\+3<\/td>/);
 assert.match(html,/class="ar-code ar-absent"[^>]*>A<\/td>/);
 assert.match(html,/class="ar-code ar-pending[^"]*"[^>]*>\?<\/td>/);
 assert.match(html,/Step 4 · CMLL101 · Driver 101 · duties at Jayant OC/);
});
