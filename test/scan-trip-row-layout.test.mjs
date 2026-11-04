import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../src/bulk-card-scanning.css',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const component=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8').replace(/\r\n/g,'\n');

test('VLB and ELB scan trip rows use half-width equipment boxes with trip labels directly beside them',()=>{
  assert.match(css,/\.scan-trip-row\{grid-template-columns:\.65fr 1fr 1fr \.7fr \.8fr auto\}/);
  assert.match(css,/\.scan-trip-row>strong\{align-self:start;justify-self:end;white-space:nowrap;margin-top:22px\}/);
  assert.match(css,/\.scan-trip-row:has\(>strong\):has\(input\[type=time\]\)\{grid-template-columns:auto minmax\(55px,\.5fr\) repeat\(2,110px\) 55px auto\}/);
  assert.match(css,/\.scan-trip-row:has\(input\[aria-label\^="Printed trip number"\]\):has\(input\[type=time\]\)\{grid-template-columns:55px minmax\(55px,\.5fr\) repeat\(2,110px\) 55px 65px auto\}/);
});

test('VLB scan trip equipment is locked to the selected site equipment list',()=>{
  assert.match(component,/siteEquipmentOptions\(options\?\.assets\|\|\[\],draft\.location\)/);
  assert.match(component,/Select equipment registered at \{draft\.location\|\|'this site'\}/);
  assert.match(component,/data-trip-equipment=\{i\}/);
  assert.doesNotMatch(component,/scan-loading-equipment/);
});
