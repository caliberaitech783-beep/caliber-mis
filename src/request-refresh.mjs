import {adaptiveRefreshInterval, mobileDataProfile} from "./mobile-performance.mjs";

export const REQUEST_CHANGE_STORAGE_KEY = "bdms:requests:changed";
export const REQUEST_CHANGE_EVENT = "bdms:requests-changed";

// Waits before a failed load is tried again, by failures in a row; the last one repeats.
export const REQUEST_RETRY_DELAYS_MS = Object.freeze([5_000, 10_000, 15_000]);

// How long to wait before trying a failed load again; 0 leaves it to the regular timer.
// After a release the server refuses calls for about a minute. A dashboard opened in that
// minute used to stay on "Live request data is unavailable" until the next 30-second refresh.
export function requestRetryDelay(failure, failures = 1, {random = Math.random} = {}) {
  // A call the server refused (expired sign-in, no access, too many calls) is not cured by asking
  // again sooner. Only a server error, a dropped connection or a timeout is worth an early retry.
  const status = Number(failure?.status) || 0;
  if (status >= 400 && status < 500) return 0;
  const step = Math.min(Math.max(1, Math.floor(Number(failures)) || 1), REQUEST_RETRY_DELAYS_MS.length) - 1;
  // Up to a fifth sooner, so the pages open during a restart do not all come back in the same second.
  return Math.round(REQUEST_RETRY_DELAYS_MS[step] * (1 - 0.2 * Math.min(1, Math.max(0, Number(random()) || 0))));
}

// A load reports failure by throwing, or by resolving to a state whose `error` text is set.
const reportedFailure = (result) => Boolean(result) && typeof result === "object" && !Array.isArray(result)
  && typeof result.error === "string" && result.error !== "";

// Invalidate other tabs without copying records, account identifiers or credentials.
export function notifyRequestChange(win = globalThis.window) {
  // Revalidate other data consumers in this tab as well as other signed-in tabs.
  try { win.dispatchEvent(new win.Event(REQUEST_CHANGE_EVENT)); } catch {}
  try {
    win.localStorage.setItem(REQUEST_CHANGE_STORAGE_KEY, `${Date.now()}:${Math.random().toString(36).slice(2)}`);
    return true;
  } catch {
    // Storage may be disabled; visible tabs still refresh on their regular timer.
    return false;
  }
}

// Keep the shared request list fresh without concurrent refreshes or event bursts.
// The caller owns cancellation/stale-response protection for an in-flight fetch.
// A failed load is tried again after `retryDelay` instead of waiting for the next
// regular refresh; pass `retryDelay: null` to keep only the regular timer.
export function watchRequestRefresh(refresh, {
  win = globalThis.window,
  doc = win?.document,
  intervalMs = 30_000,
  now = Date.now,
  burstMs = 1_000,
  initial = false,
  onError,
  retryDelay = requestRetryDelay,
} = {}) {
  if (!win || !doc) return () => {};
  let disposed = false;
  let running = false;
  let queued = false;
  let lastResume = -Infinity;
  let failures = 0;
  let retryTimer = null;
  const visible = () => doc.visibilityState !== "hidden";
  const cancelRetry = () => {
    if (retryTimer === null) return;
    win.clearTimeout(retryTimer);
    retryTimer = null;
  };
  // Returns the wait before an early retry, or 0 when the regular timer should handle it.
  const earlyRetryAfter = (failure) => {
    failures += 1;
    if (typeof retryDelay !== "function" || typeof win.setTimeout !== "function" || typeof win.clearTimeout !== "function") return 0;
    // Data-saver and 2G connections keep their slow, cheap refresh.
    if (mobileDataProfile(win).constrained) return 0;
    try {
      const wait = Number(retryDelay(failure, failures));
      return Number.isFinite(wait) && wait > 0 ? wait : 0;
    } catch { return 0; }
  };
  const revalidate = async () => {
    if (disposed || !visible()) return;
    if (running) { queued = true; return; }
    running = true;
    queued = false;
    cancelRetry();
    let retryIn = 0;
    try {
      const result = await refresh();
      if (reportedFailure(result)) retryIn = earlyRetryAfter(result);
      else failures = 0;
    } catch (error) {
      // A transient error must not stop later refreshes or reject an event handler.
      try { onError?.(error); } catch {}
      retryIn = earlyRetryAfter(error);
    } finally {
      running = false;
      if (queued && !disposed && visible()) void revalidate();
      else if (retryIn > 0 && !disposed) retryTimer = win.setTimeout(() => { retryTimer = null; void revalidate(); }, retryIn);
    }
  };
  const resume = () => {
    if (disposed || !visible()) return;
    const currentTime = now();
    // Returning to a tab often emits pageshow, visibilitychange and focus together.
    if (!queued && currentTime >= lastResume && currentTime - lastResume < burstMs) return;
    lastResume = currentTime;
    void revalidate();
  };
  const visibilityChanged = () => {
    if (!visible()) { lastResume = -Infinity; return; }
    resume();
  };
  const changedElsewhere = (event) => {
    if (disposed || event.key !== REQUEST_CHANGE_STORAGE_KEY || !event.newValue) return;
    // Do not debounce mutations: one that arrives during a fetch needs a follow-up.
    if (!visible()) { queued = true; return; }
    void revalidate();
  };
  const resumeEvents = ["focus", "pageshow", "online"];
  for (const name of resumeEvents) win.addEventListener(name, resume);
  doc.addEventListener("visibilitychange", visibilityChanged);
  win.addEventListener("storage", changedElsewhere);
  win.addEventListener(REQUEST_CHANGE_EVENT, revalidate);
  const timer = win.setInterval(() => { void revalidate(); }, adaptiveRefreshInterval(win, intervalMs));
  if (initial) void revalidate();
  return () => {
    disposed = true;
    queued = false;
    for (const name of resumeEvents) win.removeEventListener(name, resume);
    doc.removeEventListener("visibilitychange", visibilityChanged);
    win.removeEventListener("storage", changedElsewhere);
    win.removeEventListener(REQUEST_CHANGE_EVENT, revalidate);
    win.clearInterval(timer);
    cancelRetry();
  };
}
