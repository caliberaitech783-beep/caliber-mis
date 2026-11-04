import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/pulse-master-sync.jsx',import.meta.url),'utf8');

test('MIS administrators can configure a central Pulse service account while shared user sign-in remains enabled',()=>{
 assert.match(source,/Normal users continue through shared Pulse sign-in/);
 assert.match(source,/<summary>Manage Pulse connection<\/summary>/);
 assert.match(source,/Pulse service username/);
 assert.doesNotMatch(source,/sharedPulseCredentials\?[^:]+:<details className="master-sync-connections"/);
});
