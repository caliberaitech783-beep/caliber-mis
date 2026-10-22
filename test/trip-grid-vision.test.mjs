import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {cleanTripCell,resolveTripGrid} from '../trip-row-vision.mjs';
import {readingCellImages} from '../trip-meter-ocr.mjs';
import {extractCard} from '../scan-extraction.mjs';
import {normalizeLogBook} from '../log-book.mjs';
import {machineDiscrepancies} from '../trip-card-rules.mjs';
const blank=()=>({present:false,value:''});
const cell=value=>({present:true,value});
const row=(n,type,no)=>({rowNumber:n,equipmentType:type,equipmentNo:no,loading:cell('08:20'),unloading:cell('08:40')});
test('scanned dates never silently become the current system date',()=>{
 const read=extractCard('TRIP CARD\nDATE 18/10/26','vehicle');
 assert.equal(read.draft.bookDate,'2026-10-18');
 for(const text of ['TRIP CARD','TRIP CARD\nDATE 31/02/26']){
  const {draft}=extractCard(text,'vehicle');assert.equal(draft.bookDate,'');assert.equal(draft.bookDateSource,'scan-unreadable');
  assert.throws(()=>normalizeLogBook('vehicle',draft),/Book Date from the scanned card/);
 }
 const conflict=extractCard('DATE 18/10/26','vehicle',[],{handwritingCandidates:{bookDate:{conflict:true}}});assert.equal(conflict.draft.bookDate,'');
});
test('grid carries only genuinely blank equipment cells and reconciles summary counts',()=>{
 const grid={rows:[row(1,cell('V'),cell('19')),row(2,blank(),blank()),row(3,blank(),{present:true,value:''})],summary:[{rowNumber:1,equipmentType:cell('V'),equipmentNo:cell('19'),count:cell('2')}]};
 const result=resolveTripGrid(grid,'');assert.deepEqual(result.trips.map(t=>t.equipmentName),['V19','V19','']);assert.ok(result.issues.some(s=>s.includes('Trip 3')));
 assert.deepEqual(machineDiscrepancies(result.trips.slice(0,2),result.scanMachineSummary),[]);
 assert.ok(machineDiscrepancies(result.trips.slice(0,1),result.scanMachineSummary).length);
});
test('numeric equipment without a type stays unresolved for human review',()=>{
 const r=resolveTripGrid({rows:[row(1,blank(),cell('875'))],summary:[]},'');assert.equal(r.trips[0].equipmentName,'');assert.ok(r.issues.length);
 assert.equal(cleanTripCell('time','08:75'),'');assert.equal(cleanTripCell('number','2B9'),'');assert.equal(cleanTripCell('time','8.20'),'08:20');
});
test('standard printed grid anchors locate readings even when the title OCR fails',async()=>{
 const c=createCanvas(1200,1600),x=c.getContext('2d');x.fillStyle='#777';x.fillRect(0,0,1200,1600);x.fillStyle='white';x.fillRect(250,0,700,1000);x.fillStyle='blue';x.font='24px Arial';x.fillText('30511',380,234);
 const bytes=c.toBuffer('image/png');assert.ok((await readingCellImages(bytes,'SHIFT\nMACHINE-WISE SUMMARY')).openingHmr);
 assert.deepEqual(await readingCellImages(bytes,'JOB CARD\nSHIFT\nMACHINE-WISE SUMMARY'),{});
});
