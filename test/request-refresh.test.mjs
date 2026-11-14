import test from "node:test";
import assert from "node:assert/strict";
import {notifyRequestChange, REQUEST_CHANGE_STORAGE_KEY, REQUEST_RETRY_DELAYS_MS, requestRetryDelay, watchRequestRefresh} from "../src/request-refresh.mjs";

function surface() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    emit(name, event = {}) { for (const listener of listeners.get(name) || []) listener(event); },
    listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

function browser() {
  let currentTime = 0;
  let nextTimer = 0;
  const timers = new Map();
  const timeouts = new Map();
  const writes = [];
  const doc = {...surface(), visibilityState: "visible"};
  const win = {
    ...surface(), document: doc,
    localStorage: {setItem: (...args) => writes.push(args)},
    setInterval(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, delay}); return id; },
    clearInterval(id) { timers.delete(id); },
    setTimeout(callback, delay) { const id = ++nextTimer; timeouts.set(id, {callback, delay}); return id; },
    clearTimeout(id) { timeouts.delete(id); },
  };
  return {
    win, doc, timers, timeouts, writes,
    options: {win, doc, now: () => currentTime},
    advance(ms = 1_001) { currentTime += ms; },
    poll() { for (const {callback} of timers.values()) callback(); },
    // The waits of the early retries now pending, in milliseconds.
    retryWaits() { return [...timeouts.values()].map(({delay}) => delay); },
    // Lets the pending early retry come due.
    retry() { for (const [id, {callback}] of [...timeouts]) { timeouts.delete(id); callback(); } },
  };
}
// The longest wait of each step, so the tests do not depend on chance.
const steadyRetry = (failure, failures) => requestRetryDelay(failure, failures, {random: () => 0});

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return {promise, resolve, reject};
}

test("request refresh polls every thirty seconds only while visible and cleans up all listeners", async () => {
  const b = browser();
  let calls = 0;
  const stop = watchRequestRefresh(() => { calls++; }, b.options);
  assert.equal(calls, 0, "the existing initial load is not duplicated");
  assert.equal([...b.timers.values()][0].delay, 30_000);
  b.poll();
  await flush();
  assert.equal(calls, 1);
  b.doc.visibilityState = "hidden";
  b.poll(); b.win.emit("focus"); b.doc.emit("visibilitychange");
  assert.equal(calls, 1);
  b.doc.visibilityState = "visible";
  b.doc.emit("visibilitychange");
  await flush();
  assert.equal(calls, 2);
  stop(); stop();
  assert.equal(b.win.listenerCount(), 0);
  assert.equal(b.doc.listenerCount(), 0);
  assert.equal(b.timers.size, 0);
  b.poll(); b.win.emit("focus");
  assert.equal(calls, 2);
});

test("return-to-tab events refresh immediately but their event burst is deduplicated", async () => {
  const b = browser();
  let calls = 0;
  const stop = watchRequestRefresh(() => { calls++; }, b.options);
  b.win.emit("focus"); b.doc.emit("visibilitychange"); b.win.emit("pageshow");
  await flush();
  assert.equal(calls, 1);
  b.advance(); b.win.emit("online");
  await flush();
  b.advance(); b.win.emit("pageshow");
  await flush();
  assert.equal(calls, 3);
  stop();
});

test("overlapping polling and mutation invalidations coalesce into one serial follow-up", async () => {
  const b = browser();
  const loads = [];
  let active = 0, maximumActive = 0;
  const stop = watchRequestRefresh(async () => {
    active++; maximumActive = Math.max(maximumActive, active);
    const load = deferred(); loads.push(load);
    await load.promise;
    active--;
  }, {...b.options, initial: true});
  assert.equal(loads.length, 1);
  b.poll(); b.poll();
  b.win.emit("storage", {key: REQUEST_CHANGE_STORAGE_KEY, newValue: "invalidation-1"});
  b.win.emit("storage", {key: REQUEST_CHANGE_STORAGE_KEY, newValue: "invalidation-2"});
  assert.equal(loads.length, 1);
  loads[0].resolve(); await flush();
  assert.equal(loads.length, 2);
  loads[1].resolve(); await flush();
  assert.equal(loads.length, 2);
  assert.equal(maximumActive, 1);
  stop();
});

test("a real hidden-to-visible return is not swallowed by the previous event burst", async () => {
  const b = browser();
  let calls = 0;
  const stop = watchRequestRefresh(() => { calls++; }, b.options);
  b.win.emit("focus"); await flush();
  b.doc.visibilityState = "hidden";
  b.doc.emit("visibilitychange");
  b.doc.visibilityState = "visible";
  b.doc.emit("visibilitychange"); b.win.emit("focus");
  await flush();
  assert.equal(calls, 2);
  stop();
});

test("refresh continues after a rejected request and a throwing error callback", async () => {
  const b = browser();
  const errors = [];
  let calls = 0;
  const stop = watchRequestRefresh(() => {
    calls++;
    if (calls === 1) return Promise.reject(new Error("Temporary connection failure"));
    if (calls === 2) throw new Error("Temporary synchronous failure");
  }, {...b.options, initial: true, onError(error) { errors.push(error.message); throw new Error("Ignored reporter error"); }});
  await flush();
  b.poll(); await flush();
  b.poll(); await flush();
  assert.equal(calls, 3);
  assert.equal(errors.length, 2);
  stop();
});

test("cleanup prevents an in-flight request from starting its queued follow-up", async () => {
  const b = browser();
  const load = deferred();
  let calls = 0;
  const stop = watchRequestRefresh(() => { calls++; return load.promise; }, {...b.options, initial: true});
  b.poll();
  stop();
  load.resolve(); await flush();
  assert.equal(calls, 1);
});

test("only request storage invalidations trigger refresh and hidden tabs wait until visible", async () => {
  const b = browser();
  let calls = 0;
  const stop = watchRequestRefresh(() => { calls++; }, b.options);
  for (const event of [{key: "another-key", newValue: "x"}, {key: REQUEST_CHANGE_STORAGE_KEY, newValue: null}, {key: null}]) b.win.emit("storage", event);
  assert.equal(calls, 0);
  b.doc.visibilityState = "hidden";
  b.win.emit("storage", {key: REQUEST_CHANGE_STORAGE_KEY, newValue: "new-change"});
  assert.equal(calls, 0);
  b.doc.visibilityState = "visible";
  b.doc.emit("visibilitychange");
  await flush();
  assert.equal(calls, 1);
  b.win.emit("storage", {key: REQUEST_CHANGE_STORAGE_KEY, newValue: "second-change"});
  await flush();
  assert.equal(calls, 2, "a mutation is not suppressed by the resume debounce");
  stop();
});

test("a queued refresh stays paused if the tab becomes hidden before a fetch settles", async () => {
  const b = browser();
  const load = deferred();
  let calls = 0;
  const stop = watchRequestRefresh(() => { calls++; return calls === 1 ? load.promise : undefined; }, {...b.options, initial: true});
  b.poll();
  b.doc.visibilityState = "hidden";
  load.resolve(); await flush();
  assert.equal(calls, 1);
  b.doc.visibilityState = "visible";
  b.doc.emit("visibilitychange"); await flush();
  assert.equal(calls, 2);
  stop();
});

test("cross-tab notification contains only an invalidation token and handles unavailable storage", () => {
  const b = browser();
  assert.equal(notifyRequestChange(b.win), true);
  assert.equal(notifyRequestChange(b.win), true);
  assert.equal(b.writes.length, 2);
  for (const [key, value] of b.writes) {
    assert.equal(key, REQUEST_CHANGE_STORAGE_KEY);
    assert.match(value, /^\d+:[a-z0-9]+$/);
  }
  assert.notEqual(b.writes[0][1], b.writes[1][1]);
  assert.equal(notifyRequestChange({get localStorage() { throw new Error("Storage unavailable"); }}), false);
  assert.doesNotThrow(() => watchRequestRefresh(() => {}, {win: null, doc: null})());
});

test("a failed load waits 5, 10, then 15 seconds, a little less by chance, and never for a call the server refused", () => {
  assert.deepEqual([...REQUEST_RETRY_DELAYS_MS], [5_000, 10_000, 15_000]);
  const unavailable = Object.assign(new Error("Could not load requests"), {status: 503});
  assert.deepEqual([1, 2, 3, 4, 9].map((failures) => steadyRetry(unavailable, failures)), [5_000, 10_000, 15_000, 15_000, 15_000]);
  assert.equal(requestRetryDelay(unavailable, 1, {random: () => 1}), 4_000);
  assert.equal(requestRetryDelay(unavailable, 3, {random: () => 0.5}), 13_500);
  for (let attempt = 0; attempt < 50; attempt++) {
    const wait = requestRetryDelay(unavailable, 3);
    assert.ok(wait >= 12_000 && wait <= 15_000, `unexpected wait ${wait}`);
  }
  assert.equal(steadyRetry(new Error("Live loading timed out"), 0), 5_000);
  for (const status of [500, 502, 503, 504]) assert.equal(steadyRetry({status}, 1), 5_000);
  for (const status of [400, 401, 403, 404, 429]) assert.equal(steadyRetry({status}, 1), 0, `HTTP ${status} waits for the regular refresh`);
});

test("a failed first load is tried again after seconds, not at the next thirty-second refresh", async () => {
  const b = browser();
  let calls = 0, healthy = false;
  const stop = watchRequestRefresh(async () => {
    calls++;
    if (!healthy) throw Object.assign(new Error("Could not load requests"), {status: 503});
  }, {...b.options, initial: true, retryDelay: steadyRetry});
  await flush();
  assert.equal(calls, 1);
  assert.deepEqual(b.retryWaits(), [5_000]);
  b.retry(); await flush();
  assert.deepEqual(b.retryWaits(), [10_000]);
  b.retry(); await flush();
  assert.deepEqual(b.retryWaits(), [15_000]);
  b.retry(); await flush();
  assert.deepEqual(b.retryWaits(), [15_000], "the last wait repeats while the server stays down");
  healthy = true;
  b.retry(); await flush();
  assert.equal(calls, 5);
  assert.deepEqual(b.retryWaits(), [], "a successful load ends the early retries");
  healthy = false;
  b.poll(); await flush();
  assert.deepEqual(b.retryWaits(), [5_000], "a later failure starts again from the shortest wait");
  stop();
  assert.equal(b.timeouts.size, 0, "stopping cancels the pending retry");
  b.retry(); await flush();
  assert.equal(calls, 6);
});

test("early retry is on unless the caller switches it off", async () => {
  const failing = async () => { throw new Error("Server restarting"); };
  const on = browser();
  const stopOn = watchRequestRefresh(failing, {...on.options, initial: true});
  await flush();
  const [wait] = on.retryWaits();
  assert.ok(wait >= 4_000 && wait <= 5_000, `unexpected wait ${wait}`);
  stopOn();

  const off = browser();
  const stopOff = watchRequestRefresh(failing, {...off.options, initial: true, retryDelay: null});
  await flush();
  assert.deepEqual(off.retryWaits(), []);
  stopOff();
});

test("a load that resolves to a failed state is retried too, unless the sign-in was refused", async () => {
  const b = browser();
  const results = [
    {loaded: false, error: "The server is reconnecting to the database. Please retry in a moment.", status: 503},
    {loaded: false, error: "Dashboard request loading timed out. Please retry."},
    {loaded: false, error: "Access denied", status: 403},
    {loaded: true, error: "", records: []},
    [],
    undefined,
  ];
  let calls = 0;
  const stop = watchRequestRefresh(async () => results[calls++], {...b.options, initial: true, retryDelay: steadyRetry});
  await flush();
  assert.deepEqual(b.retryWaits(), [5_000]);
  b.retry(); await flush();
  assert.deepEqual(b.retryWaits(), [10_000]);
  b.retry(); await flush();
  assert.deepEqual(b.retryWaits(), [], "a refused sign-in waits for the regular refresh");
  for (let poll = 0; poll < 3; poll++) {
    b.poll(); await flush();
    assert.deepEqual(b.retryWaits(), [], "a loaded state, a list and no result are not failures");
  }
  assert.equal(calls, 6);
  stop();
});

test("the regular refresh and the early retry never run twice, and a hidden tab waits", async () => {
  const b = browser();
  let calls = 0;
  const stop = watchRequestRefresh(async () => { calls++; throw new Error("Server restarting"); }, {...b.options, initial: true, retryDelay: steadyRetry});
  await flush();
  assert.deepEqual(b.retryWaits(), [5_000]);
  b.poll(); await flush();
  assert.equal(calls, 2);
  assert.deepEqual(b.retryWaits(), [10_000], "the regular refresh replaces the pending retry instead of adding one");
  b.doc.visibilityState = "hidden";
  b.retry(); await flush();
  assert.equal(calls, 2, "nothing is loaded while the tab is hidden");
  assert.deepEqual(b.retryWaits(), []);
  b.doc.visibilityState = "visible";
  b.doc.emit("visibilitychange"); await flush();
  assert.equal(calls, 3, "returning to the tab loads at once");
  stop();
});

test("early retries are skipped on data-saver connections, in windows without timers and when the wait cannot be worked out", async () => {
  const failing = async () => { throw new Error("Server restarting"); };
  const saver = browser();
  saver.win.navigator = {connection: {saveData: true}};
  const stopSaver = watchRequestRefresh(failing, {...saver.options, initial: true, retryDelay: steadyRetry});
  await flush();
  assert.deepEqual(saver.retryWaits(), []);
  stopSaver();

  const bare = browser();
  delete bare.win.setTimeout;
  delete bare.win.clearTimeout;
  let calls = 0;
  const stopBare = watchRequestRefresh(async () => { calls++; throw new Error("Server restarting"); }, {...bare.options, initial: true});
  await flush();
  bare.poll(); await flush();
  assert.equal(calls, 2, "the regular refresh still runs");
  stopBare();

  const broken = browser();
  const stopBroken = watchRequestRefresh(failing, {...broken.options, initial: true, retryDelay() { throw new Error("Ignored"); }});
  await flush();
  assert.deepEqual(broken.retryWaits(), []);
  stopBroken();
});
