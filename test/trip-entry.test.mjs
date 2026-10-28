import test from 'node:test';import assert from 'node:assert/strict';import {blankTrip,nextTripEntry} from '../trip-entry.mjs';
const complete={equipmentName:'V19',loadingTime:'08:20',unloadingTime:'08:40',tripCount:1};
test('Enter after a completed last trip adds exactly one blank row without changing previous rows',()=>{
 const rows=[complete],next=nextTripEntry(rows,0);assert.equal(next.trips.length,2);assert.equal(next.nextIndex,1);assert.equal(rows.length,1);assert.equal(next.trips[0],complete);assert.deepEqual(next.trips[1],blankTrip());
 const existing=nextTripEntry([complete,complete],0);assert.equal(existing.trips.length,2);assert.equal(existing.nextIndex,1);
});
test('incomplete or invalid rows do not add another row; without-time cards need no clock values',()=>{
 for(const row of [blankTrip(),{...complete,equipmentName:' '},{...complete,tripCount:0},{...complete,tripCount:1.5},{...complete,loadingTime:'25:00'},{...complete,loadingTime:'',unloadingTime:''}])assert.ok(nextTripEntry([row],0).error);
 assert.equal(nextTripEntry([{...complete,loadingTime:'',unloadingTime:''}],0,'without').trips.length,2);
 assert.ok(nextTripEntry([complete],0,'with',1).error);
});

test('handover rows can continue with one valid time',()=>{for(const key of ['loadingTime','unloadingTime'])assert.equal(nextTripEntry([{...complete,[key]:''}],0).trips.length,2)});
