import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PULSE_HOURS_RETRY_DELAYS_MS,pulseHoursFailureIsTransient,pulseHoursRetryDelayMs} from '../src/pulse-hours-retry.mjs';

test('a Pulse gateway timeout is repeated, with a longer wait each time',()=>{
 assert.deepEqual(PULSE_HOURS_RETRY_DELAYS_MS.map((_,attempt)=>pulseHoursRetryDelayMs('Pulse request failed (504).',attempt)),PULSE_HOURS_RETRY_DELAYS_MS);
 assert.equal(pulseHoursRetryDelayMs('Pulse request failed (504).',PULSE_HOURS_RETRY_DELAYS_MS.length),null);
});

test('the messages the server gives for an unreachable Pulse count as passing failures',()=>{
 for(const message of ['Pulse request failed (502).','Pulse request failed (503).','Could not reach pulse.cmll.in. The connection will retry automatically.','Pulse is temporarily unavailable; automatic retry is pending.','Pulse connection update is still being applied; automatic retry is pending.'])assert.equal(pulseHoursFailureIsTransient(message),true,message);
});

test('failures that a repeat cannot cure are shown once and not repeated',()=>{
 for(const message of ['Pulse request failed (500).','Pulse request failed (400).','Pulse access expired or was denied. Reconnect an authorized Pulse administrator with MIS verification access to the card site.','Connect Pulse to fetch breakdown hours.','Select valid vehicle and shift masters.','Vehicle and shift must belong to this location.','',undefined])assert.equal(pulseHoursRetryDelayMs(message,0),null,String(message));
});

test('the server still words these failures the way the retry recognises',()=>{
 const sync=readFileSync(new URL('../server/routes/pulse-master-sync.mjs',import.meta.url),'utf8'),bridge=readFileSync(new URL('../server/services/pulse-signin-bridge.mjs',import.meta.url),'utf8');
 assert.match(sync,/`Pulse request failed \(\$\{response\.status\}\)\.`/);
 assert.match(sync,/Could not reach pulse\.cmll\.in/);
 assert.match(bridge,/Pulse is temporarily unavailable; automatic retry is pending\./);
});

test('the scan screen repeats the lookup and clears the warning when a repeat succeeds',()=>{
 const screen=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 assert.match(screen,/const wait=pulseHoursRetryDelayMs\(e\.message,attempt\);if\(wait!==null\)timer=setTimeout\(\(\)=>read\(attempt\+1\),wait\)/);
 assert.match(screen,/\.then\(r=>\{if\(live\)\{setPulseHoursError\(''\);setPulseHours\(r\)/);
 assert.match(screen,/return\(\)=>\{live=false;clearTimeout\(timer\)\}/);
});
