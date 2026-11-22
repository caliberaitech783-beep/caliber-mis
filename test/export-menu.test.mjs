import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

test('all master and user report exports offer PDF, Excel, and print',()=>{
  const source=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
  const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
  const styles=readFileSync(new URL('../src/sortable-table.css',import.meta.url),'utf8');

  assert.match(source,/function ExportMenu\(/);
  assert.match(source,/<Download \/> Export PDF \(A3\)<\/button>/);
  assert.match(source,/<FileSpreadsheet \/> Export Excel<\/button>/);
  assert.match(source,/label = "Smart Print"/,'the menu is named Smart Print everywhere');
  assert.doesNotMatch(source,/Download as PDF|Download as Excel|label="Generate"|exportLabel = "Generate"/);
  assert.match(source,/buildXlsxWorkbook/);
  assert.match(source,/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(source,/exportFileName\(title, "xlsx"\)/);
  assert.match(source,/\[Content_Types\]\.xml/);
  assert.match(source,/xl\/worksheets\/sheet\$\{sheetIndex \+ 1\}\.xml/);
  assert.match(source,/<Printer \/> Smart Print<\/button>/);
  assert.doesNotMatch(source,/window\.open\("", "_blank"/);
  assert.match(source,/document\.createElement\("iframe"\)/);
  assert.match(source,/frame\.contentWindow\?\.print\(\)/);
  assert.match(source,/fetchPdfExport\("\/api\/exports\/pdf"/);
  // PDF is one click to an A3 file of the columns on screen; Excel uses the browser download manager.
  assert.match(source,/exportSmartPrintSelection\(\{ format: "pdf", title, columns: chosen, rows: model\.rows, highlightRow, appendices \}\)/);
  assert.doesNotMatch(source,/chooseSaveTarget|showSaveFilePicker/);
  assert.match(source,/downloadExportFile\(workbook, fileName\)/);
  assert.doesNotMatch(source,/smartExport\(/,'no column window stands between the click and the file');
  assert.match(source,/<ExportMenu title=\{name==='Users & employees'\?'Login Details':name\} columns=\{exportColumns\} rows=\{records\}/);
  assert.match(source,/<ExportMenu title=\{title\} columns=\{exportView\?\.sourceRows === rows \? exportView\.columns : visibleColumns\} rows=\{exportView\?\.sourceRows === rows \? exportView\.rows : rows\}/);
  assert.match(source,/<ExportMenu title=\{exportTitle\} columns=\{filterColumns\} rows=\{sortedRows\}/);
  assert.match(source,/function MobileWorkflowTable\([^\n]*exportTitle = "Workflow report"/);
  assert.match(source,/<ExportMenu title="CRM tickets report" columns=\{ticketExportColumns\} rows=\{tickets\}/);
  assert.match(server,/app\.post\('\/api\/exports\/pdf',requireSession/);
  assert.match(server,/buildTableExportPdf\(\{title,columns,rows,highlights,pageSize\}\)/);
  assert.match(styles,/\.table-search-toolbar>\.table-parameter-filter,\.report-table-filter-toolbar>\.table-parameter-filter\{margin-left:auto\}/);
  assert.match(styles,/\.toolbar>\.table-parameter-filter\{min-width:0;padding:0;border:0;border-radius:0;margin-left:auto\}/);
});
