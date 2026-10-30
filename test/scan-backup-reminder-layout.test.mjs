import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../src/scan-card-backup.css',import.meta.url),'utf8');

test('scan backup reminder remains a bottom-right toast for every user',()=>{
  assert.match(css,/aside\.scan-backup-reminder\{[^}]*position:fixed;[^}]*inset:auto 20px 20px auto;[^}]*width:auto;[^}]*z-index:1200;[^}]*flex-direction:row;/);
  assert.match(css,/@media\(max-width:650px\)\{[\s\S]*?aside\.scan-backup-reminder\{[^}]*inset:auto 12px 12px 12px;[^}]*width:auto;/);
});
