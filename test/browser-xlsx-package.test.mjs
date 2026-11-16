import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { recordCountLine, withSerialColumn } from "../shared/serial-column.mjs";
import * as xlsxLayout from "../shared/xlsx-layout.mjs";

function storedFiles(buffer) {
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(offset + 8), 0);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    files.set(name, buffer.subarray(start, start + size).toString("utf8"));
    offset = start + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  return files;
}

function browserXlsxBuilder() {
  const source = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  const start = source.indexOf("function escapeExportHtml");
  const end = source.indexOf("// Smart Print goes straight to the printer", start);
  assert.ok(start >= 0 && end > start, "browser XLSX builder source is present");
  return new Function(
    "withSerialColumn", "recordCountLine", "formatDisplayDateTime", "prepareXlsxExportSheets", "exportCellText", ...Object.keys(xlsxLayout),
    `${source.slice(start, end)}; return { buildXlsxSheetsWorkbook, escapeXlsxText };`,
  )(withSerialColumn, recordCountLine, () => "12:00 PM 22-09-26", () => [], String, ...Object.values(xlsxLayout));
}

test("browser XLSX worksheets use Excel's required element order and safe SpreadsheetML text", async () => {
  const { buildXlsxSheetsWorkbook, escapeXlsxText } = browserXlsxBuilder();
  assert.equal(escapeXlsxText("Control\u0001text\r\nnext"), "Control_x0001_text_x000D_\nnext");
  assert.equal(escapeXlsxText("literal _x0001_"), "literal _x005F_x0001_");

  const blob = buildXlsxSheetsWorkbook("BD & Balance", [
    { name: "Report", title: "BD Balance", columns: [{ label: "Daily updates" }], rows: [["2 updates"]] },
    { name: "Daily Updates", title: "Daily Updates", columns: [{ label: "Daily update" }], rows: [["Line one\nLine two"], ["Control\u0001text"], ["literal _x0001_"]] },
  ]);
  const files = storedFiles(Buffer.from(await blob.arrayBuffer()));
  assert.deepEqual([...files.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)), [
    "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
  ]);
  for (const name of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
    const xml = files.get(name);
    // Filter arrows come from the table part. A second sheet-level autoFilter over the table makes Excel refuse the file.
    assert.doesNotMatch(xml, /<autoFilter/, `${name} must leave the filter to its table`);
    assert.match(xml, /<mergeCells/);
    assert.doesNotMatch(xml, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/);
    assert.match(xml, /pageSetUpPr fitToPage="1"/);
    assert.match(xml, /orientation="landscape" fitToWidth="1" fitToHeight="0"/);
  }
  assert.match(files.get('xl/workbook.xml'), /name="_xlnm.Print_Area" localSheetId="0">&#39;Report&#39;!\$A\$1:\$B\$4/);
  assert.match(files.get('xl/workbook.xml'), /name="_xlnm.Print_Titles" localSheetId="1">&#39;Daily Updates&#39;!\$1:\$3/);
  assert.match(files.get("xl/worksheets/sheet2.xml"), /Control_x0001_text/);
  assert.match(files.get("xl/worksheets/sheet2.xml"), /literal _x005F_x0001_/);
  assert.match(files.get("docProps/core.xml"), /BD &amp; Balance/);
  assert.match(files.get("xl/tables/table1.xml"), /tableStyleInfo name="TableStyleLight15"/);
  assert.match(files.get("xl/tables/table1.xml"), /<autoFilter ref="A3:B4"\/>/);
  assert.match(files.get("xl/tables/table2.xml"), /<autoFilter ref="A3:B6"\/>/);
  assert.match(files.get("xl/styles.xml"), /left style="thin"><color rgb="FF000000"/);
  assert.match(files.get("xl/styles.xml"), /wrapText="1"/);
  assert.match(files.get("xl/styles.xml"), /fgColor rgb="FFF2F2F2"/);
  assert.match(files.get("xl/styles.xml"), /borderId="1" applyBorder="1"/);
  assert.match(files.get("xl/worksheets/sheet1.xml"), /r="A4" s="6"/);
  assert.match(files.get("xl/worksheets/sheet1.xml"), /tableParts count="1"/);
});

test("shared XLSX builder leaves the filter to the table so Excel opens the file", async () => {
  const { buildXlsxSheetsWorkbook } = await import("../shared/report-xlsx.mjs");
  const blob = await buildXlsxSheetsWorkbook("Idle stops of 20+ min", [{ name: "Report", columns: [{ label: "Machine" }, { label: "Idle (min)" }], rows: [["LPC73 -00130", "45"], ["LPC73 -00130", "99"]] }]);
  const files = storedFiles(Buffer.from(await blob.arrayBuffer()));
  assert.doesNotMatch(files.get("xl/worksheets/sheet1.xml"), /<autoFilter/);
  assert.match(files.get("xl/worksheets/sheet1.xml"), /tableParts count="1"/);
  assert.match(files.get("xl/tables/table1.xml"), /<autoFilter ref="A3:C5"\/>/);
});

test("report Excel prints A3, wraps long headings in narrow columns and saves number columns as numbers", async () => {
  const { buildXlsxSheetsWorkbook } = browserXlsxBuilder();
  const blob = buildXlsxSheetsWorkbook("Step 4 · Every loading", [{
    name: "Report", title: "Step 4 · Every loading · All sites",
    columns: [{ label: "Site" }, { label: "Door no." }, { label: "Gap from loading before (min)" }, { label: "Of it in BD (min)" }, { label: "Caliber ID" }],
    rows: [["Sasti OC", "128", "71", "—", "00123"], ["Majri OC", "V-840", "25", "4", "00456"]],
  }]);
  const files = storedFiles(Buffer.from(await blob.arrayBuffer()));
  const sheet = files.get("xl/worksheets/sheet1.xml");
  assert.match(sheet, /<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"\/>/);
  assert.match(sheet, /<oddFooter>&amp;L&amp;8Step 4 · Every loading · All sites&amp;C&amp;8Page &amp;P of &amp;N&amp;R&amp;8&amp;D<\/oddFooter>/);
  // The 29-letter heading gets a 13-wide column (three lines), not a 31-wide one; the heading row is tall enough.
  assert.match(sheet, /<col min="4" max="4" width="13" customWidth="1"\/>/);
  assert.equal(xlsxLayout.xlsxHeadingLines("Gap from loading before (min)", 13), 3);
  assert.match(sheet, /<row r="3" ht="45" customHeight="1">/);
  // Gap and BD are number columns ("—" stays text); door numbers and leading-zero IDs stay text.
  assert.match(sheet, /<c r="D4" s="6"><v>71<\/v><\/c>/);
  assert.match(sheet, /<c r="E5" s="1"><v>4<\/v><\/c>/);
  assert.match(sheet, /<c r="E4" s="6" t="inlineStr"><is><t xml:space="preserve">—<\/t>/);
  assert.match(sheet, /<c r="C4" s="6" t="inlineStr"><is><t xml:space="preserve">128<\/t>/);
  assert.match(sheet, /<c r="F4" s="6" t="inlineStr"><is><t xml:space="preserve">00123<\/t>/);
  assert.match(sheet, /<c r="A4" s="6"><v>1<\/v><\/c>/);
  // Heading row: white bold on navy.
  assert.match(files.get("xl/styles.xml"), /<b\/><sz val="10"\/><color rgb="FFFFFFFF"\/>/);
  assert.match(files.get("xl/styles.xml"), /fgColor rgb="FF10284C"/);
});
