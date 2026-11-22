import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCard} from '../server/rules/scan-extraction.mjs';
import {scanFieldIssues} from '../src/scan-field-review.mjs';
import {readingCellImages} from '../server/rules/trip-meter-ocr.mjs';
test('reading-table candidates override scrambled page text and require explicit review',()=>{
 const meterReadings=Object.fromEntries(Object.entries({openingKmr:'289417',closingKmr:'289465',openingHmr:'30511',closingHmr:'30518'}).map(([k,value])=>[k,{value,needsReview:true}]));
 const {draft,raw}=extractCard('KMR 999 1000\nHMR 50 60','vehicle',[],{meterReadings});
 assert.equal(Number(draft.closingKmr)-Number(draft.openingKmr),48);
 assert.equal(Number(draft.closingHmr)-Number(draft.openingHmr),7);
 for(const k of Object.keys(meterReadings))assert.match(scanFieldIssues(draft)[k],/Handwritten reading/);
 assert.equal(raw.meterReadings.openingKmr.value,'289417');
 assert.equal(scanFieldIssues({...draft,meterReviewFields:[]}).openingKmr,undefined);
});
test('wrong template is never cropped as a reading table',async()=>assert.deepEqual(await readingCellImages(Buffer.alloc(0),'Job Card'),{}));
// Since 23 Nov 2026 a card with no driver or operator says what happened to its Caliber ID (shared/caliber-id-check.mjs).
test('a card with no driver or operator says the Caliber ID was not read; a line that names the role follows the book type',()=>{
 for(const kind of ['vehicle','equipment'])assert.equal(scanFieldIssues({},kind).employeeId,'Caliber ID could not be read. Type the number from the card.');
 const raw={employeeCode:'3000',caliberCheck:{reason:'several',read:'3000',at:'Majri OC'}};
 assert.match(scanFieldIssues({location:'Majri OC'},'vehicle',raw).employeeId,/Choose the driver from the list\.$/);
 assert.match(scanFieldIssues({location:'Majri OC'},'equipment',raw).employeeId,/Choose the operator from the list\.$/);
});
test('scanned numeric C.ID resolves the full Employee Master ID without using handwritten name',()=>{
 const masters=[{id:42,master_name:'Employee master',record_data:{employeeId:'CMPL8311',employeeCode:'8311',name:'ANOOP SUNIL PAUL',site:'Sasti OC'}}];
 assert.equal(extractCard('Site: Sasti OC\nC.ID CMPL - 8311\nDRIVER NAME Unreadable','vehicle',masters).draft.employeeId,'42');
 assert.equal(extractCard('Site: Sasti OC\nDRIVER NAME Wrong text','vehicle',masters,{employeeCode:'8311'}).draft.employeeId,'42');
 assert.equal(extractCard('C.ID 9999','vehicle',masters).draft.employeeId,'');
});
