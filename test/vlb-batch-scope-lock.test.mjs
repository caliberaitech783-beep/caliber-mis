import test from 'node:test';import assert from 'node:assert/strict';
import {vlbBatchScope,vlbRecordScope,lockVlbBatchScope,lockVlbBatchWrites,assertVlbBatchWrite} from '../server/rules/vlb-batch-policy.mjs';

const recorder=()=>{const calls=[];return {calls,client:{query:async(sql,args)=>{calls.push({sql,args});return {rows:[],rowCount:0}}}}};
const SHARED_TABLE="SELECT pg_advisory_xact_lock_shared(hashtext('mis_vlb_saved_batches'))";
const WHOLE_TABLE="SELECT pg_advisory_xact_lock(hashtext('mis_vlb_saved_batches'))";
const SCOPE='SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))';

test('a saved card and its batch row share one scope key, whatever the site spelling or shift notation',()=>{
 const record=vlbBatchScope(vlbRecordScope({location:'Sasti OC',bookDate:'2026-11-01',cardShift:'I'}));
 assert.equal(record,vlbBatchScope({site:'Sasti OC',bookDate:'2026-11-01',shift:'S1'}));
 assert.equal(vlbBatchScope({site:' sasti oc',bookDate:'2026-11-01',shift:'S1'}),record);
 assert.notEqual(vlbBatchScope({site:'Sasti OC',bookDate:'2026-11-01',shift:'S2'}),record);
 assert.notEqual(vlbBatchScope({site:'Sasti OC',bookDate:'2026-11-02',shift:'S1'}),record);
 assert.notEqual(vlbBatchScope({site:'Dudhichua East OC',bookDate:'2026-11-01',shift:'S1'}),record);
 assert.throws(()=>vlbBatchScope({site:'Sasti OC',bookDate:new Date('2026-11-01'),shift:'S1'}),/ISO book date/,'a Date object would split the lock by time zone');
 assert.throws(()=>vlbBatchScope({site:'Sasti OC',shift:'S1'}),/ISO book date/);
});

test('a scoped writer holds the table lock shared and its own site, date and shift exclusively',async()=>{
 const {calls,client}=recorder();
 await lockVlbBatchScope(client,{site:'Sasti OC',bookDate:'2026-11-01',shift:'S1'});
 assert.deepEqual(calls.map(c=>c.sql),[SHARED_TABLE,SCOPE]);
 assert.deepEqual(calls[1].args,['mis_vlb_saved_batches',vlbBatchScope({site:'Sasti OC',bookDate:'2026-11-01',shift:'S1'})]);
 const whole=recorder();await lockVlbBatchWrites(whole.client);
 assert.deepEqual(whole.calls.map(c=>c.sql),[WHOLE_TABLE],'deletions and restores still take the whole table');
});

test('saving a card locks only its own site, date and shift, never the whole table',async()=>{
 const {calls,client}=recorder();
 await assert.rejects(assertVlbBatchWrite(client,{location:'Sasti OC',bookDate:'2026-11-01',cardShift:'I'},'alice',undefined,{adding:true}),/Create or open the site\/date\/shift batch/);
 const locks=calls.filter(c=>c.sql.includes('pg_advisory_xact_lock'));
 assert.deepEqual(locks.map(c=>c.sql),[SHARED_TABLE,SCOPE]);
 assert.deepEqual(locks[1].args,['mis_vlb_saved_batches','sasti ob|2026-11-01|S1']);
});
