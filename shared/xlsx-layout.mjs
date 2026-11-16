// Excel layout shared by every report workbook: the browser export (src/main.jsx), shared/report-xlsx.mjs and the
// emailed report workbooks (shared/director-report-bundle.mjs).
// Owner, 16 Nov 2026 (Step 4 · Every loading Excel): "text wrapped to customise the column ... presentable ... A3".
// A heading wraps onto up to three lines instead of making its column as wide as the heading; a column of plain numbers
// is saved as numbers so it sorts and adds up; the sheet prints A3 landscape, all columns on one page width, with the
// page number at the foot.

export const XLSX_PAGE_SETUP = '<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';

// Owner, 16 Nov 2026: "Excel reports are still not downloading in Smart Print". Opened in Excel on a PC, three kinds of
// report made Excel refuse the whole file: a column heading with a line break or tab in it, a table with no row under
// its headings (a report with no records), and a cell longer than 32,767 characters. Every workbook passes its headings,
// rows and cells through these three.
export const XLSX_CELL_LIMIT = 32767;
export const xlsxHeadingText = (label) => String(label ?? "").replace(/\s+/g, " ").trim();
const CUT_NOTE = " … (cut here: an Excel cell holds at most 32,767 characters)";
export function xlsxCellText(value) {
  const text = String(value ?? "");
  return text.length <= XLSX_CELL_LIMIT ? text : text.slice(0, XLSX_CELL_LIMIT - CUT_NOTE.length) + CUT_NOTE;
}
// An Excel table needs at least one row under its headings: a report with no records gets one line that says so.
export const xlsxTableRows = (rows = [], width = 1) => rows.length ? rows : [Array.from({ length: Math.max(1, width) }, (_, index) => index === Math.min(1, width - 1) ? "No records" : "")];

const longestLine = (value) => {
  let longest = 0;
  for (const line of String(value ?? "").split(/\r?\n/)) longest = Math.max(longest, line.length);
  return longest;
};
const words = (value) => String(value ?? "").trim().split(/\s+/).filter(Boolean);

// Lines a heading takes when a line holds `room` characters (bold 10 pt, about one character per width unit).
const linesIn = (label, room) => {
  let lines = 1, used = 0;
  for (const word of words(label)) {
    if (used && used + 1 + word.length > room) { lines += 1; used = word.length; }
    else used += (used ? 1 : 0) + word.length;
  }
  return lines;
};
export const xlsxHeadingLines = (label, width) => linesIn(label, Math.max(1, Math.floor(width) - 1));

// Column width in Excel characters: wide enough for the longest cell line (up to 48, longer text wraps), and for the
// heading only the narrowest room that holds it on three lines at most.
export function xlsxColumnWidth(label, cells = []) {
  let cell = 0;
  for (const value of cells) cell = Math.max(cell, longestLine(value));
  let room = Math.max(0, ...words(label).map((word) => word.length));
  while (room < 46 && linesIn(label, room) > 3) room += 1;
  return Math.min(48, Math.max(8, cell + 2, room + 1));
}

// Height of the heading row in points: room for its tallest heading.
export function xlsxHeadingHeight(labels = [], widths = []) {
  const lines = Math.max(1, ...labels.map((label, index) => xlsxHeadingLines(label, widths[index] ?? 12)));
  return Math.max(30, lines * 13 + 6);
}

const PLAIN_NUMBER = /^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/;
const BLANK = new Set(["", "—", "-"]);
// A column is saved as numbers only when every filled cell is a plain number: a door-number column with "128" next to
// "V-840" stays text, and so do leading-zero codes and long IDs.
export function xlsxNumericColumns(rows = [], columnCount = 0) {
  return Array.from({ length: columnCount }, (_, index) => {
    let numbers = 0;
    for (const row of rows) {
      const text = String(row[index] ?? "").trim();
      if (BLANK.has(text)) continue;
      if (!PLAIN_NUMBER.test(text)) return false;
      numbers += 1;
    }
    return numbers > 0;
  });
}
export const xlsxPlainNumber = (value) => {
  const text = String(value ?? "").trim();
  return PLAIN_NUMBER.test(text) ? String(Number(text)) : null;
};

const escapeXml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" }[character]));
// Footer: report title on the left, "Page 1 of 9" in the middle, the print date on the right.
export function xlsxFooter(title) {
  const name = String(title ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/&/g, "&&").slice(0, 90);
  return `<headerFooter><oddFooter>${escapeXml(`&L&8${name}&C&8Page &P of &N&R&8&D`)}</oddFooter></headerFooter>`;
}
