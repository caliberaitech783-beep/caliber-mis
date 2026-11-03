import test from 'node:test';
import assert from 'node:assert/strict';
import {requireScanUploadContext,scanContextGate,scanContextError,applyScanContext} from '../scan-batch-context.mjs';
const expected={bookDate:'2026-12-30',location:'Sasti OC',cardShift:'I'};
test('trip-card uploads require an explicitly entered real date and marked shift',()=>{
 for(const value of [undefined,null,{}, {...expected,bookDate:''},{...expected,cardShift:''},{...expected,bookDate:'2026-02-30'}])assert.throws(()=>requireScanUploadContext('vehicle',value));
 assert.equal(requireScanUploadContext('vehicle',expected).confirmed,false);
});
test('handwritten dates and shifts that differ from the batch never block it: the batch values are final',()=>{
 const cards=[
  {id:'1',ordinal:1,filename:'cards.pdf · page 1',status:'review',draft:expected,raw_fields:{extractionDraft:expected}},
  {id:'2',ordinal:2,filename:'cards.pdf · page 2',status:'review',draft:{...expected,bookDate:'2026-12-29'},raw_fields:{extractionDraft:{...expected,bookDate:'2026-12-29'}}},
  {id:'3',ordinal:3,filename:'cards.pdf · page 3',status:'review',draft:{...expected,cardShift:'II'},raw_fields:{extractionDraft:{...expected,cardShift:'II'}}},
 ];
 const gate=scanContextGate({...expected,confirmed:true},cards);
 assert.equal(gate.blocked,false);assert.deepEqual(gate.mismatches,[]);
 assert.deepEqual(applyScanContext(expected,cards[1].draft),{...expected,bookDateSource:'batch'});
 assert.deepEqual(applyScanContext(expected,cards[2].draft),{...expected,shiftHours:8,shiftId:''});
 assert.deepEqual(applyScanContext(expected,{...expected,bookDate:'',bookDateSource:'scan-unreadable',location:'Sasti OB'}),{...expected,location:'Sasti OB',bookDateSource:'batch'},'an unreadable date takes the batch date; an equivalent site name is kept');
 assert.equal(scanContextError(scanContextGate(expected,cards)),'Confirm the batch date, site and shift before proceeding.');
 assert.equal(scanContextGate({...expected,confirmed:true},[{status:'reading'}]).blocked,true);
});
