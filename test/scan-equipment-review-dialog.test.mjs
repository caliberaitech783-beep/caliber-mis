import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
test('the Equipment review button opens its dialog even while the batch context gate is blocked',()=>{
 assert.match(source,/onClick=\{\(\)=>setFleetOpenId\(card\.id\)\}>Equipment review</);
 assert.match(source,/\{fleetDialogCard&&<ApplicationErrorBoundary compact[\s\S]{0,400}?><ScanEquipmentReviewDialog /,'the equipment review dialog opens inside its own error boundary');
});
