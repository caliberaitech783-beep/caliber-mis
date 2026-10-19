import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
test('MIS uses the existing operational authentication flow',()=>{
  assert.match(source,/\[accountsPortal,setAccountsPortal\]=useState\(false\)/);
  assert.match(source,/aria-pressed="true" onClick=\{\(\)=>selectLoginPortal\(false\)\}/);
  assert.match(source,/<strong>MIS<\/strong>/);
});
test('login omits Tender and Accident launchers',()=>{
  const login=source.split('<div className="login-application-links">')[1].split('</div>')[0];
  assert.doesNotMatch(login,/login-tender-link|login-accident-link|login-accounts-link|login-fleet-link/);
});

test('mobile application tiles wrap in two columns, with a single column on narrow phones',()=>{
  const css=readFileSync(new URL('../src/user-sessions.css',import.meta.url),'utf8');
  assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/height:auto;box-sizing:border-box;padding:12px;gap:8px;white-space:normal/);
  assert.match(css,/span\{min-width:0;overflow-wrap:anywhere\}/);
  assert.match(css,/@media\(max-width:360px\)\{.login-application-links\{grid-template-columns:minmax\(0,1fr\)\}\}/);
});
