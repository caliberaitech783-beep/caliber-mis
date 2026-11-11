import assert from "node:assert/strict";
import test from "node:test";
import {createSessionStore} from "../server/services/auth-session.mjs";

test("stores login sessions without expiring or replacing another signed-in device", async () => {
  const calls = [];
  const store = createSessionStore({async query(sql, params) {calls.push({sql, params}); return {rows: []};}});
  await store.create({token:"token-1",role:"normal",name:"Anoop Paul",login:"anoop",userType:"Mobile User",assignedRole:"MIS User",permissions:{verifyRequests:true}});
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/INSERT INTO auth_sessions/);
  assert.doesNotMatch(calls[0].sql,/DELETE FROM auth_sessions/);
  assert.deepEqual(calls[0].params,["token-1","normal","Anoop Paul","anoop","Mobile User","MIS User",'{"verifyRequests":true}']);
});

test("loads a saved session by token without an age or inactivity limit", async () => {
  const expected={role:"normal",name:"Anoop Paul",login:"anoop",userType:"Mobile User",assignedRole:"MIS User",permissions:{verifyRequests:true}};
  const store=createSessionStore({async query(sql,params){
    assert.match(sql,/FROM auth_sessions/);assert.match(sql,/WHERE token = \$1/);
    assert.doesNotMatch(sql,/created_at\s*[<>]|last_seen_at\s*[<>]|make_interval|INTERVAL/);
    assert.deepEqual(params,["token-1"]);return {rows:[expected]};
  }});
  assert.deepEqual(await store.get("token-1"),expected);
});

test("does not query PostgreSQL when no token is supplied",async()=>{
  const store=createSessionStore({async query(){assert.fail("query should not be called");}});
  assert.equal(await store.get(""),null);
});

test("records activity without changing or expiring the session",async()=>{
  const calls=[];const store=createSessionStore({async query(sql,params){calls.push({sql,params});return {rows:[]};}});
  await store.touch("token-3",{ipAddress:"10.0.0.8",deviceId:"DEVICE01",userAgent:"Test Browser"});
  assert.match(calls[0].sql,/UPDATE auth_sessions/);assert.match(calls[0].sql,/last_seen_at = NOW\(\)/);
  assert.doesNotMatch(calls[0].sql,/DELETE|make_interval/);
});

test("automatic cleanup never expires a signed-in session",async()=>{
  let calls=0;const store=createSessionStore({async query(){calls++;return {rowCount:1,rows:[]};}});
  assert.equal(await store.pruneExpired(),0);assert.equal(calls,0);
});
