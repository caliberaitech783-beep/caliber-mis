import test from 'node:test';import assert from 'node:assert/strict';
import {handoverTimeNote,isBlankHandoverIssue} from '../src/scan-handover-review.mjs';
test('handover notes are neutral and only describe a missing half with a valid other time',()=>{
 assert.match(handoverTimeNote({loadingTime:'23:50',unloadingTime:''},'unloadingTime'),/Open handover/);
 assert.match(handoverTimeNote({loadingTime:'',unloadingTime:'1:10'},'loadingTime'),/awaiting the loading card/);
 for(const row of [{loadingTime:'',unloadingTime:''},{loadingTime:'25:00',unloadingTime:''}])assert.equal(handoverTimeNote(row,'unloadingTime'),'');
 assert.equal(handoverTimeNote({loadingTime:'23:50'},'equipmentName'),'');
});
test('explicit missing-time notes are accepted without hiding invalid or unreadable evidence',()=>{
 const row={loadingTime:'12:00',unloadingTime:''};
 assert.equal(isBlankHandoverIssue(row,0,'unloadingTime',{},'Trip 1: missing unloading time'),true);
 assert.equal(isBlankHandoverIssue(row,0,'unloadingTime',{},'Trip 1: unreadable unloading time'),false);
 assert.equal(isBlankHandoverIssue(row,0,'unloadingTime',{hybrid:{trips:{r:[[1,'V12','12:00',null]]}}},'Trip 1: missing unloading time'),false);
});
