import test from 'node:test';import assert from 'node:assert/strict';import {extractCard} from '../scan-extraction.mjs';import {CARD_SHIFTS,markedShift,formatBookNumber,machineSummary,machineDiscrepancies,matchingWorkOrders,latestWorkOrder,interTripGap} from '../trip-card-rules.mjs';
const masters=[{id:1,master_name:'Equipment master',record_data:{equipmentName:'V189-2306675',category:'Vehicle',currentLocation:'Jayant OC'}},{id:2,master_name:'Employee master',record_data:{name:'MADAN PATEL',employeeId:'CMPL16560',employeeCode:'16560',site:'Jayant OC'}},{id:3,master_name:'Shift Master',record_data:{site:'Jayant OC',shiftName:'I',startTime:'05:00:00'}},{id:4,master_name:'Work Order master',record_data:{workOrderNo:'WO1',site:'Jayant OC'}}];
test('Trip Card labelled data maps IDs, marked shifts, tabular meters, trip rows and machine summary',()=>{const text='Site: Jayant OC\nDATE 13 10 26\nDoor No. V189 Caliber ID 16560 FORM A 2230\nSHIFT [x] I (05:00-01:00) [ ] II (01:00-09:00) [ ] III (09:00-05:00)\nHMR (Hours) 19345 19351\nKMR (Kilometer) 257263 257328\n1 25 08:20 08:40\n2 25 09:20 09:40\nMACHINE-WISE SUMMARY\n1 25 2';const d=extractCard(text,'vehicle',masters).draft;assert.equal(d.docType,'VLB');assert.equal(d.bookDate,'2026-10-13');assert.equal(d.bookDateSource,'scan');assert.equal(d.employeeId,'2');assert.equal(d.aFormNo,'2230');assert.equal(d.assetId,'1');assert.equal(d.cardShift,'I');assert.equal(d.shiftHours,8);assert.equal(d.shiftId,'3');assert.equal(d.workOrderId,'4');assert.equal(d.openingKmr,'257263');assert.equal(d.closingHmr,'19351');assert.equal(d.trips.length,2);assert.equal(d.trips[0].equipmentName,'V25');assert.deepEqual(machineDiscrepancies(d.trips,d.scanMachineSummary),[]);});
test('only marked shifts are inferred; daytime/nighttime is 12 hours and uncertain marks stay blank',()=>{assert.equal(markedShift('SHIFT [ ] I [ ] II [x] III'),'III');assert.equal(markedShift('SHIFT [ ] I [ ] II [ ] III'),'');assert.equal(markedShift('[x] I [x] II'),'');for(const name of ['Day','Night']){const d=extractCard('Shift: '+name,'vehicle',[]).draft;assert.equal(d.cardShift,name);assert.equal(d.shiftHours,12)}assert.equal(CARD_SHIFTS.II.hours,8)});
test('numbering, numeric equipment labels and per-location contract matching are deterministic',()=>{assert.equal(formatBookNumber('vehicle','2026-10-20',1,'I'),'CAL/VLB/201026/S1/0001');assert.equal(formatBookNumber('equipment','2026-10-20',1),'CAL/ELB/20-10-26/001');assert.deepEqual(machineSummary([{equipmentName:'25',tripCount:1},{equipmentName:'V25',tripCount:2}]),[{equipmentName:'V25',tripCount:3}]);assert.equal(machineDiscrepancies([{equipmentName:'25',tripCount:2}],[{equipmentName:'V25',tripCount:3}]).length,1);assert.equal(matchingWorkOrders([{site:'Jayant OC'},{site:'Sasti OC'}],'Jayant OB','2026-10-20').length,1)});

test('conflicting image and OCR marks do not select a shift',()=>{assert.equal(extractCard('SHIFT [x] I','vehicle',[],{cardShift:'III'}).draft.cardShift,'')});

test('Vehicle book numbers include the selected shift code, including Day and Night',()=>{for(const [shift,code] of [['I','S1'],['II','S2'],['III','S3'],['Day','D'],['Night','N']])assert.equal(formatBookNumber('vehicle','2026-10-20',1,shift),'CAL/VLB/201026/'+code+'/0001');assert.throws(()=>formatBookNumber('vehicle','2026-10-20',1,'Unknown'),/Select Shift/);});

test('latest workbook rules choose newest location contract, use inter-trip idle gap and combine machine columns',()=>{const orders=[{id:'old',site:'Sasti OC',workOrderDate:'2025-01-01'},{id:'new',site:'Sasti OC',workOrderDate:'2026-01-01'},{id:'other',site:'Jayant OC',workOrderDate:'2026-10-01'}];assert.equal(latestWorkOrder(orders,'Sasti OC','2026-10-21').id,'new');assert.equal(interTripGap([{unloadingTime:'10:10'},{loadingTime:'10:26'}],1),16);assert.equal(interTripGap([{loadingTime:'10:26'}],0),null);assert.equal(interTripGap([{unloadingTime:'23:50'},{loadingTime:'00:10'}],1),20);const d=extractCard('Site: Sasti OC\nShift [x] I (05:00-01:00)\n1 V 65 5\n2 T 88 6','vehicle',[]).draft;assert.equal(d.timeMode,'without');assert.deepEqual(d.trips.map(r=>[r.equipmentName,r.tripCount]),[['V65',5],['T88',6]]);});

test('M and No columns after the time columns combine into the equipment label',()=>{const d=extractCard('Site: Sasti OC\nTRIP DETAILS\n1 08:20 08:40 V 65\n2 10:26 10:40 T 88','vehicle',[]).draft;assert.equal(d.timeMode,'with');assert.deepEqual(d.trips.map(r=>r.equipmentName),['V65','T88']);});

test('scan shift labels and trip clocks follow each location master',async()=>{
 const {cardShiftLabel,selectedMasterShift,tripClockForShift}=await import('../trip-card-rules.mjs');
 const rows=[{id:'j',site:'Jayant OC',shiftName:'Shift B',startTime:'12:00:00',endTime:'20:00:00'},{id:'s',site:'Sasti OC',shiftName:'Shift B',startTime:'13:00:00',endTime:'21:00:00'}];
 assert.equal(cardShiftLabel(rows,'Jayant OC','II'),'II · 12:00–20:00');
 assert.equal(cardShiftLabel(rows,'Sasti OC','II'),'II · 13:00–21:00');
 assert.equal(tripClockForShift('12:10','II',selectedMasterShift(rows,'Jayant OC','II')),'12:10');
 assert.equal(tripClockForShift('08:10','II',selectedMasterShift(rows,'Jayant OC','II')),'08:10');
 assert.equal(tripClockForShift('08:10','II',selectedMasterShift(rows,'Sasti OC','II')),'20:10');
 assert.doesNotMatch(cardShiftLabel(rows,'Unknown','I'),/05:00/);
 const localMasters=masters.map(r=>r.master_name==='Shift Master'?{...r,record_data:{site:'Jayant OC',shiftName:'Shift C',startTime:'20:00:00',endTime:'04:00:00'}}:r);
 const draft=extractCard('Site: Jayant OC\nSHIFT [x] III\n1 V25 08:20 09:00','vehicle',localMasters).draft;
 assert.equal(draft.shiftId,'3');assert.equal(draft.trips[0].loadingTime,'20:20');
});

test('scan matches CMLL identifiers while preserving the written prefix and digits',()=>{
 const employees=[{id:20,master_name:'Employee master',record_data:{caliberId:'CMPL16560',name:'Driver',site:'Jayant OC'}}];
 for(const hints of [{},{employeeCode:'cmll16560'}]){const result=extractCard('Site: Jayant OC\nCaliber ID: CMLL16560','vehicle',employees,hints);assert.equal(result.raw.employeeCode,'CMLL16560');assert.equal(result.draft.employeeId,'20');}
 assert.equal(extractCard('Caliber ID: OTHER16560','vehicle',employees).raw.employeeCode,'OTHER16560');
});
test('explicit shift labels and provider variants match numeric and named location masters',async()=>{
 const {selectedMasterShift}=await import('../trip-card-rules.mjs');
 for(const value of ['II','Shift II','2','S2','B'])assert.equal(extractCard('Site: Jayant OC','vehicle',[],{cardShift:value}).draft.cardShift,'II');
 for(const value of ['Shift: II','Shift: 2','Shift: B','SHIFT [x] S2'])assert.equal(markedShift(value),'II');
 assert.equal(markedShift('SHIFT: I / II / III'),'');
 const rows=[{id:'inactive',site:'Jayant OC',shiftCode:'2',status:'Inactive'},{id:'active',site:'Jayant OC',shiftCode:'2',name:'Second shift',startTime:'12:00'}];
 assert.equal(selectedMasterShift(rows,'Jayant OC','II').id,'active');
 assert.equal(selectedMasterShift([{id:'b',site:'Jayant OC',shiftCode:'custom',name:'Shift B'}],'Jayant OC','II').id,'b');
 assert.equal(selectedMasterShift([...rows,{...rows[1],id:'duplicate'}],'Jayant OC','II'),null);
 assert.equal(selectedMasterShift(rows,'Sasti OC','II'),null);
});

test('Dudhichua East scanned Shift I links equivalent seed and Pulse shifts and follows card-date revisions',async()=>{
 const {selectedMasterShift,cardShiftLabel}=await import('../trip-card-rules.mjs');
 const seed={id:'10',site:'Dudhichua East OC',shiftName:'Shift A',shiftCode:'A',startTime:'05:00:00',endTime:'13:00:00'};
 const imported={...seed,id:'20',shiftName:'I',shiftCode:'I',startTime:'05:00',endTime:'13:00'};
 const rows=[imported,seed];
 assert.equal(selectedMasterShift(rows,seed.site,'I','2026-10-28').id,'10');
 assert.equal(cardShiftLabel(rows,seed.site,'I','2026-10-28'),'I · 05:00–13:00');
 const draft=extractCard('Site: Dudhichua East OC\nDate: 28/10/26\nShift: I','vehicle',rows.map(r=>({id:r.id,master_name:'Shift Master',record_data:r}))).draft;
 assert.equal(draft.shiftId,'10');
 const revision={...seed,id:'30',effectiveFrom:'2026-10-01',effectiveTo:'2026-10-31',startTime:'06:00',endTime:'14:00'};
 assert.equal(selectedMasterShift([...rows,revision],seed.site,'I','2026-10-28').id,'30');
 assert.equal(selectedMasterShift([...rows,revision],seed.site,'I','2026-09-28').id,'10');
 assert.equal(selectedMasterShift([...rows,{...seed,id:'40',startTime:'04:00'}],seed.site,'I','2026-10-28'),null);
 assert.equal(selectedMasterShift(rows,'Dudhichua OC','I','2026-10-28'),null);
});
