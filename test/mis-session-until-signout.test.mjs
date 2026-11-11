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
  const restore=source.slice(source.indexOf('const storedSession'),source.indexOf('let authToken'));
  assert.doesNotMatch(restore,/login.*return null/);
  const sharedSignIn=source.slice(source.indexOf("const receive=event=>{const value=event.detail"),source.indexOf("window.addEventListener('mis-shared-signin'"));
  assert.match(sharedSignIn,/searchParams\.delete\('login'\)/);
  const logout=source.slice(source.indexOf('logout = () =>'),source.indexOf('addRequest = async'));
  assert.match(logout,/clearStoredSession\(\)/);
});

test('secure browser session is moved into tab storage before persistent storage is cleared',()=>{
  const source=fs.readFileSync(new URL('../src/account-security.jsx',import.meta.url),'utf8');
  const browserSession=source.slice(source.indexOf("if(!isBrowserSessionToken"),source.indexOf("const response=await fetch('/api/security/account'"));
  assert.match(browserSession,/sessionStorage\.setItem\('nerveCenterSession',JSON\.stringify\(session\)\)/);
  assert.ok(browserSession.indexOf("sessionStorage.setItem('nerveCenterSession',JSON.stringify(session))")<browserSession.indexOf("localStorage.removeItem('nerveCenterSession')",browserSession.indexOf('window.location.reload();return;')));
});
