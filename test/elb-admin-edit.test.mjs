import test from 'node:test';
import assert from 'node:assert/strict';
import {saveFleetEntry} from '../server/rules/vlb-batch-stages.mjs';

test('saved fleet ELB edits require server-side admin authority and the current revision',async()=>{
 const client={query:async sql=>({rows:sql.includes('mis_vlb_batch_fleet')?[{logbook_id:42}]:sql.includes('SELECT revision')?[{revision:3}]:[]})};
 const batch={id:'batch1',stage:'elb_open'};
 await assert.rejects(saveFleetEntry(client,batch,1,{revision:3},'user',{allowEditSaved:false}),e=>e.status===403);
 await assert.rejects(saveFleetEntry(client,batch,1,{revision:2},'admin',{allowEditSaved:true}),e=>e.status===409&&/changed/.test(e.message));
 await assert.rejects(saveFleetEntry(client,batch,1,{},'admin',{allowEditSaved:true}),e=>e.status===409&&/changed/.test(e.message));
});
