import test from 'node:test';
import assert from 'node:assert/strict';
import {scanIssueFieldVisible,focusedScanMessages} from '../src/scan-issue-focus.mjs';
test('each issue tile exposes only its own correction fields',()=>{
 const keys=['doorText','assetId','employeeId','openingHmr','closingHmr','openingKmr','closingKmr','bookDate','location','shiftId','trips.0.equipmentName','scanMachineSummary'];
 for(const [group,expected]of Object.entries({'wrong-door':['doorText','assetId'],'wrong-caliber':['employeeId'],'wrong-hmr':['openingHmr','closingHmr'],'wrong-kmr':['openingKmr','closingKmr'],'mws-ted':['trips.0.equipmentName','scanMachineSummary']}))assert.deepEqual(keys.filter(key=>scanIssueFieldVisible(group,key)),expected);
 assert.ok(keys.every(key=>scanIssueFieldVisible('brown',key)));
});
test('door review omits date, shift, meter, employee and trip-summary checks',()=>{
 const messages=['Enter door number.','Equipment not assigned to this site: HP 104.','Not assigned to Sasti OB · Pulse: Not registered.','Batch values applied. Card shows Date: 2026-11-02; batch 2026-11-01.','Driver / operator is required.','Closing HMR below opening.','Closing KMR is unreadable.','Machine-wise summary differs from detail trips.'];
 assert.deepEqual(focusedScanMessages(messages,'wrong-door'),messages.slice(0,3));
 assert.deepEqual(focusedScanMessages(messages,'wrong-caliber'),[messages[4]]);
 assert.deepEqual(focusedScanMessages(messages,'wrong-hmr'),[messages[5]]);
 assert.deepEqual(focusedScanMessages(messages,'wrong-kmr'),[messages[6]]);
 assert.deepEqual(focusedScanMessages(messages,'mws-ted'),[messages[7]]);
 assert.deepEqual(focusedScanMessages(messages,'all'),messages);
});
