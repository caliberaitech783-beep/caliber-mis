import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=file=>readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const main=read('main.jsx');
const menu=main.slice(main.indexOf('function ExportMenu('),main.indexOf('function ReportColumnSelector('));

test('one menu named Smart Print with the three items in the owner\'s order',()=>{
  assert.match(menu,/label = "Smart Print"/);
  const pdf=menu.indexOf('Export PDF (A3)</button>'),excel=menu.indexOf('"Export Excel (Save As)" : "Export Excel"'),print=menu.indexOf('<Printer /> Smart Print</button>}</div>');
  assert.ok(pdf>0&&excel>pdf&&print>excel,'Export PDF (A3), then Export Excel, then Smart Print');
  assert.doesNotMatch(menu,/smartLabels|Smart PDF|Smart Excel/);
  // Every report heading and every shared table names it the same way.
  assert.match(main,/exportLabel = "Smart Print"/);
  assert.doesNotMatch(read('shared-actions-table.jsx'),/label="Generate"/);
  for(const file of ['saved-log-books.jsx','elb-batch-reports.jsx','vlb-batch-report.jsx'])assert.doesNotMatch(read(file),/exportLabel=/,file+' keeps the one name');
  assert.match(read('iboss-accounts.jsx'),/"Smart Print \(loaded rows\)":"Smart Print"/);
  assert.match(read('iboss-chat.jsx'),/'Smart Print \(loaded rows\)':'Smart Print'/);
  // Screens that had two buttons (a print button and an export menu) now have the one menu.
  assert.equal((read('vlb-fleet-stepper.jsx').match(/<ExportMenu /g)||[]).length,1);
  assert.doesNotMatch(read('erp-masters.jsx'),/<PrintButton /);
});

test('Export PDF is one click to an A3 file; Export Excel asks where to save before building the workbook',()=>{
  const pdf=menu.slice(menu.indexOf('const downloadPdf = () => {'),menu.indexOf('const printReport = () => {'));
  assert.doesNotMatch(pdf,/openSmartPrint/,'no column window before the PDF');
  assert.match(pdf,/smartPrintReportParts\(\{ title, columns: model\.columns, rows: model\.rows, formatCell: exportCellText \}\)/,'the columns on screen, with the Daily Updates journal as its own section');
  assert.doesNotMatch(pdf,/pageSize/,'the server default, A3, is used');
  assert.match(readFileSync(new URL('../server.mjs',import.meta.url),'utf8'),/===\'A4\'\?\'A4\':\'A3\'/);
  const excel=menu.slice(menu.indexOf('const downloadExcel = async () => {'),menu.indexOf('const downloadPdf = () => {'));
  assert.ok(excel.indexOf('await chooseSaveTarget(fileName)')<excel.indexOf('runDownload('),'the Save As window opens while the click is fresh');
  assert.match(excel,/catch \{ return; \}/,'Cancel stops quietly');
  assert.match(excel,/saveToTarget\(target, buildXlsxWorkbook\(title, model\.columns, exportRows, highlightedRows, model\.rows\), fileName, downloadExportFile\)/);
  // The Excel made from inside the Smart Print window goes through Save As as well.
  assert.match(main,/target = await chooseSaveTarget\(fileName\);\s*recordUserActivity\(\{module:"Reports",action:"Download Excel report"/);
  assert.match(read('smart-print.mjs'),/if\(error\?\.name==='AbortError'\)\{notice\.textContent='';toast\.hidden=true;/);
});

test('a table drawn by hand reaches the same menu and is read from the screen at the click',()=>{
  assert.match(main,/registerSmartPrintMenu\(ExportMenu\);/);
  assert.match(menu,/const model = source\(triggerRef\.current\);\s*if \(!model\?\.columns\?\.length\) \{ alert\(/);
  const table=read('table-smart-print.jsx');
  assert.match(table,/source=\{trigger=>readDomTable\(table\?\.current\|\|nearestPrintTable\(trigger\)\)\}/);
  assert.match(table,/<div className="smart-print-row" data-print-hide="">/);
  assert.match(read('sortable-table.css'),/\.smart-print-row\{display:flex;justify-content:flex-end/);
});

test('Dashboard: the card pop-ups, the last 6, 12 and 24 hours table, each list a figure opens and the site comparison have the menu',()=>{
  const dashboard=read('log-book-dashboard.jsx'),recent=read('log-book-recent-activity.jsx');
  assert.match(dashboard,/function Dialog\(\{title,close,children,actions=null\}\)/);
  assert.match(dashboard,/<span className="lb-dialog-tools">\{actions\}<button autoFocus/);
  assert.match(dashboard,/actions=\{state\.records\.length>0&&<TableSmartPrint title=\{title\+' · '\+period\+\(state\.cursor\?' · first '/,'VLB and ELB saved cards, saying when only the first cards are loaded');
  assert.match(dashboard,/<th data-smart-print-skip="">Original<\/th>/,'the Download scan column stays off paper');
  assert.match(dashboard,/<Dialog title="Sites with saved entries" close=\{\(\)=>setSelection\(null\)\} actions=\{<TableSmartPrint /);
  assert.match(dashboard,/<TableSmartPrint title=\{'Site comparison · '\+[^}]+\} rows=\{rankedSites\} columns=\{\[\{key:'site',label:'Site'/);
  assert.match(recent,/<span className="lb-recent-print" data-print-hide=""><TableSmartPrint title=\{'Completed in the last 6, 12 and 24 hours · as of '\+timeLabel\(recent\.asOf\)\}\/>/);
  assert.match(recent,/<Dialog title=\{openLabel\} close=\{\(\)=>setOpen\(null\)\} actions=\{\(timed\?stages\.length>0:!empty\)&&<TableSmartPrint title=\{openLabel\+' · as of '/,'one menu serves every list and the VLB / LMV / ELB time; none when there is nothing to print');
});

test('Reports: the tables that had no print option now have the menu',()=>{
  const manpower=read('manpower-reports.jsx');
  assert.match(manpower,/<TableSmartPrint row title=\{driver\.employeeName\+' · history '\+year\+' · month by month'\}\/><table>/,'driver history, in Shift Attendance and in OT');
  assert.match(manpower,/<TableSmartPrint row title=\{'Shift Attendance · All sites, shift-wise · '\+dateLabel\+' · actual duties'\}\/>/);
  assert.match(manpower,/<TableSmartPrint row title=\{'Shift Attendance · '\+heading\+' · duties by equipment'\}\/>/);
  const mismatch=read('equipment-pulse-mismatch.jsx');
  assert.match(mismatch,/<h3>Where the counts differ<\/h3><TableSmartPrint row /);
  assert.match(mismatch,/<h3>Machines that differ<\/h3><TableSmartPrint row /);
  assert.match(read('vlb-batch-report.jsx'),/<TableSmartPrint row title="ELB -- Machine-wise shift report"\/>/);
  assert.match(read('scan-batch-report.jsx'),/<TableSmartPrint row title=\{report\.title\+' · All cards · '\+report\.name\}\/><table aria-label="Scanned card summary">/);
  assert.match(read('elb-trip-cards.jsx'),/<TableSmartPrint row title=\{'Related VLB trip card'/);
  // Request lifecycle: PDF and Excel of its steps; Smart Print keeps the pop-up's own print layout.
  assert.match(main,/includes\("request-timeline-modal"\) && <ExportMenu [^>]*source=\{\(\) => readDomTable\(dialogRef\.current\?\.querySelector\("\.request-timeline-steps"\)\)\} onSmartPrint=\{\(\) => \{/);
  assert.match(menu,/if \(onSmartPrint\) \{ onSmartPrint\(\); return; \}/);
});

// Part 2: the lists on the other pages. Each file keeps at least the menus counted here; a list that is removed
// takes its line out of this table, and a new hand-drawn list should add one.
const OTHER_PAGES={
  // Masters
  'equipment-alias-admin.jsx':2,'pulse-master-sync.jsx':1,'pulse-pending.jsx':1,'vehicle-transfer-workflow.jsx':1,'organisation-chart.jsx':5,
  // MIS: batches, log books, scanning, ELB
  'vlb-batch-approvals.jsx':1,'vlb-create-batch.jsx':3,'vlb-batch-holds.jsx':1,'vlb-batch-deletion.jsx':1,'vlb-batch-governance.jsx':2,
  'pulse-trip-verification.jsx':1,'log-book-form.jsx':3,'fleet-reconciliation.jsx':1,'scan-batch-report.jsx':2,'bulk-card-scanning.jsx':1,
  'scan-duplicate-list.jsx':1,'vlb-fleet-stepper.jsx':1,'previous-elb-entries.jsx':1,
  // Deletion and backup
  'log-book-deletion.jsx':2,'log-book-deletion-manifest.jsx':5,'scan-card-backup.jsx':1,'backup-administration.jsx':2,
  // Telegram, automation, admin
  'mis-telegram.jsx':1,'automation-centre.jsx':4,'telegram-site-groups.jsx':2,'oem-email-delivery-status.jsx':1,'diagnostics-page.jsx':2,
  'storage-management-page.jsx':1,'request-corrections.jsx':1,'daily-updates-list.jsx':1,'equipment-pulse-mismatch.jsx':3,
  // Accounts and directory
  'iboss-bank-reconciliation.jsx':1,'iboss-account-ledger.jsx':1,'iboss-drill-panel.jsx':1,'caliber-directory-page.jsx':4,
};

test('other pages: every list of records drawn by hand has the Smart Print menu',()=>{
  for(const [file,least] of Object.entries(OTHER_PAGES)){
    const source=read(file);
    assert.match(source,/import TableSmartPrint from ['"]\.\/table-smart-print\.jsx['"];/,file+' imports the menu');
    assert.ok((source.match(/<TableSmartPrint /g)||[]).length>=least,file+' keeps its '+least+' Smart Print menu(s)');
  }
  // Shared tables in the main file get the menu by having a title.
  for(const title of ['exportTitle={type}','exportTitle="WhatsApp alert history"','exportTitle={`User Sessions · ${status}`}','exportTitle="Admin locks · Triggering CRM tickets"','exportTitle={`${name} · request ageing`}'])
    assert.ok(main.includes('<ActionsTable ')&&main.includes(title),title);
});

test('menus stay out of places where they would only be clutter or a risk',()=>{
  // The daily updates journal sits in every row of the maintenance tables: only a pop-up that passes a title gets a menu.
  const updates=read('daily-updates-list.jsx');
  assert.match(updates,/\{printTitle && <TableSmartPrint row title=\{printTitle\} rows=\{updates\} columns=\{printColumns\} \/>\}/);
  assert.doesNotMatch(updates.slice(updates.indexOf('export default function DailyUpdatesList')),/printTitle/,'the table cell passes no title');
  assert.match(main,/<DailyUpdatesPanel remarks=\{history\}[^>]*printTitle=\{/);
  // A typed OTP, a recovery file link and delete buttons never go to paper.
  assert.match(read('vlb-batch-holds.jsx'),/data-smart-print-skip/);
  assert.match(read('backup-administration.jsx'),/<th data-smart-print-skip="">Recovery file<\/th><th data-smart-print-skip="">Delete<\/th>/);
  // The mismatch notice is the top layer of the app; its menu opens above it from the stylesheet, not an inline style.
  assert.doesNotMatch(read('equipment-pulse-mismatch.jsx'),/<style>/);
  assert.match(readFileSync(new URL('../src/equipment-pulse-mismatch.css',import.meta.url),'utf8'),/\.export-menu-popover\.equipment-mismatch-print-layer[^{]*\{z-index:11910\}/);
});
