/**
 * Performance monitor: measures why the app feels slow, in memory only.
 *
 * - Server freezes: a 500 ms timer that fires late means the event loop was
 *   blocked (CPU work such as OCR, image encoding or PDF building). Each freeze
 *   records which API requests and background jobs were running at the time.
 * - API timing per route: count, average, 95th percentile, slowest, slow count.
 * - Database pool: how many queries had to wait for a free connection.
 * - Per-minute history for the last 24 hours (requests, freezes, memory, CPU).
 *
 * Nothing is written to the database; numbers reset when the server restarts.
 */
import {monitorEventLoopDelay} from 'node:perf_hooks';

export const FREEZE_THRESHOLD_MS = 300;
export const SLOW_REQUEST_MS = 1000;
const TICK_MS = 500;
const HISTORY_MINUTES = 24 * 60;
const MAX_ROUTES = 300;
const ROUTE_SAMPLES = 200;
const MAX_FREEZES = 100;

/** "/api/requests/BD-2026-0042/trip-card" -> "/api/requests/:id/trip-card" */
export function normalizeRoutePath(path = '') {
  const clean = String(path).split('?')[0];
  return clean.split('/').map((part) => (/\d/.test(part) || part.length > 40 ? ':id' : part)).join('/') || '/';
}

export function percentile(values, share) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)];
}

const round = (value) => Math.round(Number(value) || 0);

export function createPerformanceMonitor({
  pool = null,
  now = () => Date.now(),
  freezeThresholdMs = FREEZE_THRESHOLD_MS,
  slowRequestMs = SLOW_REQUEST_MS,
  log = console,
} = {}) {
  const startedAt = now();
  const active = new Map();
  const activeJobs = new Map();
  const routes = new Map();
  const freezes = [];
  // A fully synchronous block ends before the late timer fires, so work that
  // finished moments ago is kept briefly to name what caused the freeze.
  const recentlyFinished = [];
  const finished = (kind, label) => {
    recentlyFinished.push({kind, label, endedAt: now()});
    if (recentlyFinished.length > 50) recentlyFinished.shift();
  };
  const minutes = [];
  let nextId = 1;
  let timer = null;
  let histogram = null;
  let lastTick = startedAt;
  let lastCpu = process.cpuUsage();
  let lastCpuAt = now();
  let totals = {requests: 0, slowRequests: 0, freezes: 0, longestFreezeMs: 0, poolWaitSamples: 0, poolMaxWaiting: 0};

  const minuteBucket = (time = now()) => {
    const minute = Math.floor(time / 60000) * 60000;
    let bucket = minutes[minutes.length - 1];
    if (!bucket || bucket.minute !== minute) {
      bucket = {minute, requests: 0, slowRequests: 0, freezes: 0, longestFreezeMs: 0, poolMaxWaiting: 0, rssMb: 0, cpuPercent: 0, loopDelayP99Ms: 0};
      minutes.push(bucket);
      if (minutes.length > HISTORY_MINUTES) minutes.shift();
    }
    return bucket;
  };

  const closeMinute = () => {
    const bucket = minuteBucket();
    bucket.rssMb = Math.max(bucket.rssMb, round(process.memoryUsage().rss / 1048576));
    const cpu = process.cpuUsage(lastCpu), elapsed = Math.max(1, now() - lastCpuAt);
    bucket.cpuPercent = Math.max(bucket.cpuPercent, round(((cpu.user + cpu.system) / 1000 / elapsed) * 100));
    lastCpu = process.cpuUsage();
    lastCpuAt = now();
    if (histogram) {
      bucket.loopDelayP99Ms = Math.max(bucket.loopDelayP99Ms, round(histogram.percentile(99) / 1e6));
      histogram.reset();
    }
  };

  const endedDuring = (kind, at, lagMs) => recentlyFinished
    .filter((entry) => entry.kind === kind && entry.endedAt >= at - lagMs - TICK_MS)
    .map((entry) => entry.label);

  const recordFreeze = (lagMs, at = now()) => {
    const freeze = {
      at: new Date(at).toISOString(),
      blockedMs: round(lagMs),
      requests: [
        ...[...active.values()].map((entry) => `${entry.method} ${entry.route} (${round(at - entry.startedAt)} ms)`),
        ...endedDuring('request', at, lagMs).map((label) => `${label} (finished)`),
      ].slice(0, 10),
      jobs: [...new Set([...[...activeJobs.values()].map((entry) => entry.name), ...endedDuring('job', at, lagMs)])].slice(0, 10),
    };
    freezes.push(freeze);
    if (freezes.length > MAX_FREEZES) freezes.shift();
    totals.freezes += 1;
    totals.longestFreezeMs = Math.max(totals.longestFreezeMs, freeze.blockedMs);
    const bucket = minuteBucket(at);
    bucket.freezes += 1;
    bucket.longestFreezeMs = Math.max(bucket.longestFreezeMs, freeze.blockedMs);
    log.warn?.(JSON.stringify({event: 'server_freeze', ...freeze}));
    return freeze;
  };

  const tick = () => {
    const current = now();
    const lag = current - lastTick - TICK_MS;
    lastTick = current;
    if (lag >= freezeThresholdMs) recordFreeze(lag, current);
    const waiting = pool?.waitingCount ?? 0;
    if (waiting > 0) totals.poolWaitSamples += 1;
    totals.poolMaxWaiting = Math.max(totals.poolMaxWaiting, waiting);
    const bucket = minuteBucket(current);
    bucket.poolMaxWaiting = Math.max(bucket.poolMaxWaiting, waiting);
    if (current - lastCpuAt >= 60000) closeMinute();
  };

  return {
    start() {
      if (timer) return;
      try { histogram = monitorEventLoopDelay({resolution: 20}); histogram.enable(); } catch { histogram = null; }
      lastTick = now();
      timer = setInterval(tick, TICK_MS);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
      histogram?.disable();
    },
    tick,
    recordFreeze,

    /** Call when an API request begins; returns a function to call when it ends. */
    beginRequest(method, path) {
      const id = nextId++;
      const entry = {method, route: normalizeRoutePath(path), startedAt: now()};
      active.set(id, entry);
      return (status = 200) => {
        if (!active.delete(id)) return 0;
        const durationMs = now() - entry.startedAt;
        const key = `${entry.method} ${entry.route}`;
        finished('request', key);
        let stats = routes.get(key);
        if (!stats) {
          if (routes.size >= MAX_ROUTES) return durationMs;
          stats = {route: key, count: 0, totalMs: 0, maxMs: 0, slow: 0, errors: 0, samples: []};
          routes.set(key, stats);
        }
        stats.count += 1;
        stats.totalMs += durationMs;
        stats.maxMs = Math.max(stats.maxMs, durationMs);
        if (status >= 500) stats.errors += 1;
        stats.samples.push(durationMs);
        if (stats.samples.length > ROUTE_SAMPLES) stats.samples.shift();
        const bucket = minuteBucket();
        bucket.requests += 1;
        totals.requests += 1;
        if (durationMs >= slowRequestMs) {
          stats.slow += 1;
          bucket.slowRequests += 1;
          totals.slowRequests += 1;
        }
        return durationMs;
      };
    },

    /** Wraps a background job so freezes can name what was running. */
    async trackJob(name, task) {
      const id = nextId++;
      activeJobs.set(id, {name: String(name || 'Background job'), startedAt: now()});
      try { return await task(); } finally { activeJobs.delete(id); finished('job', String(name || 'Background job')); }
    },

    snapshot() {
      const routeRows = [...routes.values()].map((stats) => ({
        route: stats.route,
        count: stats.count,
        averageMs: round(stats.totalMs / stats.count),
        p95Ms: round(percentile(stats.samples, 0.95)),
        maxMs: round(stats.maxMs),
        slow: stats.slow,
        errors: stats.errors,
        totalSeconds: round(stats.totalMs / 1000),
      }));
      const lastHour = minutes.filter((bucket) => bucket.minute >= now() - 3600000);
      const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
      const max = (rows, key) => rows.reduce((value, row) => Math.max(value, row[key]), 0);
      return {
        measuredSince: new Date(startedAt).toISOString(),
        measuredMinutes: round((now() - startedAt) / 60000),
        totals: {...totals},
        lastHour: {
          requests: sum(lastHour, 'requests'),
          slowRequests: sum(lastHour, 'slowRequests'),
          freezes: sum(lastHour, 'freezes'),
          longestFreezeMs: max(lastHour, 'longestFreezeMs'),
          poolMaxWaiting: max(lastHour, 'poolMaxWaiting'),
          peakCpuPercent: max(lastHour, 'cpuPercent'),
          peakRssMb: max(lastHour, 'rssMb'),
        },
        database: {open: pool?.totalCount ?? 0, idle: pool?.idleCount ?? 0, waiting: pool?.waitingCount ?? 0, max: pool?.options?.max ?? null},
        runningNow: {
          requests: [...active.values()].map((entry) => `${entry.method} ${entry.route} (${round(now() - entry.startedAt)} ms)`),
          jobs: [...activeJobs.values()].map((entry) => `${entry.name} (${round((now() - entry.startedAt) / 1000)} s)`),
        },
        slowestRoutes: [...routeRows].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 20),
        busiestRoutes: [...routeRows].sort((a, b) => b.totalSeconds - a.totalSeconds).slice(0, 20),
        recentFreezes: [...freezes].reverse().slice(0, 30),
        minutes: minutes.slice(-HISTORY_MINUTES).map((bucket) => ({...bucket, minute: new Date(bucket.minute).toISOString()})),
      };
    },
  };
}

/** Summary for the Diagnostics page card. */
export function performanceDiagnostic(snapshot) {
  const hour = snapshot.lastHour;
  const worst = snapshot.slowestRoutes[0];
  const facts = [
    ['Measured for', snapshot.measuredMinutes < 60 ? `${snapshot.measuredMinutes} minutes` : `${(snapshot.measuredMinutes / 60).toFixed(1)} hours`],
    ['Server freezes (last hour)', `${hour.freezes}${hour.freezes ? `, longest ${hour.longestFreezeMs} ms` : ''}`],
    ['Slow requests (last hour)', `${hour.slowRequests} of ${hour.requests}`],
    ['Most waiting for database', `${hour.poolMaxWaiting} requests (pool of ${snapshot.database.max ?? '?'})`],
    ['Peak CPU / memory (last hour)', `${hour.peakCpuPercent}% / ${hour.peakRssMb} MB`],
  ];
  if (worst) facts.push(['Slowest page (95% finish within)', `${worst.route} ${worst.p95Ms} ms`]);
  const lastFreeze = snapshot.recentFreezes[0];
  if (lastFreeze) facts.push(['Last freeze was during', [...lastFreeze.jobs, ...lastFreeze.requests].slice(0, 3).join('; ') || 'nothing recorded']);
  let status = 'ok', detail = 'No server freezes or database waits in the last hour.';
  if (hour.freezes >= 5 || hour.longestFreezeMs >= 3000 || hour.poolMaxWaiting >= 5) {
    status = 'fail';
    detail = 'The server is freezing or running out of database connections. Users will see the app hang.';
  } else if (hour.freezes || hour.poolMaxWaiting || hour.slowRequests) {
    status = 'warn';
    detail = 'Some requests were slow or the server briefly froze in the last hour.';
  }
  return {status, detail, facts};
}
