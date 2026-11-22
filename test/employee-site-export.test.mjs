import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {employeeSiteSheets,NO_SITE_LABEL} from '../src/employee-site-export.mjs';

test('site-wise employee download has a summary sheet and one sheet per site',()=>{
  const records=[
    {name:'A',site:'Sasti OC'},{name:'B',site:'Majri OC'},{name:'C',site:'Sasti OC'},{name:'D',site:''}
  ];
  const columns=[{label:'Employee name',value:r=>r.name}];
  const sheets=employeeSiteSheets(records,columns);
  assert.deepEqual(sheets.map(s=>s.name),['All sites','Majri OC','Sasti OC',NO_SITE_LABEL]);
  assert.deepEqual(sheets[0].rows,[{site:'Majri OC',count:1},{site:'Sasti OC',count:2},{site:NO_SITE_LABEL,count:1},{site:'Total',count:4}]);
  assert.deepEqual(sheets[2].rows.map(r=>r.name),['A','C']);
  assert.equal(sheets[2].columns,columns);
});

test('Employee Master offers the site-wise download',()=>{
  const source=readFileSync(new URL('../src/employee-master.jsx',import.meta.url),'utf8');
  assert.match(source,/Prepare site-wise download/);
  assert.match(source,/excelSheets=\{\(\)=>employeeSiteSheets\(/);
});
