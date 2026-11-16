import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {MOBILE_NAVIGATION_ITEMS, navigationLabel} from "../shared/navigation-visibility.mjs";
import {ADMIN_SUBMENU_OPTIONS} from "../shared/admin-access.mjs";

test("the daily site-wise menu is displayed in plural", () => {
  assert.equal(navigationLabel("Daily site-wise report"), "Daily site-wise reports");
  assert.equal(navigationLabel("Daily OEM report"), "Daily OEM report");
  assert.equal(navigationLabel("Unknown page"), "Unknown page");
});

test("renaming the display label leaves the stored access key untouched", () => {
  assert.equal(MOBILE_NAVIGATION_ITEMS.includes("Daily site-wise report"), true);
  assert.equal(ADMIN_SUBMENU_OPTIONS["WhatsApp Integration"].options.includes("Daily site-wise report"), true);
});

test("navigation, breadcrumb, page title and access checkboxes render the label", () => {
  const source = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  assert.match(source, /import \{navigationLabel\} from "\.\.\/shared\/navigation-visibility\.mjs";/);
  assert.match(source, /: <>Operations <ChevronRight \/> <\/>\}<button type="button" className="crumb-page-link" onClick=\{reopenPage\}[^>]*><b>\{navigationLabel\(active\)\}<\/b><\/button>/);
});

test("every other page shows a Dashboard link in the breadcrumb", () => {
  const source = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  // Dashboard > <page> on every other page (it takes the place of "Operations",
  // so long page names keep their room); the Dashboard itself stays Operations > Dashboard.
  assert.match(source, /\{active !== "Dashboard" && canOpenAdminPage\("Dashboard"\)\s*\? <><button type="button" className="crumb-page-link crumb-dashboard-link" onClick=\{\(\) => \{setMenu\(false\);selectMenu\("Dashboard"\);\}\}[^>]*>Dashboard<\/button> <ChevronRight \/> <\/>\s*: <>Operations <ChevronRight \/> <\/>\}/);
  const css = fs.readFileSync(new URL("../src/back-button-motion.css", import.meta.url), "utf8");
  assert.match(css, /\.crumb \.crumb-page-link\.crumb-dashboard-link \{ flex: none; white-space: nowrap;/);
  // WhatsApp menu icons carry the navigation label as their name and tooltip.
  assert.match(source, /labelFor=\{navigationLabel\}/);
  assert.match(source, /<h1>\{navigationLabel\(type\)\}<\/h1>/);
  assert.match(source, /<span>\{navigationLabel\(option\)\}<\/span>/);
  assert.match(source, /<h2>Daily site-wise reports dispatch<\/h2>/);
});

test("clicking the page name in the breadcrumb opens that page again from the start", () => {
  const source = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  const reopen = source.match(/const reopenPage = \(\) => \{[\s\S]*?\n  \};/)?.[0] || "";
  assert.ok(reopen, "reopenPage exists");
  assert.match(reopen, /setPageOpenCount\(count => count \+ 1\);\s*selectMenu\(page\);/);
  // Filters kept in the app itself go back to their start values too.
  assert.match(reopen, /page === "Equipment master"[\s\S]*setEquipmentFilter\("all"\)/);
  assert.match(reopen, /page === "Breakdown master"[\s\S]*setBreakdownFleetFilter\(""\)/);
  // A new key builds the open page fresh, so drill-downs and steps close.
  assert.match(source, /<React\.Fragment key=\{`page-open-\$\{pageOpenCount\}`\}>\{adminPageContent\}<\/React\.Fragment>/);
});

test("entry and scan pages ask before the breadcrumb clears unsaved work", () => {
  const source = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  const list = source.match(/const PAGES_ASKING_BEFORE_REOPEN = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
  for (const page of ["Vehicle Log Book", "Equipment Log Book", "LMV Manual", "LMV Scan", "Trip Card Bulk Scan", "Job Card Bulk Scan", "Create VLB Batch"]) {
    assert.ok(list.includes(`"${page}"`), `${page} asks first`);
  }
  assert.ok(!list.includes('"Dashboard"'), "Dashboard reopens without a question");
  assert.match(source, /if \(PAGES_ASKING_BEFORE_REOPEN\.has\(page\) && !window\.confirm\([^\n]*\)\) return;/);
});
