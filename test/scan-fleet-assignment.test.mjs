import {scanCardContextIssues} from '../scan-batch-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {scanFleetAssignment,scanFleetIssues,scanFleetSignature} from '../scan-fleet-assignment.mjs';
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
 assert.match(rejection.message,/Majri OC.*transfer.*Pulse.*recheck/);
 assert.equal(scanFleetAssignment(fleet.map(row=>row.door==='V1'?{...row,currentLocation:'Majri OC'}:row),draft),null);
});
test('unavailable, unreadable and ambiguous fleet checks block without authorizing deletion',()=>{
 for(const rows of [null,[]])assert.throws(()=>scanFleetAssignment(rows,{doorText:'V1',location:'Sasti OC'}),/unavailable/);
 assert.throws(()=>scanFleetAssignment(fleet,{doorText:'V',location:'Sasti OC'}),/readable/);
 assert.throws(()=>scanFleetAssignment([...fleet,fleet[0]],{doorText:'V1',location:'Sasti OC'}),/duplicate/);
});
test('fleet detection retains the original scan and draft until the user chooses a disposition',async()=>{
 const source=readFileSync(new URL('../bulk-card-scanning.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function enforceFleet('),source.indexOf(' function queueFleetCheck('));
 const card={id:'selected',batch_id:'batch',status:'review',revision:3,raw_fields:{},image_blob_key:'selected-image',draft:{doorText:'V1',location:'Majri OC'}};
 const updates=[];const pool={query:async(sql,args)=>{if(sql.startsWith('UPDATE'))updates.push({sql,args});return {rows:[]}}};
 const create=reader=>new Function('readPulseFleet','pool','scanFleetIssues','scanFleetSignature','encodeScanJson','scanCardContextIssues',`return (${fn});`)(reader,pool,scanFleetIssues,scanFleetSignature,value=>value,scanCardContextIssues);
 const review=await create(async()=>fleet)(card);assert.equal(review.issues[0].reason,'transfer-required');assert.equal(updates.length,1);assert.doesNotMatch(updates[0].sql,/image=NULL|draft=|status='rejected'/);assert.equal(JSON.parse(updates[0].args[1]).issues[0].door,'V1');
 const offline=await create(async()=>{throw Error('Pulse offline')})(card);assert.equal(offline.error,'Pulse offline');assert.equal(card.image_blob_key,'selected-image');assert.equal(card.draft.doorText,'V1');
 pool.query=async()=>({rows:[{expected_context:{bookDate:'2026-10-28',location:'Jayant OC',cardShift:'III'}}]});let fleetRead=false;assert.equal(await create(async()=>{fleetRead=true;return fleet})(card),null);assert.equal(fleetRead,false,'metadata mismatches remain in the mismatch queue');
});

test('all off-site trip and printed summary occurrences are highlighted once per equipment',()=>{
 const draft={doorText:'V1',location:'Sasti OC',trips:[{equipmentName:'V12'},{equipmentName:'V12'},{equipmentName:'V2'}],scanMachineSummary:[{equipmentName:'V12'}]};const issues=scanFleetIssues(fleet,draft);assert.equal(issues.length,1);assert.deepEqual(issues[0].fields,['trips.0.equipmentName','trips.1.equipmentName','scanMachineSummary.0.equipmentName']);assert.equal(issues[0].reason,'unknown-machine');
});
