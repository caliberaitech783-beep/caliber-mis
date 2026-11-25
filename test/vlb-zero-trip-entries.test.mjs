import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vlbZeroTripEntries,readVlbZeroTripEntries} from '../shared/vlb-zero-trip-entries.mjs';

const batch={site:'Jayant OC',report_date:'2026-11-21',shift:'S2'};
const row=(over={})=>({date:'2026-11-21',site:'Jayant OC',shift:'S2',employee_id:'11',asset_id:'21',reason:'No vehicle available',remarks:'',recorded_by:'mis1',
 employee:{name:'Ramesh',employeeCode:'CMLL1001'},asset:{door:'T-07',equipmentName:'Tipper'},...over});

test('a Present — 0 trips entry of the batch site, date and shift is listed with 0 trips',()=>{
 const [entry,...rest]=vlbZeroTripEntries([row(),row({employee_id:'12',shift:'S1'}),row({employee_id:'13',date:'2026-11-22'}),row({employee_id:'14',site:'Sasti OC'})],batch);
 assert.equal(rest.length,0);
 assert.deepEqual({name:entry.employeeName,id:entry.caliberId,door:entry.door,trips:entry.trips,reason:entry.reason,by:entry.recordedBy},
  {name:'Ramesh',id:'CMLL1001',door:'T-07',trips:0,reason:'No vehicle available',by:'mis1'});
});

test('the shift is matched by its code whatever the label, and a missing vehicle stays empty',()=>{
 const entries=vlbZeroTripEntries([row({shift:'II',asset_id:null,asset:null})],{...batch,shift:'Shift B'});
 assert.equal(entries.length,1);assert.equal(entries[0].door,'');
});

test('the reader reads vehicle entries of the batch date and skips a database without the table',async()=>{
 const calls=[];
 const client={query:async(sql,params)=>{calls.push({sql,params});return /to_regclass/.test(sql)?{rows:[{name:'mis_shift_attendance'}]}:{rows:[row()]}}};
 assert.equal((await readVlbZeroTripEntries(client,batch)).length,1);
 assert.match(calls[1].sql,/kind='vehicle'/);assert.deepEqual(calls[1].params,['2026-11-21']);
 assert.deepEqual(await readVlbZeroTripEntries({query:async()=>({rows:[{name:null}]})},batch),[]);
});

test('the VLB batch page returns the entries and VLB Reports shows them',()=>{
 assert.match(readFileSync(new URL('../server/routes/vlb-batches.mjs',import.meta.url),'utf8'),/zeroTripEntries=await readVlbZeroTripEntries\(client,batch\)[\s\S]*records,lmvRecords,zeroTripEntries,/);
 const ui=readFileSync(new URL('../src/vlb-batch-reports.jsx',import.meta.url),'utf8');
 assert.match(ui,/batch\?\.zeroTripEntries/);assert.match(ui,/'Present — 0 trips · '\+batch\.name/);
});
