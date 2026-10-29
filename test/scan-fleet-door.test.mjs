import test from 'node:test';import assert from 'node:assert/strict';
import {extractCard} from '../scan-extraction.mjs';
const master=(id,master_name,record_data)=>({id,master_name,record_data});
test('scanned fleet initials, Caliber ID, date and latest location work order resolve against masters',()=>{
 const masters=[master(1,'Equipment master',{door:'Scania 12',category:'vehicle',site:'Dhoptala OB'}),master(2,'Equipment master',{door:'Volvo 25',category:'equipment',site:'Dhoptala OB'}),master(3,'Employee master',{caliberId:'8311',employeeId:'legacy',name:'Anoop Sunil Paul'}),master(4,'Work order master',{site:'Dhoptala OB',workOrderDate:'2026-01-01'}),master(5,'Work Order master',{site:'Dhoptala OB',workOrderDate:'2026-09-01'}),master(6,'Work Order master',{site:'Other',workOrderDate:'2026-10-01'})];
 const text='TRIP CARD\nDATE 18/10/26\nSITE Dhoptala OB\nDOOR NO S12\nC.ID 8311\nDRIVER NAME Wrong OCR Name\nHMT (Hours) 30065 30071\nKMR (Kilometer) 281121 281179';
 const {draft}=extractCard(text,'vehicle',masters);assert.equal(draft.bookDate,'2026-10-18');assert.equal(draft.assetId,'1');assert.equal(draft.employeeId,'3');assert.equal(draft.workOrderId,'5');assert.deepEqual([draft.openingHmr,draft.closingHmr,draft.openingKmr,draft.closingKmr],['30065','30071','281121','281179']);
 assert.equal(extractCard(text.replace('S12','V25'),'equipment',masters).draft.assetId,'2');
 const duplicate=[...masters,master(7,'Equipment master',{door:'S12',category:'vehicle',site:'Dhoptala OB'})];assert.equal(extractCard(text,'vehicle',duplicate).draft.assetId,'');
 assert.equal(extractCard(text,'vehicle',[]).draft.employeeId,'');
});

test('linked equipment resolves padded fleet doors within location and type, without guessing duplicates',async()=>{
 const {linkedScanEquipment,fleetDoorKey}=await import('../scan-fleet-door.mjs');
 const rows=[{id:'1',door:'Scania 1',kind:'vehicle',site:'Jayant OC'},{id:'2',door:'S01',kind:'vehicle',site:'Sasti OC'},{id:'3',door:'S/01',kind:'equipment',site:'Jayant OC'}];
 assert.equal(fleetDoorKey('S/01'),fleetDoorKey('Scania 1'));
 assert.equal(linkedScanEquipment(rows,'S/01','Jayant OC','vehicle').id,'1');
 assert.equal(linkedScanEquipment(rows,'S/01','Sasti OC','vehicle').id,'2');
 assert.equal(linkedScanEquipment(rows,'S/01','Unknown','vehicle'),null);
 assert.equal(linkedScanEquipment(rows,'S/01','','vehicle'),null);
 assert.equal(linkedScanEquipment([...rows,{...rows[0],id:'4'}],'S/01','Jayant OC','vehicle'),null);
 assert.equal(linkedScanEquipment(rows,'','Jayant OC','vehicle'),null);
 const extracted=extractCard('Site: Jayant OC\nDoor No: S/01','vehicle',[master(1,'Equipment master',{door:'Scania 1',category:'vehicle',site:'Jayant OC'})]);
 assert.equal(extracted.draft.assetId,'1');assert.equal(extracted.draft.doorText,'S/01');
});
