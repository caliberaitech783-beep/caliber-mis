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

test('saves in the first 10 minutes after start are left out of afterWarmup only',()=>{
 let t=0;const steps=createEntryReadSteps({keep:3,clock:()=>t});
 const save=(at,ms)=>{t=at;const lap=steps.start();t=at+ms;lap('card-fill');lap.done({cards:1,partial:false});};
 save(60000,13000);save(120000,6000);
 let stats=steps.stats();
 assert.equal(stats.reads,2,'/api/health still shows every save');
 assert.deepEqual(stats.afterWarmup,{reads:0,total:null,steps:{},slowest:[],warmupMinutes:10,warmupSkipped:2});
 save(11*60000,200);save(12*60000,400);
 stats=steps.stats();
 assert.deepEqual(stats.afterWarmup.total,{avgMs:300,maxMs:400});
 assert.equal(stats.afterWarmup.warmupSkipped,1,'the oldest cold save has dropped out of the kept 3');
 save(13*60000,300);
 assert.equal(steps.stats().afterWarmup.warmupSkipped,0);
});
