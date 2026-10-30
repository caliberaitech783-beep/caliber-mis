import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../src/bulk-card-scanning.css',import.meta.url),'utf8').replace(/\r\n/g,'\n');

test('VLB and ELB scan trip rows use half-width equipment boxes with trip labels directly beside them',()=>{
  assert.match(css,/\.scan-trip-row\{grid-template-columns:\.65fr 1fr 1fr \.7fr \.8fr auto\}/);
  assert.match(css,/\.scan-trip-row>strong\{align-self:start;justify-self:end;white-space:nowrap;margin-top:22px\}/);
  assert.match(css,/\.scan-trip-row:has\(>strong\):has\(input\[type=time\]\)\{grid-template-columns:auto minmax\(55px,\.5fr\) repeat\(2,110px\) 55px auto\}/);
});
