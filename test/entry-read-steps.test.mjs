import test from 'node:test';import assert from 'node:assert/strict';
import {createEntryReadSteps} from '../server/services/entry-read-steps.mjs';

test('entry read steps add up per step, keep the slowest reads and only names and milliseconds',()=>{
 const steps=createEntryReadSteps({keep:3,slowest:2});
 const clock=times=>{let i=0;return ()=>times[i++];};
 // queue 2 ms, connection 1 ms, then two cards' checks of 3 and 4 ms that add up.
 let lap=steps.start(clock([0,2,3,6,10,10]));
 lap('queue');lap('connection');lap('card-check');lap('card-check');lap.done({cards:2,partial:false});
 lap=steps.start(clock([0,9000,9000]));lap('duplicate-preload');lap.done({cards:40,partial:false});
 const stats=steps.stats();
 assert.equal(stats.reads,2);
 assert.deepEqual(Object.keys(stats.steps)[0],'duplicate-preload');
 assert.deepEqual(stats.steps['card-check'],{avgMs:7,maxMs:7});
 assert.deepEqual(stats.slowest[0],{totalMs:9000,cards:40,partial:false,steps:{'duplicate-preload':9000}});
 assert.deepEqual(stats.slowest[1].steps,{'card-check':7,queue:2,connection:1});
 for(let n=0;n<5;n++){const l=steps.start(clock([0,1,1]));l('queue');l.done({cards:1,partial:true});}
 assert.equal(steps.stats().reads,3,'only the latest reads are kept');
});
