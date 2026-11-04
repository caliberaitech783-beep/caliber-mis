import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseTestPlan} from '../scripts/release-test-plan.mjs';

test('small dashboard and report UI changes use focused production tests',()=>{
 const plan=releaseTestPlan(['src/fleet-reconciliation.jsx','shared/fleet-reconciliation-summary.mjs','test/fleet-reconciliation-summary.test.mjs']);
 assert.equal(plan.lane,'fast');
 assert.ok(plan.tests.includes('test/fleet-reconciliation-summary.test.mjs'));
});

test('CSS-only changes use the fast lane',()=>{
 assert.equal(releaseTestPlan(['src/fleet-reconciliation.css']).lane,'fast');
});

test('server, database, scanning, dependency and unknown changes use the full lane',()=>{
 for(const file of ['server.mjs','package-lock.json','src/bulk-card-scanning.jsx','server/services/database-backup.mjs','.github/workflows/main_caliber-mis-783.yml']){
  assert.equal(releaseTestPlan([file]).lane,'full',file);
 }
 assert.equal(releaseTestPlan([]).lane,'full');
});
