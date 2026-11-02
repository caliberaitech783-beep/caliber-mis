import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
test('the Equipment review button opens its dialog even while the batch context gate is blocked',()=>{
 assert.match(source,/onClick=\{\(\)=>setFleetOpenId\(card\.id\)\}>Equipment review</);
 assert.match(source,/\{fleetDialogCard&&<ApplicationErrorBoundary compact[\s\S]{0,400}?><ScanEquipmentReviewDialog /,'the equipment review dialog opens inside its own error boundary');
});
const dialog=readFileSync(new URL('../src/scan-equipment-review-dialog.jsx',import.meta.url),'utf8');
test('the equipment review dialog is not frozen by the shared autosave busy flag',()=>{
 assert.match(source,/<ScanEquipmentReviewDialog [^>]*busy=\{fleetBusy\}/,'the dialog follows its own fleetBusy flag, not the batch-wide busy flag that autosave holds');
 assert.match(source,/const resolveFleet=async\(card,action\)=>\{[^\n]*setFleetBusy\(true\)/,'fleet actions set fleetBusy');
 assert.doesNotMatch(source,/const resolveFleet=async\(card,action\)=>\{[^\n]*setBusy\(true\)/,'fleet actions do not touch the batch-wide busy flag');
 assert.match(dialog,/<button type="button" onClick=\{onReview\}>Review highlighted card</,'Review highlighted card is never disabled');
});
test('the equipment review dialog has a close button that keeps the card on hold',()=>{
 assert.match(dialog,/className="scan-equipment-close" aria-label="Close"[^>]*onClick=\{onClose\}/);
 assert.match(dialog,/onCancel=\{event=>\{event\.preventDefault\(\);onClose\(\)\}\}/,'Escape closes the dialog too');
 assert.match(source,/onClose=\{\(\)=>closeFleetDialog\(fleetDialogCard\)\}/);
 assert.match(source,/const closeFleetDialog=card=>\{setFleetOpenId\(''\);setFleetDismissed\(keys=>new Set\(\[\.\.\.keys,fleetReviewKey\(card\)\]\)\);\}/,'closing dismisses the prompt so it does not reopen at once');
});
