import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("table print layout suppresses browser headers and keeps report spacing", () => {
  const source = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  // Owner, 16 Nov 2026: every print is A3 landscape, so the page size is fixed and the print window opens on A3 by itself
  // (before that the page was a generic landscape so the window kept its Paper size option).
  assert.match(source, /@page\{size:\$\{page\.name\} landscape;margin:0\}body\{margin:12mm\}/);
  // Headings wrap in a navy row with white text, as in Excel and the PDF; cells wrap inside their column.
  assert.match(source, /th\{background:#10284c;color:#fff;font-weight:700;font-size:9px;text-transform:uppercase;white-space:normal\}/);
  assert.match(source, /td\{white-space:pre-wrap\}/);
  // The preview itself warns when the print window's paper is not the size chosen in Smart Print.
  assert.match(source, /@media print and \(\$\{page\.name === "A3" \? "max-width" : "min-width"\}:350mm\)\{\.paper-warning\{display:block\}\}/);
  assert.match(source, /<div class="paper-warning">Paper size does not match: this report was prepared for \$\{page\.name\}\./);
  // The chosen A3/A4 page drives the hidden layout width, and wide reports are scaled down to fit it.
  assert.match(source, /frame\.style\.width = `\$\{page\.widthMm\}mm`;/);
  assert.match(source, /printFitScale\(Math\.max\(0, \.\.\.tables\.map/);
  assert.match(source, /<body><h1>\$\{escapeExportHtml\(title\)\}<\/h1>/);
});
