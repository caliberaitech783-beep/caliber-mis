import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../src/bulk-card-scanning.css',import.meta.url),'utf8').replace(/\r\n/g,'\n');

test('post-upload review keeps the form and original card image at an exact 50/50 split',()=>{
  const equalSplits=css.match(/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/g)||[];
  assert.ok(equalSplits.length>=3);
  assert.doesNotMatch(css,/\.scan-review-(?:page|compact) \.scan-selected-card\{[^}]*grid-template-columns:minmax\(0,3fr\) minmax\(0,2fr\)/);
});
