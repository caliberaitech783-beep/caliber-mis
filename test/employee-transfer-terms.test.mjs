import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {employeeTransferTerms} from '../shared/employee-transfer-terms.mjs';

test('transfer terms need type, reason and dates in order',()=>{
  const base={transferType:'Permanent',reason:'Business need',relievingDate:'2026-11-03'};
  assert.deepEqual(employeeTransferTerms(base,'2026-11-04').terms,{...base,endDate:'',handoverTo:'',assets:[]});
  assert.match(employeeTransferTerms({...base,transferType:''},'2026-11-04').error,/transfer type/);
  assert.match(employeeTransferTerms({...base,reason:'Because'},'2026-11-04').error,/reason/);
  assert.match(employeeTransferTerms({...base,relievingDate:''},'2026-11-04').error,/relieving date/);
  assert.match(employeeTransferTerms(base,'2026-11-01').error,/before the relieving date/);
  assert.match(employeeTransferTerms({...base,transferType:'Temporary'},'2026-11-04').error,/end date/);
  assert.match(employeeTransferTerms({...base,transferType:'Deputation',endDate:'2026-11-04'},'2026-11-04').error,/after the joining date/);
  assert.equal(employeeTransferTerms({...base,transferType:'Temporary',endDate:'2027-03-31'},'2026-11-04').terms.endDate,'2027-03-31');
  assert.match(employeeTransferTerms({...base,endDate:'2027-03-31'},'2026-11-04').error,/no end date/);
  assert.deepEqual(employeeTransferTerms({...base,assets:['SIM','Laptop']},'2026-11-04').terms.assets,['Laptop','SIM']);
  assert.match(employeeTransferTerms({...base,assets:['Car']},'2026-11-04').error,/assets/);
  assert.match(employeeTransferTerms(undefined,'2026-11-04').error,/transfer type/);
});

test('transfer form shows locked From values, a progress bar and stage steps',()=>{
  const ui=readFileSync(new URL('../src/employee-transfer.jsx',import.meta.url),'utf8');
  for(const text of ['From location','From designation','From reporting manager','et-readonly','role="progressbar"','transferFormProgress','TransferSteps','Relieving date','Joining date','End date','Assets returned','Charge handed to','Submit for approval'])assert.ok(ui.includes(text),text);
  const route=readFileSync(new URL('../server/routes/employee-transfer.mjs',import.meta.url),'utf8');
  assert.ok(route.includes('employeeTransferTerms(input.transfer,effectiveDate)'));
});
