// Found on live data, 17 Nov 2026: 74 machines at Gauri Pauni carry "-" as their registration; "-" became an empty key
// that matched every Pulse request with the same "-", so every breakdown of the site was put on every such machine (ELB
// BD hours of about 8 h on nearly every machine). A blank or placeholder key never names a machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pulseMachineKey,pulseMachineKeys} from '../shared/pulse-machine-key.mjs';
import {summarizePulseHours} from '../server/rules/log-book-hours.mjs';
import {machineShifts} from '../shared/loading-machine-report.mjs';
import {normalise} from '../src/operations-report-model.mjs';

test('a blank, a dash or a placeholder is not a machine key; a door number, registration or chassis is',()=>{
 for(const value of ['','-','--','—','NA','N/A','n.a.','NIL','None','0','00','TBA','SERVICE VAN',null,undefined])assert.equal(pulseMachineKey(value),'',String(value));
 assert.equal(pulseMachineKey('TPC100-50251'),'TPC10050251');
 assert.equal(pulseMachineKey('MH34 BZ 2841'),'MH34BZ2841');
 assert.equal(pulseMachineKey('THEJAEL0H00050251'),'THEJAEL0H00050251');
 assert.deepEqual(pulseMachineKeys(['TPC100-50251','-','TPC100 50251','NA']),['TPC10050251']);
});

const shift={startTime:'07:00:00'};
const base={date:'2026-11-14',site:'Gauri Pauni OC (2nd)',shift,shiftHours:8,runningHours:5,now:Date.parse('2026-11-15T00:00:00Z')};
const request=(ref,door,extra={})=>({ref,site:'Gauri Pauni OC (2nd)',door,reg:'-',chassis:'-',start:'2026-11-14 07:30:00',closedAt:'2026-11-14 09:30:00',...extra});

test('ELB save: a "-" registration or chassis no longer puts another machine\'s breakdown on this machine',()=>{
 const asset={door:'TPC100-50251',equipmentName:'TPC100-50251',reg:'-',registration:'',chassisNo:'THEJAEL0H00050251'};
 const rows=[request('OTHER-1','JPC18-32182'),request('OTHER-2','VPC13 - 76685',{chassis:''}),request('MINE','TPC100-50251')];
 const result=summarizePulseHours({...base,asset,rows});
 assert.deepEqual(result.references,['MINE']);
 assert.equal(result.breakdownHours,2);
 // A machine whose own Pulse request carries its chassis is still found by the chassis.
 const byChassis=summarizePulseHours({...base,asset,rows:[request('CHASSIS','',{chassis:'THEJAEL0H00050251',door:''})]});
 assert.deepEqual(byChassis.references,['CHASSIS']);
 // Nothing that names the machine: no breakdown, not 8 hours of everyone else's.
 const none=summarizePulseHours({...base,asset:{door:'TPC101-50255',reg:'-',chassisNo:'-'},rows});
 assert.deepEqual([none.references,none.breakdownHours],[[],0]);
});

const elb=(id,assetId,door,pulseBreakdowns=[])=>({id,book_no:'ELB'+id,book_type:'equipment',data:{bookDate:'2026-11-14',location:'Gauri Pauni OC (2nd)',assetId,door,assetName:door,employeeName:'SAMPLE OPERATOR',openingHmr:100,closingHmr:105,breakdownHours:8,
 shiftId:1,shiftName:'Shift A',shiftHours:8,masterShiftStart:'07:00',bookShiftCode:'A',pulseBreakdowns}});
const copy=(reference,start,end)=>({reference,description:'Copied',start,end,ongoing:false,shiftStart:start,shiftEnd:end});
const assets=[{id:'1',door:'TPC100-50251',site:'Gauri Pauni OC (2nd)',kind:'equipment',group:'Excavator',name:'TPC100-50251',chassis:'-'},
 {id:'2',door:'TPC101-50255',site:'Gauri Pauni OC (2nd)',kind:'equipment',group:'Excavator',name:'TPC101-50255',chassis:'-'},
 {id:'3',door:'VPC13 - 76685',site:'Gauri Pauni OC (2nd)',kind:'equipment',group:'Excavator',name:'VPC13 - 76685',chassis:'-'}];

test('report without a Pulse read: a request copied onto several machines\' ELB cards of the shift is left out',()=>{
 const site=[copy('SITE-1','2026-11-14T02:00:00.000Z','2026-11-14T04:00:00.000Z'),copy('SITE-2','2026-11-14T05:00:00.000Z','2026-11-14T06:00:00.000Z')];
 const own=copy('OWN','2026-11-14T03:00:00.000Z','2026-11-14T03:30:00.000Z');
 const records=normalise([elb(1,1,'TPC100-50251',[...site,own]),elb(2,2,'TPC101-50255',site),elb(3,3,'VPC13 - 76685',site)]);
 const entries=machineShifts(records,{assets,pulseBreakdowns:null});
 const byDoor=Object.fromEntries(entries.map(e=>[e.door,e]));
 assert.deepEqual(byDoor['TPC100-50251'].bdRequests.map(r=>r.reference),['OWN'],'its own request stays');
 assert.equal(byDoor['TPC100-50251'].bdMinutes,30);
 assert.deepEqual([byDoor['TPC101-50255'].bdRequests.length,byDoor['TPC101-50255'].bdMinutes],[0,0],'the site list is not put on every machine');
});

test('report with a Pulse read: a "-" registration or chassis does not match every request of the site',()=>{
 const records=normalise([elb(1,1,'TPC100-50251'),elb(2,2,'TPC101-50255')]);
 const pulseBreakdowns=[{ref:'A',site:'Gauri Pauni OC (2nd)',door:'',equipment:'',reg:'-',chassis:'-',start:'2026-11-14T02:00:00.000Z',end:'2026-11-14T03:00:00.000Z',status:'Restored',reason:'Site list'},
  {ref:'B',site:'Gauri Pauni OC (2nd)',door:'TPC101-50255',equipment:'',reg:'-',chassis:'-',start:'2026-11-14T04:00:00.000Z',end:'2026-11-14T05:00:00.000Z',status:'Restored',reason:'Own'}];
 const entries=machineShifts(records,{assets,pulseBreakdowns});
 const byDoor=Object.fromEntries(entries.map(e=>[e.door,e]));
 assert.deepEqual(byDoor['TPC100-50251'].bdRequests.map(r=>r.reference),[]);
 assert.deepEqual(byDoor['TPC101-50255'].bdRequests.map(r=>r.reference),['B']);
});

test('the report reads Pulse-II\'s stored copy of the breakdown list first, as the ELB saves do',()=>{
 const route=fs.readFileSync(new URL('../server/routes/log-book.mjs',import.meta.url),'utf8');
 assert.match(route,/readReportBreakdowns\(\(\)=>readBreakdownRows\(req\.session\.login\|\|req\.session\.name\)/);
});
