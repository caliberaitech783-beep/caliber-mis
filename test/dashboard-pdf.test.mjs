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
  assert.equal((source.match(/<ExportMenu [^>]*dashboardPdf \/>/g) || []).length, 2, "the manager KPI export and the whole fleet dashboard export");
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
  assert.match(source, /const clockRow = forPrint && !reportPage \? document\.querySelector\("\.content > \.top, \.normal > header"\) : null;/, "the row with the live time and date, for prints only");
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

test("each report is drawn at the width where it fills one sheet", async () => {
  const {dashboardFitWidth} = await import("../src/dashboard-pdf.mjs");
  const aspect = 404 / 281;
  // Cards and graphs: nothing is cut off at any width and the height hardly changes, so the width follows the sheet shape.
  const cards = dashboardFitWidth(width => ({short: 0, width, height: 900}), aspect);
  assert.ok(cards >= 900 * aspect && cards <= 900 * aspect + 16, "about 1294 px wide, not the 2239 px that left half the sheet empty");
  // A table that needs 1500 px: never narrower than that, even though the sheet would have room below.
  const table = dashboardFitWidth(width => ({short: Math.max(0, 1500 - width), width, height: 600}), aspect);
  assert.ok(table >= 1500 && table <= 1516, "the table is shown whole");
  // A short report is drawn at the narrowest width, so its print is as large as it can be.
  assert.equal(dashboardFitWidth(width => ({short: 0, width, height: 300}), aspect), 960);
  // A report that gets shorter as it gets wider: the narrowest width at which it is not taller than the sheet.
  const reflow = dashboardFitWidth(width => ({short: 0, width, height: 1600000 / width}), aspect);
  assert.ok(reflow >= Math.sqrt(1600000 * aspect) && reflow <= Math.sqrt(1600000 * aspect) + 16);
  // Too long for one sheet at any width: the narrowest width that shows its tables whole, then it runs on to more sheets.
  assert.ok(dashboardFitWidth(width => ({short: Math.max(0, 1200 - width), width, height: 9000}), aspect) <= 1216);
  assert.equal(dashboardFitWidth(width => ({short: 5000 - width, width, height: 500}), aspect), 3200, "never wider than the limit");
});

test("the dashboard PDF gives each of its three reports its own sheet", () => {
  const read = file => readFileSync(new URL("../src/" + file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const screen = read("log-book-dashboard.jsx"), capture = read("dashboard-pdf.mjs"), css = read("log-book-dashboard.css");
  // The cards, then each report of a Sr No that is on screen; a Sr No hidden behind another tab gets no sheet.
  assert.match(screen, /className="lb-print-root" data-print-fit="" data-print-pages="\.lb-dashboard, \.lb-reports > \.lb-sr:not\(\[hidden\]\) > \*"/, "cards and graphs, Batch Status & Turnaround, OT & Multiple Duties");
  assert.match(css, /\.lb-sr\[hidden\]\{display:none\}/, "a hidden Sr No takes no room, on screen or in the copy that is printed");
  assert.match(screen, /\{printing&&<p role="status" className="lb-muted" data-print-hide="">/, "the 'Preparing the PDF' line is not printed");
  assert.match(capture, /const holder = section \? null : dashboard\.matches\?\.\("\[data-print-pages\]"\) \? dashboard : dashboard\.querySelector\?\.\("\[data-print-pages\]"\);/, "one section printed alone keeps its own layout");
  assert.match(capture, /for \(let index = 0; index < reports; index\+\+\) \{\n\s+const capture = await captureDashboard\(dashboard, \{forPrint: true, reportPage: \{selector, index, aspect: printableWidth \/ printableHeight, brand, logo\}\}\);/, "each report is captured for the shape of the chosen paper");
  assert.match(capture, /const paged = captures\.length > 0;\n\s+if \(!paged\) captures\.push\(await captureDashboard\(dashboard, \{forPrint: true, section\}\)\);/, "other dashboards print as before");
  assert.match(capture, /reports\.forEach\(node => \{ if \(node !== report\) node\.style\.display = "none"; \}\);/, "the other reports are left off that sheet");
  assert.match(capture, /report\.prepend\(printPageHeader\(report, reportPage\)\);\n\s+reportRoot = report;/, "every report stands alone under its own heading band");
  assert.match(capture, /host\.style\.width = `\$\{dashboardFitWidth\(measure, reportPage\.aspect\)\}px`;/);
  assert.match(capture, /if \(sheets\+\+\) pdf\.addPage\(\[pageWidth, pageHeight\], "landscape"\);/);
  assert.match(css, /\[data-printing\] \.lb-reports th\.column-filter-header\{min-width:0\}/, "table headings may wrap on paper, so the table can be drawn larger");
  assert.match(css, /\[data-printing\] \.lb-reports \.reports-detail-table th \.sort-header svg\{display:none\}/, "no sort arrows on paper");
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

test("each sheet of the dashboard PDF is dressed for paper: a heading band, page numbers and no screen controls", () => {
  const source = readFileSync(new URL("../src/dashboard-pdf.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(source, /const title = report\.getAttribute\("data-print-title"\) \|\| text\("header h1, header h2"\)/, "the band names the report");
  assert.match(source, /add\(meta, "span", "", "Printed " \+ istStamp\(new Date\(\)\) \+ " IST"\);/, "and says when it was printed");
  assert.match(source, /if \(paged\) for \(let sheet = 1; sheet <= sheets; sheet\+\+\) \{[\s\S]*?pdf\.text\(`Page \$\{sheet\} of \$\{sheets\}`/, "sheets of reports are numbered");
  const screen = readFileSync(new URL("../src/log-book-dashboard.jsx", import.meta.url), "utf8");
  assert.match(screen, /data-print-brand="Caliber Pulse-II" data-print-logo="\/pulse-ii-icon\.png"/);
  assert.match(screen, /data-print-title="VLB & ELB Dashboard"/);
  const css = readFileSync(new URL("../src/log-book-dashboard.css", import.meta.url), "utf8");
  assert.match(css, /\[data-printing\] :is\(\.lb-range,\.lb-footer,/, "the date boxes and buttons are left off the paper");
  assert.match(css, /\[data-printing\] \.lb-reports :is\(header,\.mp-heading,\.production-filters,[^)]*\.generated-report-search,\.report-table-pagination,/, "so are each report's filters, search box and page buttons");
  assert.match(css, /\[data-printing\] \*\{scrollbar-width:none\}/, "no scroll bars are drawn");
  assert.match(css, /\[data-printing\] \.lb-reports table tbody td\{font-size:16\.5px;color:#1a1330/, "table figures are large and dark");
});
