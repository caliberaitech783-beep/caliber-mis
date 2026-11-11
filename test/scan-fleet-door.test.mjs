import test from 'node:test';import assert from 'node:assert/strict';
import {extractCard} from '../server/rules/scan-extraction.mjs';
const master=(id,master_name,record_data)=>({id,master_name,record_data});
test('scanned fleet initials, Caliber ID, date and latest location work order resolve against masters',()=>{
 const masters=[master(1,'Equipment master',{door:'Scania 12',category:'vehicle',site:'Dhoptala OB'}),master(2,'Equipment master',{door:'Volvo 25',category:'equipment',site:'Dhoptala OB'}),master(3,'Employee master',{caliberId:'8311',employeeId:'legacy',name:'Anoop Sunil Paul',site:'Dhoptala OB'}),master(4,'Work order master',{site:'Dhoptala OB',workOrderDate:'2026-01-01'}),master(5,'Work Order master',{site:'Dhoptala OB',workOrderDate:'2026-09-01'}),master(6,'Work Order master',{site:'Other',workOrderDate:'2026-10-01'})];
 const text='TRIP CARD\nDATE 18/10/26\nSITE Dhoptala OB\nDOOR NO S12\nC.ID 8311\nDRIVER NAME Wrong OCR Name\nHMT (Hours) 30065 30071\nKMR (Kilometer) 281121 281179';
 const {draft}=extractCard(text,'vehicle',masters);assert.equal(draft.bookDate,'2026-10-18');assert.equal(draft.assetId,'1');assert.equal(draft.employeeId,'3');assert.equal(draft.workOrderId,'5');assert.deepEqual([draft.openingHmr,draft.closingHmr,draft.openingKmr,draft.closingKmr],['30065','30071','281121','281179']);
 assert.equal(extractCard(text.replace('S12','V25'),'equipment',masters).draft.assetId,'2');
 const duplicate=[...masters,master(7,'Equipment master',{door:'S12',category:'vehicle',site:'Dhoptala OB'})];assert.equal(extractCard(text,'vehicle',duplicate).draft.assetId,'');
 assert.equal(extractCard(text,'vehicle',[]).draft.employeeId,'');
});

test('linked equipment resolves padded fleet doors within location and type, without guessing duplicates',async()=>{
 const {linkedScanEquipment,fleetDoorKey}=await import('../shared/scan-fleet-door.mjs');
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

test('vehicle matching keeps exact three-digit doors and recovers one missing digit only within the site',async()=>{
 const {linkedScanEquipment}=await import('../shared/scan-fleet-door.mjs');
 const rows=[{id:'s134',door:'S134',kind:'vehicle',site:'Sasti OC'},{id:'s34-other',door:'S34',kind:'vehicle',site:'Jayant OC'},{id:'v833',door:'V833',kind:'vehicle',site:'Sasti OC'}];
 assert.equal(linkedScanEquipment(rows,'S/134','Sasti OC','vehicle')?.id,'s134');
 assert.equal(linkedScanEquipment(rows,'S/34','Sasti OC','vehicle')?.id,'s134');
 assert.equal(linkedScanEquipment(rows,'S/34','Jayant OC','vehicle')?.id,'s34-other');
 assert.equal(linkedScanEquipment([...rows,{id:'s234',door:'S234',kind:'vehicle',site:'Sasti OC'}],'S/34','Sasti OC','vehicle'),null);
 assert.equal(linkedScanEquipment(rows,'V/833','Sasti OC','vehicle')?.id,'v833');
});

test('automatic matching displays the exact canonical master door without changing digits',async()=>{
 const {canonicalLinkedScanDoor,linkedScanEquipment}=await import('../shared/scan-fleet-door.mjs');
 const rows=[{id:'s88',door:'S-88',kind:'vehicle',site:'Sasti OB'},{id:'s81',door:'S-81',kind:'vehicle',site:'Sasti OB'}];
 for(const written of ['S-88','S 88','S/88','s88']){
  const asset=linkedScanEquipment(rows,written,'Sasti OB','vehicle');
  assert.equal(asset?.id,'s88',written);assert.equal(canonicalLinkedScanDoor(asset,written),'S-88',written);
 }
 const recovered=linkedScanEquipment([{id:'s188',door:'S-188',kind:'vehicle',site:'Sasti OB'}],'S-88','Sasti OB','vehicle');
 assert.equal(recovered?.id,'s188');assert.equal(canonicalLinkedScanDoor(recovered,'S-88'),'S-88');
});

test('an exact scanned door wins over an old alias on another vehicle',async()=>{
 const {linkedScanEquipment}=await import('../shared/scan-fleet-door.mjs');
 const rows=[
  {id:'hp02',door:'HP-02',kind:'vehicle',site:'Sasti OC'},
  {id:'s102',door:'S-102',kind:'vehicle',site:'Sasti OC',cardAliases:['HP-02']},
 ];
 assert.equal(linkedScanEquipment(rows,'HP-02','Sasti OC','vehicle')?.id,'hp02');
});
