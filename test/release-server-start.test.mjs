import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {verifyServerStart} from '../scripts/verify-server-start.mjs';
test('startup gate accepts a listening server and blocks missing dependencies or stalled startup',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mis-startup-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'ready.mjs'),"if(process.env.DATABASE_URL!=='postgres://release_check:release_check@127.0.0.1:9/caliber_mis')throw Error('Unexpected database');console.log('CALIBER ERP listening on port 0');setInterval(()=>{},1000);");
 await verifyServerStart({root,entry:'ready.mjs',timeoutMs:3000});
 await writeFile(path.join(root,'missing.mjs'),"import './missing-runtime-file.mjs';");
 await assert.rejects(verifyServerStart({root,entry:'missing.mjs',timeoutMs:3000}),/exited before HTTP startup.*|ERR_MODULE_NOT_FOUND/s);
 await writeFile(path.join(root,'stalled.mjs'),"setInterval(()=>{},1000);");
 await assert.rejects(verifyServerStart({root,entry:'stalled.mjs',timeoutMs:100}),/did not start/);
});
