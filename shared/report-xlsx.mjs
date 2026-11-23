import {recordCountLine,withSerialColumn,isSerialColumn,serialTone,SERIAL_XLSX_STYLES} from "./serial-column.mjs";
import {formatDisplayDateTime} from "./date-time-format.mjs";
import {XLSX_PAGE_SETUP,xlsxCellText,xlsxColumnWidth,xlsxFooter,xlsxHeadingHeight,xlsxHeadingText,xlsxNumericColumns,xlsxPlainNumber,xlsxTableRows} from "./xlsx-layout.mjs";
function escapeExportHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[character]));
}
// SpreadsheetML uses _xHHHH_ escapes for XML control characters. Literal text
// that already looks like one of those escapes must have its underscore escaped
// first, otherwise Excel silently changes the user's text while opening the file.
function escapeXlsxText(value) {
  return escapeExportHtml(String(value ?? "")
    .replace(/_x[0-9a-f]{4}_/gi, (match) => `_x005F_${match.slice(1)}`)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\r]/g, (character) => `_x${character.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}_`));
}
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ crc32.table[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}
crc32.table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function uint16(value) {
  return [value & 0xff, (value >>> 8) & 0xff];
}
function uint32(value) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
function zipStoredFiles(files, mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
  const encoder = new TextEncoder();
  const chunks = [], centralDirectory = [];
  let offset = 0;
  files.forEach(({ name, content }) => {
    const filename = encoder.encode(name);
    const data = content instanceof Uint8Array
      ? content
      : content instanceof ArrayBuffer
        ? new Uint8Array(content)
        : encoder.encode(String(content));
    const checksum = crc32(data);
    const localHeader = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, ...uint16(20), ...uint16(0), ...uint16(0), ...uint16(0), ...uint16(0),
      ...uint32(checksum), ...uint32(data.length), ...uint32(data.length), ...uint16(filename.length), ...uint16(0),
    ]);
    chunks.push(localHeader, filename, data);
    centralDirectory.push({ filename, checksum, size: data.length, offset });
    offset += localHeader.length + filename.length + data.length;
  });
  const centralStart = offset;
  centralDirectory.forEach((entry) => {
    const header = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02, ...uint16(20), ...uint16(20), ...uint16(0), ...uint16(0), ...uint16(0), ...uint16(0),
      ...uint32(entry.checksum), ...uint32(entry.size), ...uint32(entry.size), ...uint16(entry.filename.length),
      ...uint16(0), ...uint16(0), ...uint16(0), ...uint16(0), ...uint32(0), ...uint32(entry.offset),
    ]);
    chunks.push(header, entry.filename);
    offset += header.length + entry.filename.length;
  });
  const centralSize = offset - centralStart;
  chunks.push(new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, ...uint16(0), ...uint16(0), ...uint16(files.length), ...uint16(files.length),
    ...uint32(centralSize), ...uint32(centralStart), ...uint16(0),
  ]));
  return new Blob(chunks, { type: mimeType });
}
function excelCellReference(columnIndex, rowIndex) {
  let column = "", value = columnIndex + 1;
  while (value) {
    value -= 1;
    column = String.fromCharCode(65 + (value % 26)) + column;
    value = Math.floor(value / 26);
  }
  return `${column}${rowIndex + 1}`;
}
// An Excel workbook with one worksheet per table ({name, title, columns, rows, highlightedRows}): each sheet
// has its title, record count, column headings with the Sr. No. column, and rows, highlighted rows filled.
// Sheet names are made Excel-safe and unique.
// A sheet may colour single cells (Attendance Sheet Mismatch, 23 Nov 2026): `fills` names its colours ({key: "FFRRGGBB"}),
// `cellFills[row][column]` (the sheet's own row and column numbers, from 0) puts one on a cell and `headerFills[line]`
// on a line above the headings, which is how a colour key is written at the top. `plainSerial` leaves the Sr. No.
// uncoloured so it is not read as one of those colours, and `freezeColumns` keeps the first columns in view.
// A workbook with no such sheet is written exactly as before.
function buildXlsxSheetsWorkbook(title, sheets = []) {
  const usedNames = new Set();
  const fillColours = [...new Set(sheets.flatMap((sheet) => Object.values(sheet?.fills || {})).map((colour) => String(colour).toUpperCase()).filter((colour) => /^[0-9A-F]{8}$/.test(colour)))];
  // The colours follow the 8 fills and 12 cell styles every workbook has: two styles each, a cell and a line above the headings.
  const fillStyle = (fills, key, heading) => {
    const at = fillColours.indexOf(String(fills?.[key] ?? "").toUpperCase());
    return at < 0 ? undefined : 12 + at * 2 + (heading ? 1 : 0);
  };
  const withFillStyles = (styles) => !fillColours.length ? styles : styles
    .replace('<fills count="8">', `<fills count="${8 + fillColours.length}">`)
    .replace('</fills>', `${fillColours.map((colour) => `<fill><patternFill patternType="solid"><fgColor rgb="${colour}"/><bgColor indexed="64"/></patternFill></fill>`).join("")}</fills>`)
    .replace('<cellXfs count="12">', `<cellXfs count="${12 + fillColours.length * 2}">`)
    .replace('</cellXfs>', `${fillColours.map((_, at) => `<xf numFmtId="0" fontId="0" fillId="${8 + at}" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="${8 + at}" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>`).join("")}</cellXfs>`);
  const sheetName = (name, index) => {
    const base = String(name || "").replace(/[\u0000-\u001f\u007f-\u009f\ufffe\uffff[\]:*?/\x5c]/g, " ").replace(/\s+/g, " ").replace(/^[\s']+|[\s']+$/g, "").slice(0, 31) || `Sheet ${index + 1}`;
    let unique = base;
    for (let copy = 2; usedNames.has(unique.toLowerCase()); copy++) unique = `${base.slice(0, 27)} ${copy}`;
    usedNames.add(unique.toLowerCase());
    return unique;
  };
  const worksheets = sheets.map(({ name, title: sheetTitle, columns = [], rows: exportRows = [], headerRows, highlightedRows = new Set(), fills, cellFills, headerFills, plainSerial = false, freezeColumns = 0 }, sheetIndex) => {
    const serial = withSerialColumn(columns, exportRows);
    // The sheet's own column number of each written column (-1 for a Sr. No. column added here).
    const ownColumn = serial.columns.map((column) => columns.indexOf(column));
    const usedLabels = new Set();
    const labels = serial.columns.map((column, index) => {
      const base = xlsxHeadingText(column.label).slice(0, 240) || `Column ${index + 1}`;
      let label = base;
      for (let suffix = 2; usedLabels.has(label.toLowerCase()); suffix++) label = `${base} (${suffix})`;
      usedLabels.add(label.toLowerCase());
      return label;
    });
    const summaryRows = headerRows?.length ? headerRows.map(row=>Array.isArray(row)?row:[row]) : [[sheetTitle || title || "Caliber Pulse-II report"], [recordCountLine(exportRows.length, formatDisplayDateTime(new Date()))]];
    const firstDataRow = summaryRows.length + 1;
    const bodyRows = xlsxTableRows(serial.rows, labels.length);
    const worksheetRows = [...summaryRows, labels, ...bodyRows];
    // Headings wrap in narrow columns, plain-number columns are numbers (shared/xlsx-layout.mjs).
    const columnWidths = labels.map((label, index) => xlsxColumnWidth(label, bodyRows.map((row) => row[index])));
    const numericColumns = xlsxNumericColumns(bodyRows, labels.length);
    const headingHeight = xlsxHeadingHeight(labels, columnWidths);
    const sheetData = worksheetRows.map((row, rowIndex) => {
      const style = rowIndex < summaryRows.length ? (fillStyle(fills, headerFills?.[rowIndex], true) ?? (rowIndex === 0 ? 3 : 4)) : rowIndex === summaryRows.length ? 5 : highlightedRows.has(rowIndex - firstDataRow) ? 2 : (rowIndex - firstDataRow) % 2 === 0 ? 6 : 1;
      const height = rowIndex === 0 ? ' ht="24" customHeight="1"' : rowIndex === summaryRows.length ? ` ht="${headingHeight}" customHeight="1"` : "";
      return `<row r="${rowIndex + 1}"${height}>${row.map((cell, columnIndex) => {
        const reference = excelCellReference(columnIndex, rowIndex), serialStyle = !plainSerial && rowIndex >= firstDataRow && isSerialColumn(serial.columns[columnIndex]) ? SERIAL_XLSX_STYLES[serialTone(cell)] : undefined, ownFill = rowIndex >= firstDataRow && cellFills ? fillStyle(fills, cellFills[rowIndex - firstDataRow]?.[ownColumn[columnIndex]], false) : undefined, cellStyle = ownFill !== undefined ? ownFill : serialStyle ? serialStyle : rowIndex >= firstDataRow && serial.columns[columnIndex]?.tone==='error'?7:rowIndex >= firstDataRow && serial.columns[columnIndex]?.tone==='corrected'?8:style;
        const number = rowIndex >= firstDataRow && numericColumns[columnIndex] ? xlsxPlainNumber(cell) : null;
        return number !== null ? `<c r="${reference}" s="${cellStyle}"><v>${number}</v></c>` : `<c r="${reference}" s="${cellStyle}" t="inlineStr"><is><t xml:space="preserve">${escapeXlsxText(xlsxCellText(cell))}</t></is></c>`;
      }).join("")}</row>`;
    }).join("");
    const widths = columnWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
    const lastCell = excelCellReference(Math.max(0, labels.length - 1), Math.max(summaryRows.length, worksheetRows.length - 1));
    const filterRange = `A${firstDataRow}:${excelCellReference(Math.max(0, labels.length - 1), Math.max(summaryRows.length, worksheetRows.length - 1))}`;
    const mergedTo = excelCellReference(Math.max(0, labels.length - 1), 0).replace(/1$/, "");
    // The filter arrows come from the Excel table (tables/tableN.xml has its own autoFilter). The sheet must not
    // carry a second autoFilter over the same range: Excel then refuses to open the file at all.
    // SpreadsheetML requires autoFilter before mergeCells. Excel repairs (and may
    // discard) the complete worksheet when these otherwise valid elements are reversed.
    return { name: sheetName(name, sheetIndex), part: `xl/worksheets/sheet${sheetIndex + 1}.xml`, tableRange: filterRange, printLastCell: lastCell, printHeaderRows: firstDataRow, tableLabels: labels, content: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${lastCell}"/><sheetViews><sheetView workbookViewId="0">${freezeColumns > 0 && freezeColumns < labels.length ? `<pane xSplit="${freezeColumns}" ySplit="${firstDataRow}" topLeftCell="${excelCellReference(freezeColumns, firstDataRow)}" activePane="bottomRight" state="frozen"/>` : `<pane ySplit="${firstDataRow}" topLeftCell="A${firstDataRow+1}" activePane="bottomLeft" state="frozen"/>`}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths}</cols><sheetData>${sheetData}</sheetData>${labels.length > 1 ? `<mergeCells count="${summaryRows.length}">${summaryRows.map((_,i)=>`<mergeCell ref="A${i+1}:${mergedTo}${i+1}"/>`).join('')}</mergeCells>` : ""}<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>${XLSX_PAGE_SETUP}${xlsxFooter(sheetTitle || title)}<tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>` };
  });
  const workbookTitle = escapeXlsxText(title || "Caliber Pulse-II report");
  return zipStoredFiles([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${worksheets.map((sheet) => `<Override PartName="/${sheet.part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}${worksheets.map((_, index) => `<Override PartName="/xl/tables/table${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: "docProps/core.xml", content: `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${workbookTitle}</dc:title><dc:creator>Caliber Pulse-II</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>` },
    { name: "docProps/app.xml", content: `<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Caliber Pulse-II</Application></Properties>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${worksheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: withFillStyles(`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="7"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF10284C"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF65758B"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FFB91C1C"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FF15803D"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8CACA"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF10284C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDC2626"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEA580C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16A34A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="12"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="2" borderId="1" applyBorder="1" xfId="0" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="1" applyBorder="1" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="1" applyBorder="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="4" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="5" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="6" fillId="5" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf><xf numFmtId="0" fontId="6" fillId="6" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf><xf numFmtId="0" fontId="6" fillId="7" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><tableStyles count="0" defaultTableStyle="TableStyleLight15" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`) },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${worksheets.map((sheet, index) => `<sheet name="${escapeXlsxText(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets><definedNames>${worksheets.map((sheet,index)=>{const name="'"+sheet.name.replaceAll("'","''")+"'";const cell=sheet.printLastCell.replace(/^([A-Z]+)([0-9]+)$/,(match,col,row)=>String.fromCharCode(36)+col+String.fromCharCode(36)+row);return `<definedName name="_xlnm.Print_Area" localSheetId="${index}">${escapeXlsxText(name+'!$A$1:'+cell)}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="${index}">${escapeXlsxText(name+'!$1:$'+sheet.printHeaderRows)}</definedName>`;}).join('')}</definedNames></workbook>` },
    ...worksheets.flatMap((sheet, index) => [
      {name: `xl/worksheets/_rels/sheet${index + 1}.xml.rels`, content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table${index + 1}.xml"/></Relationships>`},
      {name: `xl/tables/table${index + 1}.xml`, content: `<?xml version="1.0" encoding="UTF-8"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${index + 1}" name="ReportTable${index + 1}" displayName="ReportTable${index + 1}" ref="${sheet.tableRange}" totalsRowShown="0"><autoFilter ref="${sheet.tableRange}"/><tableColumns count="${sheet.tableLabels.length}">${sheet.tableLabels.map((label, i) => `<tableColumn id="${i + 1}" name="${escapeXlsxText(label)}"/>`).join("")}</tableColumns><tableStyleInfo name="TableStyleLight15" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`},
    ]),
    ...worksheets.map((sheet) => ({ name: sheet.part, content: sheet.content })),
  ]);
}

export {buildXlsxSheetsWorkbook,zipStoredFiles,escapeExportHtml};
