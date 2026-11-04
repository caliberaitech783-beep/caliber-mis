import test from 'node:test';
import assert from 'node:assert/strict';
import {fleetMachineSummary,fleetScannedCardTotal} from '../shared/fleet-reconciliation-summary.mjs';

test('machine summary includes the entire roster including zero-card assets',()=>{
 const rows=[
  {assetKey:'zero',site:'Sasti OC',date:'2026-11-04',shift:'S1',door:'V0',kind:'vehicle',name:'Dumper',model:'M1',cards:[]},
  {assetKey:'a',site:'Sasti OC',date:'2026-11-04',shift:'S1',door:'V1',kind:'vehicle',name:'Dumper',model:'M1',cards:[{id:1},{id:2}]},
  {assetKey:'b',site:'Sasti OC',date:'2026-11-04',shift:'S1',door:'V2',kind:'vehicle',name:'Dumper',model:'M1',cards:Array.from({length:38},(_,id)=>({id}))},
 ];
 assert.deepEqual(fleetMachineSummary(rows).map(row=>[row.door,row.scannedCards]),[['V0',0],['V1',2],['V2',38]]);
 assert.equal(fleetScannedCardTotal(rows),40);
});
