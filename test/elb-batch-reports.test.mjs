import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';

const source=readFileSync(new URL('../src/elb-batch-reports.jsx',import.meta.url),'utf8');
const stripped=source.replace(/^import .*;\r?\n/gm,'').replace('export default function','function').replaceAll('export const ','const ').replaceAll('export function ','function ');
const {code}=await transformWithOxc(stripped,'elb-batch-reports.jsx',{jsx:{runtime:'classic'}});
const {elbBatchRows,elbBatchStatus,ELB_BATCH_COLUMNS}=new Function('React','useEffect','useMemo','useState','SmartSelect',code+';return {elbBatchRows,elbBatchStatus,ELB_BATCH_COLUMNS}')({},()=>{},()=>{},()=>{},'select');

test('ELB report uses operational batch links and includes the complete saved front-page data',()=>{
 const batch={closed_at:'2026-11-03',fleet:[{assetId:'7',door:'D-07',equipmentName:'Dozer',trips:5}],elbRecords:[{id:3,book_no:'ELB-3',asset_id:7,created_by:'alice',data:{employeeName:'Ramesh',caliberId:'C5',openingHmr:100,closingHmr:104,totalWorkingHmr:4,breakdownHours:1,idleHours:3,availabilityHours:4,jobCardNo:'JC-9',remark:'Service'}}]};
 assert.equal(elbBatchStatus(batch),'ELB locked · Batch closed');
 const row=elbBatchRows(batch)[0];assert.equal(row.door,'D-07');assert.equal(row.tripCount,5);assert.equal(row.operator,'Ramesh');assert.equal(row.jobCardNo,'JC-9');assert.equal(row.entrySource,'Manual');
 for(const label of ['VLB trips','Operator','Caliber ID','Opening HMR','Closing HMR','Working HMR','BD hours','Idle hours','Availability hours','Job card','Remarks','Entry source','Saved by'])assert.ok(ELB_BATCH_COLUMNS.some(column=>column.label===label),label);
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');assert.match(main,/renderedActive==='ELB Reports'.*ElbBatchReports/);assert.doesNotMatch(main,/renderedActive==='Saved ELB'/);
});
