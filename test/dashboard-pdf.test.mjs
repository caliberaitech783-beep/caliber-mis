import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dashboardPageSlices, dashboardPrintPdf, downloadDashboardPdf} from "../src/dashboard-pdf.mjs";

test("dashboard image uses opaque browser-encoded JPEG rather than PDF PNG conversion", () => {
  const source = readFileSync(new URL("../src/dashboard-pdf.mjs", import.meta.url), "utf8");
  assert.match(source, /getContext\("2d", \{alpha: false\}\)/);
  assert.match(source, /toDataURL\("image\/jpeg", 0\.98\), "JPEG"/);
  assert.doesNotMatch(source, /addImage\(part, "PNG"/);
});

test("dashboard PDF reports an unavailable dashboard without downloading", async () => {
  await assert.rejects(downloadDashboardPdf(null, "dashboard.pdf"), /Dashboard is not available/);
});

test("both KPI exports opt into visual PDF without changing ordinary table exports", () => {
  const source = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  assert.equal((source.match(/label="Print\/Export" dashboardPdf/g) || []).length, 2, "the manager KPI export and the whole fleet dashboard export");
  assert.match(source, /dashboardPdf = false/);
  assert.match(source, /if \(dashboardPdf\) \{[\s\S]*?downloadDashboardPdf[\s\S]*?return;\s*\}/);
  assert.match(source, /fetchPdfExport\("\/api\/exports\/pdf"/);
});

test("Smart Print on a dashboard prints the dashboard itself, not the KPI table", () => {
  const source = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const printReport = source.slice(source.indexOf("  const printReport = () => {"), source.indexOf("  if (printOnly) return"));
  assert.match(printReport, /if \(dashboardPdf\) \{\n\s+const dashboard = triggerRef\.current\?\.closest\("\.mine-dashboard, \.manager-dashboard"\);/, "the same dashboard element the PDF download captures");
  assert.match(printReport, /openSmartPrint\(\{ title, snapshot: "The dashboard prints exactly as it looks on screen/, "no KPI columns to pick");
  assert.match(printReport, /onPrint: \(\{ pageSize, printOptions \}\) => printDashboardReport\(\{ dashboard, title, pageSize, printOptions \}\)/);
  assert.match(printReport, /onPrint: printTableReport, formatCell: exportCellText \}\);/, "every other report still prints its table");
  const dashboardPrint = source.slice(source.indexOf("function printDashboardReport("), source.indexOf("function printTableReportInBrowser("));
  assert.match(dashboardPrint, /printReportDirect\(\{ title, pageSize, printOptions \}, async \(page\) => \(await loadCapture\(\)\)\.dashboardPrintPdf\(dashboard, page, section\)\)/, "the print helper gets the captured dashboard at the chosen paper size");
  assert.match(dashboardPrint, /if \(!sent\) await \(await loadCapture\(\)\)\.printDashboard\(dashboard, title, section\);/, "without the helper the captured dashboard opens in the browser print window");
  assert.match(source, /if \(buildPdf\) pdf = await buildPdf\(page\);\n\s+else \{/, "the preview and printer receive that PDF instead of the table");
});

test("printed dashboard pages cover every row once and end on the blank band between panels", () => {
  const blank = new Set([350, 720]);
  assert.deepEqual(dashboardPageSlices(1000, 400, row => blank.has(row)), [{top: 0, height: 350}, {top: 350, height: 370}, {top: 720, height: 280}]);
  assert.deepEqual(dashboardPageSlices(1000, 400), [{top: 0, height: 400}, {top: 400, height: 400}, {top: 800, height: 200}], "without a blank band a page is cut at its full height");
  assert.deepEqual(dashboardPageSlices(1000, 400, row => row === 100).slice(0, 1), [{top: 0, height: 400}], "a gap far above the page end is not used, so pages are not left half empty");
  assert.deepEqual(dashboardPageSlices(300, 400), [{top: 0, height: 300}], "a short dashboard is one page");
  for (const [total, page] of [[5000, 613.7], [1, 400], [2600, 2600]]) {
    const slices = dashboardPageSlices(total, page, row => row % 97 === 0);
    assert.equal(slices.reduce((sum, slice) => sum + slice.height, 0), total);
    slices.forEach((slice, index) => {
      assert.ok(slice.height > 0 && slice.height <= Math.floor(page));
      if (index) assert.equal(slice.top, slices[index - 1].top + slices[index - 1].height, "pages follow on without gaps or overlaps");
    });
  }
});

test("printing an unavailable dashboard is refused before anything is prepared", async () => {
  await assert.rejects(dashboardPrintPdf(null, {widthMm: 297, heightMm: 210}), /Dashboard is not available/);
});

test("a print starts with the clock row and keeps the sticky banner in its place", () => {
  const source = readFileSync(new URL("../src/dashboard-pdf.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(source, /const clockRow = forPrint \? document\.querySelector\("\.content > \.top, \.normal > header"\) : null;/, "the row with the live time and date, for prints only");
  assert.match(source, /root\.append\(rowClone, clone\);/, "the clock row sits above the dashboard, as on screen");
  assert.match(source, /root\.querySelectorAll\("\.export-menu, \.overlay, \[role=dialog\]"\)\.forEach\(node => node\.remove\(\)\);/);
  assert.match(source, /root\.querySelectorAll\("\*"\)\.forEach\(node => \{\n\s+const style = getComputedStyle\(node\);\n[^\n]*\n\s+if \(style\.position === "sticky"\) node\.style\.position = "static";/, "a banner pinned while the page is scrolled is not pushed down over the charts");
  assert.match(source, /const canvas = await toCanvas\(root, /, "the capture covers the clock row and the dashboard together");
  assert.match(source, /section\?\.setAttribute\("data-print-section", ""\);\n\s+const clone = dashboard\.cloneNode\(true\);\n\s+section\?\.removeAttribute\("data-print-section"\);/, "a section is marked only while the dashboard is copied");
  assert.match(source, /if \(section\) root = root\.querySelector\("\[data-print-section\]"\) \|\| root;\n\s+const width = /, "a section prints alone, rendered from inside the full copy");
});

test("a dashboard of sections ends its pages between sections and keeps a heading with its section", async () => {
  const {dashboardSectionSlices, dashboardPageFit} = await import("../src/dashboard-pdf.mjs");
  // Rows 300-304 are the small gap under a heading; rows 250-289 are the wide gap between two sections.
  const blank = row => (row >= 300 && row <= 304) || (row >= 250 && row <= 289);
  assert.deepEqual(dashboardSectionSlices(700, 400, blank, 20), [{top: 0, height: 289, ended: "section"}, {top: 289, height: 400, ended: "cut"}, {top: 689, height: 11, ended: "end"}], "the page ends in the wide gap, above the heading");
  assert.deepEqual(dashboardSectionSlices(500, 400, row => row === 390, 20).map(s => s.ended), ["row", "end"], "with no wide gap any blank row is used");
  for (const [total, page] of [[5000, 613.7], [1, 400], [2600, 2600]]) {
    const slices = dashboardSectionSlices(total, page, row => row % 97 < 3);
    assert.equal(slices.reduce((sum, slice) => sum + slice.height, 0), total, "every row is printed once");
    slices.forEach((slice, index) => { assert.ok(slice.height > 0 && slice.height <= Math.floor(page)); if (index) assert.equal(slice.top, slices[index - 1].top + slices[index - 1].height); });
  }
  // 1000 px wide, 2100 px tall, on a sheet that holds 1000 px of height at full width: three sheets, or two when drawn a little narrower.
  const plain = dashboardPageFit(1000, 2100, 500, 500, () => false, []);
  assert.equal(plain.slices.length, 3);
  assert.equal(plain.scale, 0.5, "other dashboards keep the full sheet width");
  const fitted = dashboardPageFit(1000, 2100, 500, 500, () => false, [1, 0.96, 0.92, 0.88, 0.84, 0.8]);
  assert.equal(fitted.slices.length, 2, "one sheet fewer");
  assert.ok(fitted.scale < 0.5 && fitted.scale >= 0.4, "never narrower than 80% of the sheet");
  assert.equal(dashboardPageFit(1000, 900, 500, 500, () => false, [1, 0.96, 0.8]).scale, 0.5, "a dashboard that already fits is not shrunk");
});

test("the MIS dashboard offers an A3 PDF and Smart Print of the complete page", () => {
  const read = file => readFileSync(new URL("../src/" + file, import.meta.url), "utf8");
  const screen = read("log-book-dashboard.jsx"), capture = read("dashboard-pdf.mjs"), host = read("mis-dashboard.jsx"), main = read("main.jsx");
  assert.match(screen, /const A3_PAGE=\{widthMm:420,heightMm:297\};/);
  assert.match(screen, /dashboardPrintPdf\(printTarget\(\),A3_PAGE\)/, "the PDF is the captured dashboard on A3 sheets");
  assert.match(screen, /closest\('\.erp-mis-dashboard'\)/, "banner, cards, graphs and both reports are captured together");
  assert.match(screen, /printDashboard\(\{dashboard,title:printTitle,pageSize,printOptions\}\)/, "Smart Print uses the paper, printer, pages and copies chosen");
  assert.match(screen, /className="lb-print-actions" data-print-hide=""/);
  assert.match(capture, /root\.querySelectorAll\("\[data-print-hide\]"\)\.forEach\(node => node\.remove\(\)\);/, "the buttons are left off the paper");
  assert.match(capture, /clone\.setAttribute\("data-printing", ""\);/, "wide tables get the width they need");
  assert.match(host, /className="erp-mis-dashboard" data-print-fit=""/);
  assert.equal((main.match(/ReportSection=\{ReportSection\} printDashboard=\{printDashboardReport\}/g) || []).length, 3);
});
