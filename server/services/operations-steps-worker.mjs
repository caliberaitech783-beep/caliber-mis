// Worker thread of the step reading (operations-steps-engine.mjs): one engine, its readings kept between presses.
import {parentPort} from 'node:worker_threads';
import {createStepsEngine} from './operations-steps-engine.mjs';

const engine=createStepsEngine();
// Readings older than three minutes are let go every minute, so an idle worker does not hold them.
setInterval(()=>engine.prune(),60000);
parentPort.on('message',({id,op,input})=>{
 try{parentPort.postMessage({id,result:engine[op](input)});}
 catch(error){parentPort.postMessage({id,error:error?.message||String(error),status:error?.status});}
});
