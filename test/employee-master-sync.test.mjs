import test from 'node:test';
import assert from 'node:assert/strict';
import oracle from 'oracledb';
import {readEmployeeSyncRows} from '../server/services/employee-master-sync.mjs';

test('Oracle employee sync separates current assignment from base location', async t => {
  let closed = false;
  t.mock.method(oracle, 'getConnection', async () => ({
    async execute(sql) {
      if (sql === 'SET TRANSACTION READ ONLY') return {};
      assert.match(sql, /EMPLOYEECURRENTLOCATIONNAME/i);
      return {rows: [
        {EMPLOYEECODE: '1', EMPLOYEEID: 'CMPL1', EMPLOYEENAME: 'Employee One', LOCATIONNAME: 'Base', CURRENT_LOCATION: ' Current '},
        {EMPLOYEECODE: '2', EMPLOYEEID: 'CMPL2', EMPLOYEENAME: 'Employee Two', LOCATIONNAME: 'Base', CURRENT_LOCATION: null},
      ]};
    },
    async close() { closed = true; },
  }));

  const [assigned, unassigned] = await readEmployeeSyncRows({});
  assert.deepEqual([assigned.locationName, assigned.currentLocation, assigned.site], ['Base', 'Current', 'Current']);
  assert.deepEqual([unassigned.locationName, unassigned.currentLocation, unassigned.site], ['Base', '', 'Base']);
  assert.equal(closed, true);
});
