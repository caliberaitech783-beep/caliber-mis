// Owner's note of 16 Nov 2026 (REQUIREMENT.docx): Excel still not downloading in Smart Print, a Download History in the
// top bar, Breakdown in Pulse opening its details, and Gap time on the trip card.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import { recordCountLine, withSerialColumn } from "../shared/serial-column.mjs";
import * as xlsxLayout from "../shared/xlsx-layout.mjs";
import { buildXlsxSheetsWorkbook as sharedBuilder } from "../shared/report-xlsx.mjs";
import { saveToTarget } from "../src/save-as.mjs";
import { downloadBlob, fileKind, readCsvRows, readXlsxSheets, recordDownload } from "../src/download-history.mjs";
import { breakdownRequests } from "../shared/loading-machine-report.mjs";

function storedFiles(buffer) {
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    files.set(name, buffer.subarray(start, start + size).toString("utf8"));
    offset = start + size;
  }
  return files;
}
function browserBuilder() {
  const source = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  const start = source.indexOf("function escapeExportHtml"), end = source.indexOf("// Smart Print goes straight to the printer", start);
  return new Function("withSerialColumn", "recordCountLine", "formatDisplayDateTime", "prepareXlsxExportSheets", "exportCellText", ...Object.keys(xlsxLayout),
    `${source.slice(start, end)}; return buildXlsxSheetsWorkbook;`)(withSerialColumn, recordCountLine, () => "10:30 PM 16-11-26", () => [], String, ...Object.values(xlsxLayout));
}
const builders = [["browser", browserBuilder()], ["shared", sharedBuilder]];
const parse = (xml) => new DOMParser().parseFromString(xml, "application/xml");

// Each of these made Excel refuse the whole file when opened in Excel on 16 Nov 2026.
for (const [where, build] of builders) {
  test(`${where} Excel builder: a heading with a line break or tab is one line, in the cell and in the table`, async () => {
    const files = storedFiles(Buffer.from(await build("t", [{ name: "Report", columns: [{ label: "Shift A\nShift B" }, { label: "Tab\there" }], rows: [["1", "2"]] }]).arrayBuffer()));
    assert.match(files.get("xl/tables/table1.xml"), /name="Shift A Shift B"/);
    assert.match(files.get("xl/tables/table1.xml"), /name="Tab here"/);
    assert.match(files.get("xl/worksheets/sheet1.xml"), /<t xml:space="preserve">Shift A Shift B<\/t>/);
  });
  test(`${where} Excel builder: a report with no records still has one row under the headings`, async () => {
    const files = storedFiles(Buffer.from(await build("t", [{ name: "Report", columns: [{ label: "A" }, { label: "B" }], rows: [] }]).arrayBuffer()));
    assert.match(files.get("xl/tables/table1.xml"), /ref="A3:C4"/);
    assert.match(files.get("xl/worksheets/sheet1.xml"), /No records/);
    assert.match(files.get("xl/worksheets/sheet1.xml"), /0 records|No records/);
  });
  test(`${where} Excel builder: a cell longer than Excel holds is cut, with a note`, async () => {
    const files = storedFiles(Buffer.from(await build("t", [{ name: "Report", columns: [{ label: "A" }], rows: [["x".repeat(40000)]] }]).arrayBuffer()));
    const cell = files.get("xl/worksheets/sheet1.xml").match(/x{1000,}[^<]*/)[0];
    assert.ok(cell.length <= xlsxLayout.XLSX_CELL_LIMIT, `cell is ${cell.length} characters`);
    assert.match(cell, /cut here: an Excel cell holds at most 32,767 characters/);
  });
}

test("Save As: a write that never finishes is given up and the file goes to Downloads, with the reason", async () => {
  const steps = [], heard = [];
  const target = { name: "chosen.xlsx", createWritable: async () => ({ write: () => new Promise(() => {}), close: async () => steps.push("closed"), abort: async () => steps.push("aborted") }) };
  const outcome = await saveToTarget(target, { size: 1 }, "suggested.xlsx", (blob, name) => steps.push("downloaded " + name), { limitMs: 20, onWriteError: (error) => heard.push(error.name), record: null });
  assert.deepEqual(steps, ["aborted", "downloaded suggested.xlsx"]);
  assert.deepEqual(heard, ["TimeoutError"]);
  assert.equal(outcome.fallback, true);
  assert.match(outcome.reason, /did not finish taking the file within/);
});

test("Save As: a file saved in a chosen folder is kept in Download History", async () => {
  const kept = [];
  const target = { name: "Step 1.xlsx", createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
  const outcome = await saveToTarget(target, { size: 3 }, "s.xlsx", () => assert.fail("no download"), { record: (blob, name, info) => kept.push([name, info.where]) });
  assert.deepEqual(outcome, { saved: true, name: "Step 1.xlsx" });
  assert.deepEqual(kept, [["Step 1.xlsx", "folder"]]);
});

test("a download keeps its address long enough and is kept in Download History", () => {
  const clicked = [], kept = [], revoked = [];
  const body = { children: [], appendChild(node) { this.children.push(node); } };
  const doc = { body, createElement: () => ({ style: {}, click() { clicked.push(this.href); }, remove() { body.children = body.children.filter((n) => n !== this); } }) };
  const { createObjectURL, revokeObjectURL } = URL;
  const realTimeout = globalThis.setTimeout, timers = [];
  URL.createObjectURL = () => "blob:report"; URL.revokeObjectURL = (url) => revoked.push(url);
  globalThis.setTimeout = (fn, ms) => { timers.push(ms); return 0; };
  try { downloadBlob({ size: 1 }, "report.xlsx", { doc, record: (blob, name, info) => kept.push([name, info.where]) }); }
  finally { URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL; globalThis.setTimeout = realTimeout; }
  assert.deepEqual(clicked, ["blob:report"]);
  assert.equal(body.children.length, 0);
  assert.deepEqual(revoked, []);
  assert.ok(timers[0] >= 30000, "the address is kept for at least 30 s");
  assert.deepEqual(kept, [["report.xlsx", "downloads"]]);
});

test("Download History never stops a file where the browser keeps no history", async () => {
  assert.equal(await recordDownload({ size: 1 }, "a.pdf"), null);
  assert.equal(fileKind("a.xlsx"), "Excel");
  assert.equal(fileKind("Dashboard-A3.pdf"), "PDF");
  assert.equal(fileKind("scan-history.csv"), "CSV");
});

test("Open shows a kept Excel file as a table without Excel", async () => {
  const blob = await sharedBuilder("Step 1 · Loading machines", [{ name: "Report", columns: [{ label: "Site" }, { label: "Trips loaded" }], rows: [["Jayant OB", "84598"], ["Sasti OB", "65401"]] }]);
  const [sheet] = await readXlsxSheets(new Blob([await blob.arrayBuffer()]), { parse });
  assert.equal(sheet.name, "Report");
  assert.deepEqual(sheet.rows[2], ["Sr. No.", "Site", "Trips loaded"]);
  assert.deepEqual(sheet.rows[3], ["1", "Jayant OB", "84598"]);
  assert.equal(sheet.rows.length, 5);
});

test("Open shows a kept CSV file as a table", async () => {
  assert.deepEqual(await readCsvRows(new Blob(['Card,Site\r\n"V-1, A",Majri OB\n"say ""hi""",x'])), [["Card", "Site"], ["V-1, A", "Majri OB"], ['say "hi"', "x"]]);
});

test("Breakdown in Pulse details: one line per breakdown, whole length and the part inside the shift", () => {
  const source = [
    { reference: "REQ-1794", reason: "Hydraulic hose burst", status: "Restored", start: "2026-11-15T01:30:00.000Z", end: "2026-11-15T05:00:00.000Z" },
    { reference: "REQ-1794", reason: "Hydraulic hose burst", status: "Restored", start: "2026-11-15T01:30:00.000Z", end: "2026-11-15T05:00:00.000Z" },
    { reference: "REQ-1801", reason: "", ongoing: true, start: "2026-11-15T04:00:00.000Z", end: null },
  ];
  const periods = [{ reference: "REQ-1794", minutes: 150, fromClock: "08:30", toClock: "11:00" }];
  const rows = breakdownRequests(source, periods, Date.parse("2026-11-15T06:00:00.000Z"));
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].reference, rows[0].totalMinutes, rows[0].shiftMinutes, rows[0].inShift], ["REQ-1794", 210, 150, "08:30 to 11:00"]);
  assert.deepEqual([rows[1].reference, rows[1].reason, rows[1].status, rows[1].totalMinutes, rows[1].end], ["REQ-1801", "Not written in Pulse", "Ongoing", 120, ""]);
});

test("the trip cards carry Site, Date and the Gap time from loading to unloading, in order", () => {
  for (const file of ["../src/loading-machine-report.jsx", "../src/trip-timing-report.jsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const line = source.slice(source.indexOf("export const cardColumns="), source.indexOf("];", source.indexOf("export const cardColumns=")));
    const keys = [...line.matchAll(/column\('(\w+)'/g)].map((m) => m[1]);
    assert.deepEqual(keys.slice(0, 9), ["site", "date", "shift", "door", "sr", "machine", "trips", "loadingTime", "unloadingTime"], file);
    assert.ok(keys.indexOf("gapTime") === 9 || keys.indexOf("taken") === 9, `${file}: the gap time follows the unloading time`);
    assert.match(line, /Gap time · loading to unloading \(min\)|GAP_LABEL/);
  }
});
