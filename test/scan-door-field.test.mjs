import test from 'node:test';
import assert from 'node:assert/strict';
import {withScannedDoor} from '../src/scan-door-field.mjs';
import {extractCard} from '../server/rules/scan-extraction.mjs';
import {formatScannedDoor} from '../shared/scan-door-text.mjs';

test('literal door survives missing or different equipment-master labels',()=>{
 const hints={provider:'gemini',handwrittenFields:{door:'S 114'},text:''};
 const missing=extractCard('','vehicle',[],hints);assert.equal(missing.draft.doorText,'S 114');assert.equal(missing.draft.assetId,'');
 const matched=extractCard('','vehicle',[{id:42,master_name:'Equipment master',record_data:{door:'S114 - MH34ZZ1234',category:'VEHICLE'}}],hints);
 assert.equal(matched.draft.doorText,'S 114');assert.equal(matched.draft.assetId,'42');assert.equal(matched.raw.door,'S 114');
});
test('door formatting preserves all digits and human corrections',()=>{
 for(const [input,expected]of [['S 114','S 114'],['S101','S101'],['S/134','S/134'],['S/14','S/14'],['V/1252','V/1252'],['V114','V114'],['S1001','S1001']])assert.equal(formatScannedDoor(input),expected);
 const raw={gemini:{fields:{door:{value:'S114',status:'clear'}}},extractionDraft:{doorText:'S114'}};
 assert.equal(withScannedDoor({doorText:'S114'},raw).doorText,'S114');assert.equal(raw.gemini.fields.door.value,'S114');
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

test('literal slash variants are normalized without changing suffix digits',()=>{
 for(const input of ['s / 62','S: /62','S／62'])assert.equal(formatScannedDoor(input),'S/62',input);
 for(const input of ['S/14','S/01','V/833','S/1001'])assert.equal(formatScannedDoor(input),input);
 for(const input of ['S:162','S: 1 62','S.162','S|62','S I 62','S1620','V162','V1833','MP66ZD0582'])assert.equal(formatScannedDoor(input),input);
 assert.equal(formatScannedDoor('S:162','equipment'),'S:162');
 const raw={gemini:{fields:{door:{value:'S:162',status:'clear'}}},extractionDraft:{doorText:'S:162'}};
 assert.equal(withScannedDoor({doorText:'S:162'},raw).doorText,'S:162');
 assert.equal(withScannedDoor({doorText:'S/63'},raw).doorText,'S/63');
 assert.equal(withScannedDoor({doorText:''},raw).doorText,'');
 assert.equal(raw.gemini.fields.door.value,'S:162');
});

test('literal slash formatting never deletes a leading digit',()=>{
 for(const [input,expected]of [['V/1252','V/1252'],['V / 1833','V/1833'],['S/162','S/162'],['V/125','V/125'],['S/14','S/14'],['S/01','S/01'],['H/1252','H/1252']])assert.equal(formatScannedDoor(input),expected);
 const raw={gemini:{fields:{door:{value:'V/1252',status:'clear'}}},extractionDraft:{doorText:'V/1252'}};
 const corrected=withScannedDoor({doorText:'V/1252',assetId:'wrong',manualBreakdownHours:3},raw);
 assert.equal(corrected.doorText,'V/1252');assert.equal(corrected.assetId,'wrong');assert.equal(corrected.manualBreakdownHours,3);
 assert.equal(withScannedDoor({doorText:'V/125',assetId:'human'},raw).doorText,'V/125');
 assert.equal(withScannedDoor({doorText:'V/125',assetId:'human'},raw).assetId,'human');
 assert.equal(raw.gemini.fields.door.value,'V/1252');
 assert.equal(formatScannedDoor('V/1252','equipment'),'V/1252');
});

test('Eicher digits are preserved until site-wise matching',()=>{
 for(const input of ['E190','E 1 90','E:I90','E|90','E90','E1900','V190','H190'])assert.equal(formatScannedDoor(input),input);
 const raw={gemini:{fields:{door:{value:'E190',status:'clear'}}},extractionDraft:{doorText:'E190'}};
 assert.equal(withScannedDoor({doorText:'E190'},raw).doorText,'E190');
 assert.equal(formatScannedDoor('E190','equipment'),'E190');
});
