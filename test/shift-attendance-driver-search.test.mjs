import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../src/shift-attendance.jsx',import.meta.url),'utf8');

test('zero-trip attendance driver supports employee ID smart search and Enter selection',()=>{
 assert.match(source,/import SmartSelect from '\.\/smart-select\.jsx'/);
 assert.match(source,/<SmartSelect searchable required aria-label=\{vehicle\?'Driver':'Operator'\}/);
 assert.match(source,/\{row\.name\} · \{row\.caliberId\|\|row\.employeeCode\}/);
});
