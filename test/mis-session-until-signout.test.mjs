import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('MIS trusts its saved session without automatic Pulse revalidation',()=>{
  const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
  const readSession=source.slice(source.indexOf('async function readSession'),source.indexOf('function sessionActivityDetails'));
  assert.match(readSession,/const local=await sessionStore\.get\(token\)/);
  assert.doesNotMatch(readSession,/validateSession/);
});

test('successful sign-in persists until the explicit sign-out clears storage',()=>{
  const source=fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
  assert.match(source,/localStorage\.setItem\("nerveCenterSession", session\)/);
  assert.match(source,/localStorage\.setItem\('nerveCenterSession',JSON\.stringify\(value\)\)/);
  const logout=source.slice(source.indexOf('logout = () =>'),source.indexOf('addRequest = async'));
  assert.match(logout,/clearStoredSession\(\)/);
});
