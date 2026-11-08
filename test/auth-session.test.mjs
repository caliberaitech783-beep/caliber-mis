import assert from "node:assert/strict";
import test from "node:test";
import {createSessionStore} from "../server/services/auth-session.mjs";

test("stores login sessions in PostgreSQL", async () => {
  const calls = [];
  const store = createSessionStore({
    async query(sql, params) {
      calls.push({sql, params});
      return {rows: []};
    }
  });

  await store.create({
    token: "token-1", role: "normal", name: "Anoop Paul", login: "anoop",
    userType: "Mobile User", assignedRole: "Production User", permissions: {createRequests: true},
  });

  assert.match(calls[0].sql, /DELETE FROM auth_sessions/);
  assert.deepEqual(calls[0].params, [30]);
  assert.match(calls[1].sql, /INSERT INTO auth_sessions/);
  assert.deepEqual(calls[1].params, ["token-1", "normal", "Anoop Paul", "anoop", "Mobile User", "Production User", '{"createRequests":true}']);
});

test("loads an existing session from PostgreSQL", async () => {
  const store = createSessionStore({
    async query(sql, params) {
      assert.match(sql, /FROM auth_sessions/);
      assert.match(sql, /created_at > NOW\(\) - make_interval\(days => \$2::int\)/);
      assert.doesNotMatch(sql, /last_seen_at/);
      assert.deepEqual(params, ["token-1", 30]);
      return {rows: [{role: "normal", name: "Anoop Paul", login: "anoop", userType: "Mobile User", assignedRole: "MIS User", permissions: {verifyRequests: true}}]};
    }
  });

  assert.deepEqual(await store.get("token-1"), {role: "normal", name: "Anoop Paul", login: "anoop", userType: "Mobile User", assignedRole: "MIS User", permissions: {verifyRequests: true}});
});

test("supports a bounded custom server-side session lifetime", async () => {
  const calls = [];
  const store = createSessionStore({
    async query(sql, params) {
      calls.push({sql, params});
      return {rows: []};
    }
  }, {maxAgeDays: 7});

  assert.equal(await store.get("token-2"), null);
  assert.deepEqual(calls[0].params, ["token-2", 7]);
});

test("does not query PostgreSQL when no token is supplied", async () => {
  const store = createSessionStore({
    async query() {
      assert.fail("query should not be called");
    }
  });

  assert.equal(await store.get(""), null);
});

test("records session activity without changing the session token", async () => {
  const calls = [];
  const store = createSessionStore({
    async query(sql, params) {
      calls.push({sql, params});
      return {rows: []};
    }
  });

  await store.touch("token-3", {
    ipAddress: "10.0.0.8",
    deviceId: "Caliber Pulse-DEVICE01",
    userAgent: "Test Browser",
  });

  assert.match(calls[0].sql, /UPDATE auth_sessions/);
  assert.match(calls[0].sql, /last_seen_at = NOW\(\)/);
  assert.doesNotMatch(calls[0].sql, /make_interval\(mins/);
  assert.deepEqual(calls[0].params, ["token-3", "10.0.0.8", "Caliber Pulse-DEVICE01", "Test Browser"]);
});

test("prunes only sessions that exceed the absolute lifetime", async () => {
  const calls = [];
  const store = createSessionStore({
    async query(sql, params) {
      calls.push({sql, params});
      return {rowCount: 3, rows: []};
    }
  });

  assert.equal(await store.pruneExpired(), 3);
  assert.doesNotMatch(calls[0].sql, /make_interval\(mins/);
  assert.deepEqual(calls[0].params, [30]);
});

test("a new sign-in replaces the login's older sessions beyond its allowance", async () => {
  const calls = [];
  const store = createSessionStore({
    async query(sql, params) {
      calls.push({sql, params});
      return {rows: []};
    }
  }, {sessionLimit: (login) => login === "mohitchadda" ? 3 : 1});

  await store.create({token: "token-a", role: "normal", name: "Anoop Paul", login: "anoop", permissions: {createRequests: true}});
  const replace = calls[2];
  assert.match(replace.sql, /DELETE FROM auth_sessions/);
  assert.match(replace.sql, /lower\(login_name\) = lower\(\$1\)/);
  assert.match(replace.sql, /COALESCE\(permissions->>'application', 'BDMS'\)/);
  assert.match(replace.sql, /token <> \$2/);
  assert.match(replace.sql, /ORDER BY \(token = \$2\) DESC, created_at DESC\s+LIMIT \$4::int/);
  assert.deepEqual(replace.params, ["anoop", "token-a", '{"createRequests":true}', 1]);

  calls.length = 0;
  await store.create({token: "token-m", role: "super", name: "Mohit Chadda", login: "mohitchadda", permissions: {adminLevel: "Super Admin"}});
  assert.equal(calls[2].params[3], 3);
});

test("session replacement is skipped when the rule is off or the login is unknown", async () => {
  const calls = [];
  const pool = {async query(sql, params) {calls.push({sql, params}); return {rows: []};}};
  await createSessionStore(pool, {sessionLimit: () => 0}).create({token: "t1", role: "normal", name: "A", login: "anoop"});
  await createSessionStore(pool, {sessionLimit: () => 1}).create({token: "t2", role: "normal", name: "B", login: ""});
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => !/token <> \$2/.test(call.sql)));
});

test("the live store applies the shared concurrency policy by default", async () => {
  const calls = [];
  const store = createSessionStore({async query(sql, params) {calls.push({sql, params}); return {rows: []};}});
  await store.create({token: "t", role: "normal", name: "A", login: "anoop"});
  assert.equal(calls[2]?.params?.[3], 1);
  calls.length = 0;
  await store.create({token: "t", role: "super", name: "Mohit", login: "MOHITCHADDA"});
  assert.equal(calls[2]?.params?.[3], 3);
});

test("in PostgreSQL the newest sessions survive per login and application, up to the allowance", async () => {
  const {PGlite} = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.query(`CREATE TABLE auth_sessions (token TEXT PRIMARY KEY, role TEXT, employee_name TEXT, login_name TEXT NOT NULL DEFAULT '',
      user_type TEXT NOT NULL DEFAULT '', assigned_role TEXT NOT NULL DEFAULT '', permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const store = createSessionStore(db, {sessionLimit: (login) => login === "mohitchadda" ? 3 : 1});
    const tokens = async () => (await db.query("SELECT token FROM auth_sessions ORDER BY token")).rows.map(row => row.token);
    const age = (token, seconds) => db.query("UPDATE auth_sessions SET created_at = NOW() - make_interval(secs => $2) WHERE token = $1", [token, seconds]);

    await store.create({token: "anoop-1", role: "normal", name: "Anoop", login: "anoop"});
    await age("anoop-1", 60);
    await store.create({token: "anoop-tender", role: "normal", name: "Anoop", login: "anoop", permissions: {application: "Tender"}});
    await store.create({token: "other-1", role: "normal", name: "Other", login: "other"});
    await store.create({token: "anoop-2", role: "normal", name: "Anoop", login: "ANOOP"});
    assert.deepEqual(await tokens(), ["anoop-2", "anoop-tender", "other-1"], "the earlier BDMS session of the same login is signed out; Tender and other logins stay");

    for (const [index, token] of ["m-1", "m-2", "m-3"].entries()) {
      await store.create({token, role: "super", name: "Mohit Chadda", login: "mohitchadda"});
      await age(token, 300 - index * 60);
    }
    assert.deepEqual((await tokens()).filter(token => token.startsWith("m-")), ["m-1", "m-2", "m-3"], "three devices stay signed in");
    await store.create({token: "m-4", role: "super", name: "Mohit Chadda", login: "mohitchadda"});
    assert.deepEqual((await tokens()).filter(token => token.startsWith("m-")), ["m-2", "m-3", "m-4"], "a fourth device signs out only the oldest");
    assert.deepEqual((await tokens()).filter(token => !token.startsWith("m-")), ["anoop-2", "anoop-tender", "other-1"]);
  } finally {
    await db.close();
  }
});
