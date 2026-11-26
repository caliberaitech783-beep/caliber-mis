import test from 'node:test';
import assert from 'node:assert/strict';
import {ROSTER_SHOW_FROM,rosterShowFrom,machineRosterShown} from '../shared/batch-roster-show.mjs';

// Owner, 26 Nov 2026: the batch Machine roster shows from 27 Nov 2026 in India, not on the day it was released.
test('the Machine roster shows from 27 Nov 2026 00:00 India time', () => {
 assert.equal(ROSTER_SHOW_FROM,'2026-11-27');
 assert.equal(machineRosterShown({},new Date('2026-11-26T12:00:00Z')),false,'26 Nov 17:30 IST: hidden');
 assert.equal(machineRosterShown({},new Date('2026-11-26T18:29:59Z')),false,'26 Nov 23:59:59 IST: hidden');
 assert.equal(machineRosterShown({},new Date('2026-11-26T18:30:00Z')),true,'27 Nov 00:00 IST: shown');
 assert.equal(machineRosterShown({},new Date('2026-12-05T00:00:00Z')),true);
});

test('the Azure setting moves the first day or shows it at once', () => {
 assert.equal(rosterShowFrom({BATCH_ROSTER_SHOW_FROM:'2026-11-29'}),'2026-11-29');
 assert.equal(machineRosterShown({BATCH_ROSTER_SHOW_FROM:'2026-11-29'},new Date('2026-11-28T00:00:00Z')),false);
 assert.equal(machineRosterShown({BATCH_ROSTER_SHOW_FROM:'now'},new Date('2026-11-26T00:00:00Z')),true);
 assert.equal(rosterShowFrom({BATCH_ROSTER_SHOW_FROM:'junk'}),ROSTER_SHOW_FROM);
});
