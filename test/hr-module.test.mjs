import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {registerHrModule} from '../server/routes/hr-module.mjs';

const grant = 'a'.repeat(43);
const pulseOrigin = 'https://pulse-ll.cmll.in';

async function fixture(t) {
  const calls = [];
  const app = express();
  registerHrModule(app, {request: async (url, options) => {
    calls.push({url, ...options});
    return new Response(url.hostname === 'hrpulse.cmll.in' ? '<main>HR</main>' : '{"ok":true}', {
      headers: {'content-type': url.hostname === 'hrpulse.cmll.in' ? 'text/html' : 'application/json'},
    });
  }});
  await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      t.after(() => new Promise(done => server.close(done)));
      resolve(server);
    });
  }).then(server => { app.testOrigin = 'http://127.0.0.1:' + server.address().port; });
  return {calls, get: (path, options) => fetch(app.testOrigin + path, options)};
}

test('HR entry and assets stay on the Pulse-II path', async t => {
  const {calls, get} = await fixture(t);
  const redirect = await get('/hr', {redirect: 'manual'});
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/hr/');
  assert.equal(await (await get('/hr/')).text(), '<main>HR</main>');
  assert.equal(calls[0].url.href, 'https://hrpulse.cmll.in/');
  await get('/hr/assets/index-example.js');
  assert.equal(calls[1].url.pathname, '/assets/index-example.js');
  assert.equal((await get('/hr/employee-hr-preview.html')).status, 404);
  const legacy = await get('/hr/attendance-module.html');
  assert.match(legacy.headers.get('content-security-policy'), /^sandbox allow-scripts allow-downloads;/);
});

test('HR authentication forwards only JSON to the shared identity service', async t => {
  const {calls, get} = await fixture(t);
  const body = JSON.stringify({username: 'demo', password: 'fixture'});
  const options = {method: 'POST', body, headers: {origin: pulseOrigin, 'content-type': 'application/json', cookie: 'mis_session=ignored'}};
  const response = await get('/hr/session/authenticate', options);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls[0].url.href, 'https://pulse.cmll.in/api/integrations/hr/authenticate');
  assert.deepEqual(calls[0].headers, {'Content-Type': 'application/json'});
  assert.equal(calls[0].body, body);
  assert.equal(calls[0].redirect, 'error');
  assert.equal((await get('/hr/session/directory', options)).status, 404);
  assert.equal((await get('/hr/session/authenticate', {...options, headers: {...options.headers, origin: 'https://outside.example'}})).status, 403);
  assert.equal(calls.length, 1);
});

test('HR API preserves the HR grant and query, and excludes service-only routes', async t => {
  const {calls, get} = await fixture(t);
  const options = {headers: {authorization: 'Bearer ' + grant, cookie: 'mis_session=ignored'}};
  assert.equal((await get('/hr/api/config')).status, 401);
  const response = await get('/hr/api/attendance/mis?from=2026-11-18', options);
  assert.equal(response.status, 200);
  assert.equal(calls[0].url.href, 'https://hr-api-cmll-783.azurewebsites.net/api/attendance/mis?from=2026-11-18');
  assert.deepEqual(calls[0].headers, {Authorization: 'Bearer ' + grant});
  assert.equal((await get('/hr/api/attendance/bridge/status', options)).status, 404);
  assert.equal((await get('/hr/api/telegram/joining-webhook', options)).status, 404);
  assert.equal(calls.length, 1);
});
