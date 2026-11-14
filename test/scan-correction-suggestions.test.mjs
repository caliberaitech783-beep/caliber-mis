import test from 'node:test';
import assert from 'node:assert/strict';
import {doorSuggestion,tripTimeWindow,scanCorrectionSuggestions} from '../shared/scan-correction-suggestions.mjs';

const vehicle=(id,door,site='Sasti OC')=>({id:String(id),kind:'vehicle',site,door});
// Shaped like the live Equipment Master: door labels carry the registration after a dash.
const sasti=[vehicle(1,'S93 - MH34BZ0974'),vehicle(2,'S87 - MH34BZ0972'),vehicle(3,'S101 - MH34BZ1191'),vehicle(4,'V792-01055'),vehicle(5,'V625-97209'),vehicle(6,'S/14'),vehicle(7,'S484-UP64CT6244'),vehicle(8,'V481'),vehicle(9,'V93','Jayant OC')];
const two=[vehicle(10,'V183'),vehicle(11,'S183')];

test('a door whose S was read as 5 is suggested from the site master (9 of 9 right on real cards)',()=>{
 for(const [written,door] of [['5193','S93 - MH34BZ0974'],['5/87','S87 - MH34BZ0972'],['51101','S101 - MH34BZ1191'],['5 93','S93 - MH34BZ0974']])
  assert.deepEqual(doorSuggestion({doorText:written,location:'Sasti OC'},sasti),{value:door,assetId:String(sasti.find(a=>a.door===door).id),reason:'S read as 5'},written);
});
test('a fleet letter the site does not use is suggested when one door has that number',()=>{
 assert.deepEqual(doorSuggestion({doorText:'X/792',location:'Sasti OC'},sasti),{value:'V792-01055',assetId:'4',reason:'fleet letter X not at this site'});
 // Two doors carry 183 under letters the site uses: no single answer.
 assert.equal(doorSuggestion({doorText:'X 183',location:'Sasti OC'},two.map(a=>({...a,site:'Sasti OC'}))),null);
});
test('a letter the site does use means a misread digit, so no other-letter guess (V/484 was V481)',()=>{
 assert.equal(doorSuggestion({doorText:'V/484',location:'Sasti OC'},sasti),null);
});
test('no suggestion for a door that already matches, another site, ELB cards or an empty master',()=>{
 for(const doorText of ['S93','V/1625','S/14','V481'])assert.equal(doorSuggestion({doorText,location:'Sasti OC'},sasti),null,doorText);
 assert.equal(doorSuggestion({doorText:'5193',location:'Majri OC'},sasti),null);
 assert.equal(doorSuggestion({doorText:'5193',location:'Sasti OC'},sasti,'equipment'),null);
 assert.equal(doorSuggestion({doorText:'5193',location:'Sasti OC'},[]),null);
 assert.equal(doorSuggestion({doorText:'5999',location:'Sasti OC'},sasti),null);
 assert.equal(doorSuggestion({doorText:'',location:'Sasti OC'},sasti),null);
});
test('an impossible trip time shows the valid times beside it, never a guessed time',()=>{
 const trips=[{loadingTime:'07:20',unloadingTime:'07:38'},{loadingTime:'07:67',unloadingTime:'07:52'},{loadingTime:'08:05',unloadingTime:'08:93'},{loadingTime:'08:30',unloadingTime:''}];
 assert.deepEqual(tripTimeWindow(trips,1,'loadingTime'),{after:'07:38',before:'07:52',message:'07:67 is not a clock time. Valid times beside it on this card: 07:38 before, 07:52 after.'});
 assert.deepEqual(tripTimeWindow(trips,2,'unloadingTime'),{after:'08:05',before:'08:30',message:'08:93 is not a clock time. Valid times beside it on this card: 08:05 before, 08:30 after.'});
 assert.equal(tripTimeWindow(trips,0,'loadingTime'),null);
 assert.equal(tripTimeWindow(trips,3,'unloadingTime'),null);
 assert.equal(tripTimeWindow([{loadingTime:'07:67',unloadingTime:''}],0,'loadingTime'),null);
 assert.equal(tripTimeWindow([{loadingTime:'07:10',unloadingTime:'07:99'}],0,'unloadingTime').message,'07:99 is not a clock time. Valid times beside it on this card: 07:10 before.');
});
test('the card-level list holds the door and time hints by field key, and never a meter value',()=>{
 const draft={doorText:'5193',location:'Sasti OC',openingKmr:'3331.2',closingKmr:'33313',openingHmr:'100',closingHmr:'104',shiftHours:8,trips:[{loadingTime:'07:20',unloadingTime:'07:38'},{loadingTime:'07:67',unloadingTime:'07:52'}]};
 const out=scanCorrectionSuggestions(draft,'vehicle',sasti);
 assert.deepEqual(Object.keys(out).sort(),['doorText','trips.1.loadingTime']);
 assert.equal(out.doorText.value,'S93 - MH34BZ0974');assert.match(out['trips.1.loadingTime'].window.message,/07:38 before, 07:52 after/);
 assert.equal(scanCorrectionSuggestions({...draft,timeMode:'without'},'vehicle',sasti)['trips.1.loadingTime'],undefined);
 assert.deepEqual(scanCorrectionSuggestions({doorText:'5193',location:'Sasti OC',closingHmr:'179604.0',openingHmr:'17960',shiftHours:8},'equipment',sasti),{});
});
