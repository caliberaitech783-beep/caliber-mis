import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { gzipSync } from "node:zlib";

const main = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const metrics = readFileSync(new URL("../shared/dashboard-equipment-metrics.mjs", import.meta.url), "utf8");
const lifecycle = main.slice(main.indexOf("  const requestLifecycleRows ="), main.indexOf("  // Keep all six compact series"));

test("request lifecycle aggregates rows and daily counts without scanning every row per date", () => {
  assert.match(lifecycle, /for \(const record of locationBreakdowns\)/);
  assert.match(lifecycle, /dateCounts\[metric\]\.set/);
  assert.match(lifecycle, /misLifecycleDateCounts\.get\(date\)/);
  assert.doesNotMatch(lifecycle, /requestTrendDateKeys\.map[\s\S]*requestLifecycleRows\.[a-z]+\.filter/);
});

test("unchanged long-poll responses do not commit a new notification list", () => {
  assert.match(main, /revision !== itemsRevisionRef\.current/);
});

test("unchanged fleet and request polls do not rebuild the dashboard", () => {
  const fleet304 = main.slice(main.indexOf("if (data?.notModified)"), main.indexOf("if (!Array.isArray(data.records)"));
  assert.doesNotMatch(fleet304, /setUpdatedAt/);
  assert.match(main, /if \(current\.token === session\.token && current\.loaded && !current\.error\) return current;/);
});

test("closed drilldowns skip asset-to-request enrichment and table searches stay responsive", () => {
  assert.match(main, /const assetDrilldownRows = !assetDrilldown \? \[\]/);
  assert.match(main, /function DashboardCardSearch/);
  assert.ok((main.match(/useDeferredValue\(query\)/g) || []).length >= 3);
});

test("fleet counts and detail rows resolve requests with indexes instead of nested scans", () => {
  const chart = metrics.slice(metrics.indexOf("export function fleetChartCounts"), metrics.indexOf("export function fleetBreakdownCaseCounts"));
  const details = metrics.slice(metrics.indexOf("export function fleetAssetRequestDetails"));
  assert.match(chart, /liveEquipmentRoadStatuses\(records, requests\)/);
  assert.match(details, /const resolve = createFleetAssetResolver\(records\)/);
  assert.match(details, /const currentByIndex = new Map\(\)/);
  assert.doesNotMatch(details, /active\.filter/);
});

test("production build separates framework, icons and large reporting libraries", () => {
  const config = readFileSync(new URL("../vite.config.mjs", import.meta.url), "utf8");
  for (const chunk of ["react-vendor", "icons", "image-export-vendor", "replay-vendor"]) assert.match(config, new RegExp(`return "${chunk}"`));
});

const dist = new URL("../dist/", import.meta.url);
const entry = new URL("index.html", dist);
test("the built entry defers PDF, scanning, and batch reports", { skip: !existsSync(entry) }, () => {
  const html = readFileSync(entry, "utf8");
  const startupAssets = [...html.matchAll(/(?:src|href)="(\/app-assets\/[^"]+)"/g)].map(([, asset]) => asset);
  assert.ok(startupAssets.length > 0);
  let compressedBytes = 0;
  for (const asset of startupAssets) {
    assert.doesNotMatch(asset, /\/(?:pdf-vendor|jspdf|bulk-card-scanning|vlb-batch-reports)-/);
    compressedBytes += gzipSync(readFileSync(new URL(asset.slice(1), dist))).length;
  }
  assert.ok(compressedBytes < 750_000, `Startup assets total ${compressedBytes} compressed bytes`);
});
