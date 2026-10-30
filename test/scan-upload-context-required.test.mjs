import test from 'node:test';
import assert from 'node:assert/strict';
import {requireScanUploadContext,scanContextGate,scanContextError} from '../scan-batch-context.mjs';
const expected={bookDate:'2026-10-30',location:'Sasti OC',cardShift:'I'};
test('trip-card uploads require an explicitly entered real date and marked shift',()=>{
 for(const value of [undefined,null,{}, {...expected,bookDate:''},{...expected,cardShift:''},{...expected,bookDate:'2026-02-30'}])assert.throws(()=>requireScanUploadContext('vehicle',value));
 assert.equal(requireScanUploadContext('vehicle',expected).confirmed,false);
});
test('mixed dates and shifts block the batch and identify every offending page',()=>{
 const gate=scanContextGate({...expected,confirmed:true},[
  {id:'1',ordinal:1,filename:'cards.pdf · page 1',status:'review',draft:expected},
  {id:'2',ordinal:2,filename:'cards.pdf · page 2',status:'review',draft:{...expected,bookDate:'2026-10-29'}},
  {id:'3',ordinal:3,filename:'cards.pdf · page 3',status:'review',draft:{...expected,cardShift:'II'}},
 ]);
 assert.equal(gate.blocked,true);
 assert.match(scanContextError(gate),/Card 2.*page 2.*2026-10-29.*expected 2026-10-30/);
 assert.match(scanContextError(gate),/Card 3.*page 3.*Shift: II; expected I/);
 assert.equal(scanContextGate({...expected,confirmed:true},[{status:'reading'}]).blocked,true);
});
