import test from 'node:test';
import assert from 'node:assert/strict';
import {withScannedDoor} from '../src/scan-door-field.mjs';
import {extractCard} from '../scan-extraction.mjs';
import {formatScannedDoor} from '../scan-door-text.mjs';

test('literal door survives missing or different equipment-master labels',()=>{
 const hints={provider:'gemini',handwrittenFields:{door:'S 114'},text:''};
 const missing=extractCard('','vehicle',[],hints);assert.equal(missing.draft.doorText,'S 114');assert.equal(missing.draft.assetId,'');
 const matched=extractCard('','vehicle',[{id:42,master_name:'Equipment master',record_data:{door:'S114 - MH34ZZ1234',category:'VEHICLE'}}],hints);
 assert.equal(matched.draft.doorText,'S 114');assert.equal(matched.draft.assetId,'42');assert.equal(matched.raw.door,'S 114');
});
test('user-confirmed S separator changes only the exact S1NN pattern, preserving the original response and human corrections',()=>{
 for(const [input,expected]of [['S 114','S/14'],['S101','S/01'],['S/14','S/14'],['S 1 06','S/06'],['V114','V114'],['S14','S14'],['S1001','S1001']])assert.equal(formatScannedDoor(input),expected);
 const raw={gemini:{fields:{door:{value:'S114',status:'clear'}}},extractionDraft:{doorText:'S114'}};
 assert.equal(withScannedDoor({doorText:'S114'},raw).doorText,'S/14');assert.equal(raw.gemini.fields.door.value,'S114');
 assert.equal(withScannedDoor({doorText:'S/15'},raw).doorText,'S/15');
});
test('old cards show original scan text; saved corrections and intentional blanks win over extraction',()=>{
 const raw={door:'master label',gemini:{fields:{door:{value:'V-309',status:'clear'}}}};
 assert.equal(withScannedDoor({assetId:'123'},raw).doorText,'V-309');
 assert.equal(withScannedDoor({doorText:'V 309 corrected'},raw).doorText,'V 309 corrected');
 assert.equal(withScannedDoor({doorText:''},raw).doorText,'');
 assert.equal(withScannedDoor({}, {gemini:{fields:{door:{value:null,status:'unclear'}}}}).doorText,'');
});

test('Job Card S/SPC numbers never receive the vehicle-specific S1NN slash correction',()=>{
 const raw={gemini:{fields:{door:{value:'S114',status:'clear'}}}};
 assert.equal(formatScannedDoor('S114','equipment'),'S114');
 assert.equal(withScannedDoor({docType:'ELB',doorText:'S114'},raw).doorText,'S114');
 assert.equal(withScannedDoor({},raw,'equipment').doorText,'S114');
});
