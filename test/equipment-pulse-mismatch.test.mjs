import test from 'node:test';
import assert from 'node:assert/strict';
import {compareEquipmentWithPulse,equipmentMismatchMessage} from '../shared/equipment-pulse-mismatch.mjs';

const locations=['Sasti OC','Majri OC'];
const pulse=[
 {id:1,door:'EX-01',chassis:'CH1',group:'Excavator',currentLocation:'Sasti'},
 {id:2,door:'EX-02',chassis:'CH2',group:'Excavator',currentLocation:'Sasti'},
 {id:3,door:'DZ-01',chassis:'CH3',group:'Dozer',currentLocation:'Majri'},
 {id:4,door:'WT-01',chassis:'CH4',group:'Water Tanker',currentLocation:'Majri'},
 {id:9,door:'XX-01',chassis:'CH9',group:'Excavator',currentLocation:'Workshop Nagpur'},
];

test('identical lists match, whatever the site spelling',()=>{
 const local=pulse.map(({id,...row})=>({...row,pulseId:String(id),currentLocation:row.currentLocation==='Sasti'?'Sasti OC':row.currentLocation}));
 const result=compareEquipmentWithPulse({localAssets:local,pulseAssets:pulse,locations});
 assert.equal(result.matches,true);
 assert.deepEqual([result.pulseIITotal,result.pulseTotal],[4,4]);
 assert.match(equipmentMismatchMessage(result),/match \(4 machines\)/);
});

test('reports machines missing on either side, moved to another site, or in another group',()=>{
 const local=[
  {pulseId:'1',door:'EX-01',chassis:'CH1',group:'Excavator',currentLocation:'Majri OC'},
  {door:'EX-02',chassis:'ch-2',group:'Payloader',currentLocation:'Sasti OC'},
  {pulseId:'4',door:'WT-01',chassis:'CH4',group:'Water Tanker',currentLocation:'Majri OC'},
  {door:'NEW-7',chassis:'CH7',group:'Drill',currentLocation:'Sasti OC'},
  {door:'OLD-1',chassis:'CH8',group:'Drill',currentLocation:'Sasti OC',sourceMissing:true},
 ];
 const result=compareEquipmentWithPulse({localAssets:local,pulseAssets:pulse,locations});
 assert.equal(result.matches,false);
 assert.deepEqual(result.machines.map(m=>[m.kind,m.door]),[
  ['missing-in-pulse-ii','DZ-01'],['missing-in-pulse','NEW-7'],['site-differs','EX-01'],['group-differs','EX-02']]);
 assert.deepEqual(result.byKind,{'missing-in-pulse-ii':1,'missing-in-pulse':1,'site-differs':1,'group-differs':1});
 const count=(equipment,site)=>result.counts.find(row=>row.equipment===equipment&&row.site===site);
 assert.deepEqual([count('Excavator','Sasti OC').pulseII,count('Excavator','Sasti OC').pulse],[0,2]);
 assert.equal(count('Excavator','Majri OC').difference,1);
 assert.equal(count('Dozer','Majri OC').difference,-1);
 assert.equal(count('Water Tanker','Majri OC'),undefined);
 const message=equipmentMismatchMessage(result,{limit:2,checkedAt:'11-11-2026 21:40'});
 assert.match(message,/Pulse-II 4 machines, Pulse 4 machines/);
 assert.match(message,/and 2 more/);
 assert.match(message,/Checked 11-11-2026 21:40\./);
});

test('one Pulse-II record is never matched to two Pulse records',()=>{
 const result=compareEquipmentWithPulse({localAssets:[{door:'EX-01',group:'Excavator',currentLocation:'Sasti OC'}],
  pulseAssets:[{id:1,door:'EX-01',group:'Excavator',currentLocation:'Sasti'},{id:2,door:'EX-01',group:'Excavator',currentLocation:'Sasti'}],locations});
 assert.deepEqual(result.machines.map(m=>m.kind),['missing-in-pulse-ii']);
});
