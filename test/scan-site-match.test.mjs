import test from 'node:test';
import assert from 'node:assert/strict';
import {matchScannedSite} from '../scan-site-match.mjs';
import {extractCard} from '../scan-extraction.mjs';
import {cardPrompt,MODEL} from '../gemini-card-reader.mjs';
const east='Dudhichua East OC',west='Dudhichua OC',sites=[east,west,'Jayant OC'];
test('DCH direction aliases return the actual master label across spacing, case and punctuation',()=>{
 for(const reading of ['DCH (East)','dch EAST','D.C.H. (EAST)','D C H - East','Site: DCH(East)','DCH East O.C.'])assert.equal(matchScannedSite([reading],sites),east,reading);
 for(const reading of ['DCH (West)','dch WEST','D.C.H. (WEST)','D C H - West','DCH (West) OC'])assert.equal(matchScannedSite([reading],sites),west,reading);
 assert.equal(matchScannedSite(['DCH (East)'],['Dudichua East OC',west]),'Dudichua East OC','the label comes from the master, including its spelling');
 assert.equal(matchScannedSite(['DCH (West)'],['Dudhichua OB',east]),'Dudhichua OB','legacy OC/OB identity remains stable');
});
test('DCH never guesses from missing, conflicting or unreadable directions or the available sites',()=>{
 for(const readings of [['DCH'],['DCH (E)'],['DCH (Easf)'],['DCH (East/West)'],['DCH (East)','DCH (West)'],['DCH (East)',west]])assert.equal(matchScannedSite(readings,sites),'',String(readings));
 assert.equal(matchScannedSite(['DCH (East)'],[west]),'');assert.equal(matchScannedSite(['DCH (West)'],[east]),'');
 assert.equal(matchScannedSite(['DCH (East)'],[]),'');
 assert.equal(matchScannedSite(['DCH (East)'],[east,'Dudichua East OC']), '','competing master spellings are not silently selected');
 assert.equal(matchScannedSite(['DCH'],[east]),'','a single available master is not evidence of direction');
});
test('existing non-DCH exact and unique OCR matches remain available',()=>{
 assert.equal(matchScannedSite(['DHOPTASA or','DHOPTALA OF'],['Dhoptala OC (2nd)','Jayant OC']),'Dhoptala OC (2nd)');
 assert.equal(matchScannedSite(['Jayant OB'],sites),'Jayant OC');
 assert.equal(matchScannedSite(['MINEA'],['MINEB','MINEC']),'');
});
const masters=[
 ...[east,west].flatMap((site,index)=>[
  {id:1+index,master_name:'Equipment master',record_data:{equipmentName:'V739',category:'Vehicle',currentLocation:site}},
  {id:11+index,master_name:'Shift Master',record_data:{site,shiftName:'I',startTime:'06:00',endTime:'14:00'}},
  {id:21+index,master_name:'Work Order master',record_data:{site,workOrderNo:'WO-'+index}},
 ])
];
const text=location=>'Site: '+location+'\nDATE 28 10 26\nDoor No. V739\nSHIFT [x] I\nFORM A 900';
test('resolved DCH locations drive equipment, shift and work-order selection for the correct site',()=>{
 for(const [reading,site,index] of [['DCH (East)',east,0],['DCH (West)',west,1]]){
  const result=extractCard(text(reading),'vehicle',masters);
  assert.equal(result.draft.location,site);assert.equal(result.draft.assetId,String(1+index));assert.equal(result.draft.shiftId,String(11+index));assert.equal(result.draft.workOrderId,String(21+index));
  assert.ok(result.raw.locationReadings.includes(reading));assert.equal(result.draft.doorText,'V739');
 }
});
test('ambiguous DCH and unreadable Gemini locations remain blank for review, even with one vehicle match',()=>{
 const onlyEast=masters.filter(row=>row.record_data.site===east||row.record_data.currentLocation===east);
 for(const reading of ['DCH','DCH (East/West)','DCH (West)']){
  const result=extractCard(text(reading),'vehicle',onlyEast);assert.equal(result.draft.location,'');assert.equal(result.draft.assetId,'');assert.ok(result.draft.extractionReviewFields.includes('location'));
 }
 const conflicting=extractCard(text(east),'vehicle',masters,{handwritingCandidates:{location:{value:east,text:east,alternateText:'DCH (West)'}}});assert.equal(conflicting.draft.location,'');
 const unreadable=extractCard('Door No. V739','vehicle',onlyEast,{handwritingCandidates:{location:{value:null,text:null}}});assert.equal(unreadable.draft.location,'');assert.equal(unreadable.draft.assetId,'');
});
test('Gemini keeps literal location evidence and checks direction without changing model',()=>{
 assert.equal(MODEL,'gemini-3.1-flash-lite');
 for(const kind of ['vehicle','equipment']){const prompt=cardPrompt(kind);assert.match(prompt,/Transcribe DCH \(East\) and DCH \(West\) literally/);assert.match(prompt,/mark location unclear instead of guessing/);}
});
