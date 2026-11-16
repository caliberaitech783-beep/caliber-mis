import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {hrAttendanceScope, requireHrAttendance} from '../server/routes/hr-attendance-access.mjs';

const employeeMaster = {application: 'HR', hrDesktopAccess: ['Employee Master']};

test('the HR attendance feed only accepts Employee Master access and keeps its location restrictions', () => {
  assert.equal(hrAttendanceScope({permissions: {...employeeMaster, application: 'MIS'}}), null);
  assert.equal(hrAttendanceScope({permissions: {...employeeMaster, hrDesktopAccess: []}}), null);
  assert.deepEqual(hrAttendanceScope({permissions: {...employeeMaster, site: 'Jayant | Jayant OB'}}), {sites: ['jayant ob']});
  assert.deepEqual(hrAttendanceScope({permissions: {...employeeMaster, adminLevel: 'Site HR'}}), {sites: []});
});

test('a request cannot supply its own site scope or bypass Pulse HR validation', async () => {
  const grant = 'x'.repeat(43);
  let checked = false;
  const guard = requireHrAttendance(async (url, options) => {
    assert.equal(url, 'https://pulse.cmll.in/api/integrations/hr/validate');
    assert.deepEqual(JSON.parse(options.body), {grant});
    checked = true;
    return Response.json({profile: {permissions: {...employeeMaster, site: 'Jayant OB'}}});
  });
  const req = {headers: {authorization: 'Bearer ' + grant}, query: {site: 'All sites'}};
  await guard(req, {set() {}}, () => {});
  assert.equal(checked, true);
  assert.deepEqual(req.logBookScope, {sites: ['jayant ob']});
});
