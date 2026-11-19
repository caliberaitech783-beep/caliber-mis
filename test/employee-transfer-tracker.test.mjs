import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transferTrackerSteps,transferTrackerPill,draftTrackerSteps} from '../shared/employee-transfer-tracker.mjs';
import {ApprovalRequestCard} from './approval-tracker-fixture.mjs';

const states=record=>transferTrackerSteps(record).map(step=>step.state);
test('transfer tracker marks each stage like the leave / OD trackers',()=>{
  assert.deepEqual(states({status:'Awaiting source approval'}),['done','current','pending','pending']);
  assert.deepEqual(states({status:'Awaiting destination acceptance',approvedBy:'PM'}),['done','done','current','pending']);
  assert.deepEqual(states({status:'Completed'}),['done','done','done','done']);
  assert.deepEqual(states({status:'Rejected',rejectedBy:'PM'}),['done','rejected','pending','pending']);
  assert.deepEqual(states({status:'Rejected',approvedBy:'PM',approvedAt:'x',rejectedBy:'Dest'}),['done','done','rejected','pending']);
  assert.equal(transferTrackerSteps({status:'Rejected',rejectedBy:'R. Shah'})[1].note,'R. Shah');
  assert.deepEqual(draftTrackerSteps().map(step=>step.state),['current','pending','pending','pending']);
  assert.deepEqual(['Awaiting source approval','Awaiting destination acceptance','Completed'].map(status=>transferTrackerPill({status}).label),['Pending · step 2 of 4','Pending · step 3 of 4','Completed']);
  assert.deepEqual(transferTrackerPill({status:'Rejected'}),{label:'Rejected at source',tone:'rejected'});
  assert.equal(transferTrackerPill({status:'Rejected',approvedAt:'x'}).label,'Rejected at destination');
});

test('request card draws ticks, the current ring, a red cross and the status pill',()=>{
  const html=renderToStaticMarkup(React.createElement(ApprovalRequestCard,{title:'ET-1 · E001 · Name',pill:transferTrackerPill({status:'Rejected'}),steps:transferTrackerSteps({status:'Rejected'}),onOpen:()=>{}}));
  assert.match(html,/<button type="button" class="apt-card"/);assert.match(html,/apt-step done/);assert.match(html,/apt-step rejected/);assert.match(html,/×/);assert.match(html,/apt-pill rejected">Rejected at source/);
  const css=readFileSync(new URL('../src/approval-tracker.css',import.meta.url),'utf8');
  assert.match(css,/\.apt-step\.rejected \.apt-line\{background:#e0483e\}/);assert.match(css,/\.apt-step\.done \.apt-line,\.apt-step\.current \.apt-line\{background:#17955f\}/);
});

test('C-Directory profile shows the employee transfer trail',()=>{
  const page=readFileSync(new URL('../src/caliber-directory-page.jsx',import.meta.url),'utf8');
  assert.match(page,/<EmployeeTransferTrail token=\{token\} empId=\{person\.empId\}\/>/);assert.match(page,/<ProfileDrawer token=\{token\}/);
  const trail=readFileSync(new URL('../src/employee-transfer-trail.jsx',import.meta.url),'utf8');assert.ok(trail.includes('/api/cdir/employee-transfers/employee/'));
});
