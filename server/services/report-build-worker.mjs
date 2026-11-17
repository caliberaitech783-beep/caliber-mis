// Worker thread for report-build-pool.mjs: one report build at a time.
import {parentPort} from 'node:worker_threads';
import {REPORT_BUILDS} from './report-builds.mjs';

parentPort.on('message',({id,task,input})=>{
 try{parentPort.postMessage({id,result:REPORT_BUILDS[task](input)});}
 catch(error){parentPort.postMessage({id,error:error?.message||String(error),status:error?.status});}
});
