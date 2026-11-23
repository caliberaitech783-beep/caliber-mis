// One driver, one shift, one payment (owner, 23 Nov 2026): "in a shift he has worked in 2 different trucks … in both
// his number should be there … the payment only will be calculated for one … if a driver works for more than 8 hours,
// then also he will get single shift payment only."
// The counting is in test/manpower-report.test.mjs and the saving in test/vlb-duplicate-card.test.mjs and
// test/scan-auto-save.test.mjs. This file holds the one question the two card screens put to the person.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DRIVER_SHIFT_CODE,driverShiftQuestion} from '../shared/driver-shift-confirm.mjs';
import {driverShiftConfirmed,driverShiftMark} from '../server/rules/log-book-shift-hmr.mjs';

const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('the question names the driver, says what Yes does and that one shift is counted',()=>{
 const asked=driverShiftQuestion('RAM already has card VLB-1 on another vehicle in this shift.','RAM');
 assert.match(asked,/^RAM already has card VLB-1 on another vehicle in this shift\.\n\nDid RAM also drive this vehicle in this shift\?/);
 assert.match(asked,/OK = Yes: save this card under the same driver\. One shift is counted\./);
 assert.match(asked,/Cancel = No: I will check the number on the card\./);
 assert.match(driverShiftQuestion('Refused.'),/Did this driver also drive this vehicle in this shift\?/);
});

test('the answer kept on the card says who and when',()=>{
 const mark=driverShiftMark('site.operator','2026-11-23T10:00:00.000Z');
 assert.deepEqual(mark,{by:'site.operator',at:'2026-11-23T10:00:00.000Z'});
 assert.equal(driverShiftConfirmed({driverShiftConfirmed:mark}),true);
 assert.equal(driverShiftConfirmed({}),false);assert.equal(driverShiftConfirmed(null),false);
});

test('both card screens ask the question once and send the Yes with the save; automatic saving never answers it',()=>{
 const form=source('src/log-book-form.jsx'),scan=source('src/bulk-card-scanning.jsx'),server=source('server/routes/bulk-card-scanning.mjs');
 assert.equal(DRIVER_SHIFT_CODE,'driver_shift_hmr_limit');
 assert.match(form,/e\.details\?\.code===DRIVER_SHIFT_CODE&&!driverShiftConfirmed/);
 assert.match(form,/window\.confirm\(driverShiftQuestion\(e\.message,e\.details\.confirm\?\.driver\)\)\)return submit\(duplicateReason,true\)/);
 // The person's own Save on the review page asks; the background loop sends the revision alone, so it can only be refused.
 assert.match(scan,/refusal\?\.code!==DRIVER_SHIFT_CODE\|\|!window\.confirm\(driverShiftQuestion\(refusal\.message\)\)\)throw refusal;return send\(true\)/);
 assert.match(scan,/autoSaveWithBusyRetry\(\(\)=>api\('\/api\/scan-cards\/'\+next\.id\+'\/auto-save',\{method:'POST',signal:AbortSignal\.timeout\(60000\),body:JSON\.stringify\(\{revision:next\.revision\}\)\}\)/);
 assert.match(server,/req\.body\.driverShiftConfirmed===true\?\{driverShiftConfirmed:driverShiftMark\(actor\)\}:\{\}/);
});
