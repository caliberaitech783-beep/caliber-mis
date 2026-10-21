import test from 'node:test';import assert from 'node:assert/strict';import{createCanvas}from'@napi-rs/canvas';
import{cleanHandwrittenField,recognizeHandwrittenCard}from'../handwritten-card-ocr.mjs';import{readingCellImages}from'../trip-meter-ocr.mjs';import{mergeReextractedDraft}from'../scan-reextract.mjs';import{matchScannedSite}from'../scan-site-match.mjs';import{scanFieldIssues}from'../src/scan-field-review.mjs';
test('handwriting parsing handles spaces and terminal punctuation but never guesses ambiguous digits',()=>{
 assert.equal(cleanHandwrittenField('openingHmr','30048 :'),'30048');assert.equal(cleanHandwrittenField('employeeCode','1 87 64'),'18764');
 assert.equal(cleanHandwrittenField('openingKmr','2QLL 2 1'),'');assert.equal(cleanHandwrittenField('closingHmr','3168Y.'),'');
 assert.equal(cleanHandwrittenField('bookDate','18 10 26'),'2026-10-18');assert.equal(cleanHandwrittenField('bookDate','31 02 26'),'');
});
test('reading cells work for Dhoptala instead of being restricted to Jayant',async()=>{
 const c=createCanvas(1200,1600),x=c.getContext('2d');x.fillStyle='#777';x.fillRect(0,0,1200,1600);x.fillStyle='white';x.fillRect(250,0,700,1000);x.fillStyle='blue';x.font='24px Arial';x.fillText('12345',250+700*.18,700*.335);
 const cells=await readingCellImages(c.toBuffer('image/png'),'DHOPTALA READING OPENING CLOSING');assert.ok(cells.openingHmr);assert.ok((await readingCellImages(c.toBuffer('image/png'),'DHOPTALA READING OPENING CLOSING',{tight:false})).openingHmr);
 const r=await recognizeHandwrittenCard(c.toBuffer('image/png'),'DHOPTALA READING OPENING CLOSING',{recognize:async()=>[{generated_text:'12345'}]});assert.equal(r.fields.openingHmr,'12345');
 let n=0;const conflict=await recognizeHandwrittenCard(c.toBuffer('image/png'),'DHOPTALA READING OPENING CLOSING',{recognize:async()=>[{generated_text:++n%2?'12345':'12346'}]});assert.equal(conflict.fields.openingHmr,undefined);assert.equal(conflict.candidates.openingHmr.conflict,true);
});
test('re-extraction fills empty fields and updates machine-read values while preserving manual edits',()=>{
 const prior={openingKmr:'999',closingKmr:'1010',bookDate:'2026-10-21',bookDateSource:'system-fallback',remark:'Checked original'};
 const result=mergeReextractedDraft(prior,{openingKmr:'999'},{openingKmr:'1000',closingKmr:'1020',bookDate:'2026-10-18',bookDateSource:'scan',meterReviewFields:['openingKmr','closingKmr']});
 assert.equal(result.openingKmr,'1000');assert.equal(result.closingKmr,'1010');assert.equal(result.bookDate,'2026-10-18');assert.equal(result.remark,'Checked original');assert.deepEqual(result.meterReviewFields,['openingKmr']);
});
test('site matching accepts a unique small OCR error but rejects ambiguous master matches',()=>{
 assert.equal(matchScannedSite(['DHOPTASA or','DHOPTALA OF'],['Dhoptala OC (2nd)','Jayant OC']),'Dhoptala OC (2nd)');
 assert.equal(matchScannedSite(['MINEA'],['MINEB','MINEC']),'');
});
test('scan review distinguishes missing master data from unreadable data',()=>{
 const issues=scanFieldIssues({},'vehicle',{door:'S03',employeeCode:'18764'},{assets:[],employees:[],shifts:[],workOrders:[]});assert.match(issues.assetId,/Equipment Master is empty/);assert.match(issues.employeeId,/Employee Master is empty/);
 const matched=scanFieldIssues({},'vehicle',{door:'S03'},{assets:[{id:'1'}],employees:[],shifts:[],workOrders:[]});assert.match(matched.assetId,/Scan reads S03/);
});
