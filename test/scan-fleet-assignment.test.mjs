import {scanCardContextIssues} from '../scan-batch-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {scanFleetAssignment} from '../scan-fleet-assignment.mjs';
import {readFileSync} from 'node:fs';
const fleet=Array.from({length:10},(_,i)=>({id:i+1,door:'V'+(i+1),currentLocation:'Sasti OC'}));
test('only machines currently assigned to the mine are accepted; fleet count is not a quota',()=>{
 assert.equal(scanFleetAssignment(fleet,{doorText:'V1',location:'Sasti OB'}),null);
 const missing=scanFleetAssignment(fleet,{doorText:'V11',location:'Sasti OC'});
 assert.equal(missing.reason,'unknown-machine');assert.match(missing.message,/register|Register/);
 assert.equal(scanFleetAssignment([...fleet,{door:'V11',currentLocation:'Sasti OC'}],{doorText:'V11',location:'Sasti OC'}),null);
});
test('transfer must be reflected in Pulse before a fresh card can be accepted',()=>{
 const draft={doorText:'V1',location:'Majri OC'};
 const rejection=scanFleetAssignment(fleet,draft);
 assert.equal(rejection.reason,'transfer-required');assert.equal(rejection.pulseSite,'Sasti OC');
 assert.match(rejection.message,/Majri OC.*transfer.*Pulse.*upload this card again/);
 assert.equal(scanFleetAssignment(fleet.map(row=>row.door==='V1'?{...row,currentLocation:'Majri OC'}:row),draft),null);
});
test('unavailable, unreadable and ambiguous fleet checks block without authorizing deletion',()=>{
 for(const rows of [null,[]])assert.throws(()=>scanFleetAssignment(rows,{doorText:'V1',location:'Sasti OC'}),/unavailable/);
 assert.throws(()=>scanFleetAssignment(fleet,{doorText:'V',location:'Sasti OC'}),/readable/);
 assert.throws(()=>scanFleetAssignment([...fleet,fleet[0]],{doorText:'V1',location:'Sasti OC'}),/duplicate/);
});
test('confirmed wrong-site rejection deletes only the selected image and draft; an outage deletes nothing',async()=>{
 const source=readFileSync(new URL('../bulk-card-scanning.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function enforceFleet('),source.indexOf(' async function requireFleet('));
 const card={id:'selected',status:'review',revision:3,raw_fields:{},image_blob_key:'selected-image',draft:{doorText:'V1',location:'Majri OC'}};
 const sibling={id:'other',draft:{doorText:'V2',location:'Sasti OC'}};
 let updates=[],removed=[];
 const client={query:async(sql,args)=>{if(sql.startsWith('UPDATE mis_scan_cards'))updates.push({sql,args});return {rows:[]}},release(){}};
 const pool={query:async()=>({rows:[]}),connect:async()=>client};
 const fail=(message,status)=>{throw Object.assign(Error(message),{status})};
 const create=readPulseFleet=>new Function('readPulseFleet','pool','getCard','imageStorage','scanFleetAssignment','fail','scanCardContextIssues',`return (${fn});`)(readPulseFleet,pool,async()=>card,{remove:async key=>removed.push(key)},scanFleetAssignment,fail,scanCardContextIssues);
 const rejection=await create(async()=>fleet)(card);
 assert.equal(rejection.reason,'transfer-required');assert.deepEqual(removed,['selected-image']);
 assert.equal(updates.length,1);assert.equal(updates[0].args[0],card.id);
 assert.match(updates[0].sql,/image=NULL.*raw_fields=.*draft='\{\}'::jsonb.*WHERE id=\$1/);
 assert.deepEqual(sibling,{id:'other',draft:{doorText:'V2',location:'Sasti OC'}});
 updates=[];removed=[];
 await assert.rejects(()=>create(async()=>{throw Error('Pulse offline')})(card),/Pulse offline/);
 assert.deepEqual(updates,[]);assert.deepEqual(removed,[]);
 pool.query=async()=>({rows:[{expected_context:{bookDate:'2026-10-28',location:'Jayant OC',cardShift:'III'}}]});
 let fleetRead=false;
 assert.equal(await create(async()=>{fleetRead=true;return fleet})(card),null);
 assert.equal(fleetRead,false,'header mismatch must wait for user deletion, not fleet enforcement');
 assert.deepEqual(updates,[]);assert.deepEqual(removed,[]);
});
