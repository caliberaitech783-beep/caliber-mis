import {scanCardContextIssues} from '../shared/scan-batch-context.mjs';
import {attachTransferHistory,assetForSiteOnDate} from '../shared/equipment-transfer-history.mjs';
import {fleetDoorKey} from '../shared/scan-fleet-door.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {scanFleetAssignment,scanFleetIssues,scanFleetSignature} from '../shared/scan-fleet-assignment.mjs';
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
test('a serial suffix distinguishes duplicate TPC short codes',()=>{
 const rows=[
  {door:'TPC63 - 05017',kind:'equipment',currentLocation:'Jayant OB'},
  {door:'TPC63 - 99999',kind:'equipment',currentLocation:'Other OB'},
 ];
 assert.equal(scanFleetAssignment(rows,{doorText:'T63 - 05017',location:'Jayant OB'},{},'','equipment'),null);
 assert.equal(scanFleetAssignment(rows,{doorText:'T63',location:'Jayant OB'},{},'','equipment'),null);
 assert.equal(scanFleetAssignment(rows,{doorText:'T63 - 99999',location:'Jayant OB'},{},'','equipment').reason,'transfer-required');
 assert.equal(scanFleetAssignment(rows.slice(0,1),{doorText:'T63 - 12345',location:'Jayant OB'},{},'','equipment').reason,'unknown-machine');
});
test('repeated TPC22 trips and summary use the unique equipment at the batch site',()=>{
 const majri={door:'TPC22 - 12345',currentLocation:'Majri OC'};
 const rows=[...fleet,{door:'TPC22 - 67890',currentLocation:'Sasti OB'},majri];
 const draft={location:'majri ob',trips:[{equipmentName:'TPC22'},{equipmentName:'TPC22'}],scanMachineSummary:[{equipmentName:'TPC22',trips:2}]};
 assert.deepEqual(scanFleetIssues(rows,draft),[]);
 assert.throws(()=>scanFleetIssues([...rows,{...majri,door:'TPC22 - 54321'}],draft),/duplicate.*TPC22/);
 const [issue]=scanFleetIssues(rows.slice(0,-1),draft);
 assert.equal(issue.reason,'transfer-required');
 assert.deepEqual(issue.fields,['trips.0.equipmentName','trips.1.equipmentName','scanMachineSummary.0.equipmentName']);
});
test('Majri VPC29 trips ignore the separate V29 vehicle at the same site',()=>{
 const vehicle={id:29,door:'V29',category:'Vehicle',currentLocation:'Majri OB'};
 const loader={id:129,door:'VPC29',category:'Equipment',currentLocation:'Majri OC'};
 const draft={doorText:'V29',location:'majri ob',trips:[{equipmentName:'VPC29'},{equipmentName:'VPC29'}],scanMachineSummary:[{equipmentName:'VPC29',tripCount:2}]};
 assert.deepEqual(scanFleetIssues([vehicle,loader],draft),[]);
 const [issue]=scanFleetIssues([vehicle],draft);
 assert.equal(issue.reason,'unknown-machine');
 assert.deepEqual(issue.fields,['trips.0.equipmentName','trips.1.equipmentName','scanMachineSummary.0.equipmentName']);
 assert.throws(()=>scanFleetIssues([vehicle,loader,{...loader,id:130}],draft),/duplicate.*VPC29/);
});
test('a real DEMO door wins over an obsolete alias on a different DEMO machine',()=>{
 const rows=[
  {id:352187,door:'DEMO19-15295',cardAliases:['DE25'],category:'Equipment',currentLocation:'Sasti OC'},
  {id:364025,door:'DEMO25-49001',category:'Equipment',currentLocation:'Sasti OC'},
 ];
 const draft={location:'Sasti OC',trips:[{equipmentName:'DE25'}],scanMachineSummary:[{equipmentName:'DEMO25'}]};
 assert.deepEqual(scanFleetIssues(rows,draft),[]);
 assert.equal(scanFleetAssignment(rows,{doorText:'DE25',location:'Sasti OC'},{},'','equipment'),null);
});
test('changing the selected equipment serial invalidates the previous fleet check',()=>{
 const draft={location:'Majri OB',trips:[{equipmentName:'VPC29 - 111'}]};
 assert.notEqual(scanFleetSignature(draft),scanFleetSignature({...draft,trips:[{equipmentName:'VPC29 - 222'}]}));
});
test('fleet detection retains the original scan and draft until the user chooses a disposition',async()=>{
 const source=readFileSync(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function enforceFleet('),source.indexOf(' function queueFleetCheck('));
 const card={id:'selected',batch_id:'batch',status:'review',revision:3,raw_fields:{},image_blob_key:'selected-image',draft:{doorText:'V1',location:'Majri OC'}};
 const updates=[];const pool={query:async(sql,args)=>{if(sql.startsWith('UPDATE'))updates.push({sql,args});return {rows:[]}}};
 const create=reader=>new Function('readPulseFleet','pool','scanFleetIssues','scanFleetSignature','encodeScanJson','scanCardContextIssues','MASTER_SQL','attachTransferHistory','assetForSiteOnDate','fleetDoorKey',`return (${fn});`)(reader,pool,scanFleetIssues,scanFleetSignature,value=>value,scanCardContextIssues,'SELECT masters',attachTransferHistory,assetForSiteOnDate,fleetDoorKey);
 const review=await create(async()=>fleet)(card);assert.equal(review.issues[0].reason,'transfer-required');assert.equal(updates.length,1);assert.doesNotMatch(updates[0].sql,/image=NULL|draft=|status='rejected'/);assert.equal(JSON.parse(updates[0].args[1]).issues[0].door,'V1');
 const offline=await create(async()=>{throw Error('Pulse offline')})(card);assert.equal(offline.error,'Pulse offline');assert.equal(card.image_blob_key,'selected-image');assert.equal(card.draft.doorText,'V1');
 pool.query=async()=>({rows:[{expected_context:{bookDate:'2026-10-28',location:'Jayant OC',cardShift:'III'}}]});let fleetRead=false;const checked=await create(async()=>{fleetRead=true;return fleet})(card);assert.equal(fleetRead,true,'a card whose handwritten site differs is still checked against the batch site');assert.equal(checked.signature,scanFleetSignature({...card.draft,location:'Jayant OC',bookDate:'2026-10-28'}));
 const transferred={id:1,record_data:{door:'V1',currentLocation:'Sasti OC'}};
 const history={record_data:{equipmentMasterId:'1',source:'Majri OC',destination:'Sasti OC',transferDate:'2026-11-12',status:'Completed'}};
 let day='2026-11-12';pool.query=async sql=>({rows:sql.startsWith('SELECT expected_context')?[{expected_context:{bookDate:day,location:'Majri OC'}}]:sql==='SELECT masters'?[{...transferred,master_name:'Equipment master'},{...history,master_name:'Vehicle transfers'}]:[]});
 assert.deepEqual((await create(async()=>fleet)(card)).issues,[],'scan accepts source on transfer date');
 day='2026-11-13';assert.equal((await create(async()=>fleet)(card)).issues[0].reason,'transfer-required','scan rejects source after transfer date');
});

test('all off-site trip and printed summary occurrences are highlighted once per equipment',()=>{
 const draft={doorText:'V1',location:'Sasti OC',trips:[{equipmentName:'V12'},{equipmentName:'V12'},{equipmentName:'V2'}],scanMachineSummary:[{equipmentName:'V12'}]};const issues=scanFleetIssues(fleet,draft);assert.equal(issues.length,1);assert.deepEqual(issues[0].fields,['trips.0.equipmentName','trips.1.equipmentName','scanMachineSummary.0.equipmentName']);assert.equal(issues[0].reason,'unknown-machine');
});

test('duplicate equipment review identifies the card row and matching Pulse records',()=>{
 const rows=[
  {id:21,door:'VPC28 - 111',currentLocation:'Majri OB'},
  {id:42,door:'VPC28 - 222',currentLocation:'Majri OC'},
 ];
 const draft={location:'Majri OB',scanMachineSummary:[{equipmentName:'VPC28'}]};
 assert.throws(()=>scanFleetIssues(rows,draft),/Machine-wise summary, row 1.*VPC28.*VPC28 - 111 \(Majri OB, record 21\).*VPC28 - 222 \(Majri OC, record 42\)/);
 const corrected={...draft,scanMachineSummary:[{equipmentName:'VPC28 - 111'}]};
 assert.notEqual(scanFleetSignature(draft),scanFleetSignature(corrected));
 assert.deepEqual(scanFleetIssues(rows,corrected),[]);
});
