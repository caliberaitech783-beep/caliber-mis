// Owner, 17 Nov 2026: in every report the Sr. No. is coloured: 1-5 red, 6-10 orange, 11 onwards green. Only the
// number's cell carries the colour, on screen, in Excel, in the PDF and in the print window.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {serialTone,isSerialColumn,SERIAL_COLUMN_KEY,SERIAL_TONE_COLOURS,SERIAL_XLSX_STYLES} from '../shared/serial-column.mjs';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
import {buildTableExportPdf} from '../server/services/table-export-pdf.mjs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Sr. No. 1-5 are red, 6-10 orange, 11 onwards green; a blank or total line has no colour',()=>{
 assert.deepEqual([1,2,3,4,5].map(serialTone),Array(5).fill('red'));
 assert.deepEqual([6,7,8,9,10].map(serialTone),Array(5).fill('orange'));
 assert.deepEqual([11,12,50,1000].map(serialTone),Array(4).fill('green'));
 assert.equal(serialTone('3'),'red');
 assert.equal(serialTone(' 11 '),'green');
 for(const value of ['',null,undefined,'—','TOTAL',0,'0','1.5','-2'])assert.equal(serialTone(value),'',String(value));
 assert.ok(isSerialColumn({key:SERIAL_COLUMN_KEY,label:'x'}));
 assert.ok(isSerialColumn({key:'other',label:'Sr. No.'}));
 assert.ok(!isSerialColumn({key:'sr',label:'Tr.Sr.No'}));
});

test('the Excel Sr. No. cells carry the red, orange and green styles and the total line none',async()=>{
 const {unzipSync,strFromU8}=await import('fflate');
 const columns=[{key:SERIAL_COLUMN_KEY,label:'Sr. No.'},{key:'door',label:'Door no.'}];
 const rows=[...Array.from({length:12},(_,i)=>[String(i+1),'D'+i]),['','TOTAL']];
 const workbook=buildXlsxSheetsWorkbook('Machines',[{name:'Machines',columns,rows}]);
 const bytes=new Uint8Array(await workbook.arrayBuffer());
 const text=strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
 const styleOf=row=>new RegExp(`<c r="A${row}" s="(\\d+)"`).exec(text)?.[1];
 // Title, record count, headings: the data starts on row 4.
 assert.equal(styleOf(4),String(SERIAL_XLSX_STYLES.red));
 assert.equal(styleOf(8),String(SERIAL_XLSX_STYLES.red));
 assert.equal(styleOf(9),String(SERIAL_XLSX_STYLES.orange));
 assert.equal(styleOf(13),String(SERIAL_XLSX_STYLES.orange));
 assert.equal(styleOf(14),String(SERIAL_XLSX_STYLES.green));
 assert.ok(![SERIAL_XLSX_STYLES.red,SERIAL_XLSX_STYLES.orange,SERIAL_XLSX_STYLES.green].map(String).includes(styleOf(16)),'the total line has no coloured number');
 assert.ok(![SERIAL_XLSX_STYLES.red,SERIAL_XLSX_STYLES.orange,SERIAL_XLSX_STYLES.green].map(String).includes(new RegExp('<c r="B4" s="(\\d+)"').exec(text)?.[1]),'only the Sr. No. cell is coloured');
 const styles=strFromU8(unzipSync(bytes)['xl/styles.xml']);
 assert.match(styles,/<cellXfs count="12">/);
 for(const rgb of ['FFDC2626','FFEA580C','FF16A34A'])assert.ok(styles.includes(rgb),rgb);
});

test('the browser Excel builder in main.jsx is coloured the same way as the shared builder',()=>{
 const main=read('src/main.jsx'),shared=read('shared/report-xlsx.mjs');
 for(const source of [main,shared]){
  assert.match(source,/isSerialColumn\(serial\.columns\[columnIndex\]\) \? SERIAL_XLSX_STYLES\[serialTone\(cell\)\]/);
  assert.match(source,/<cellXfs count=\\?"12\\?">/);
 }
 assert.match(main,/SERIAL_TONE_COLOURS\[serialTone\(cell\)\]/,'the print window colours the Sr. No. cell');
});

test('the PDF fills the Sr. No. cells in red, orange and green',async()=>{
 const columns=[{key:'door',label:'Door no.'}];
 const rows=Array.from({length:12},(_,i)=>['D'+i]);
 const pdf=(await buildTableExportPdf({title:'Machines',columns,rows})).toString('latin1');
 // pdfkit writes a fill colour as "r g b scn" with each part out of 1.
 const fills=pdf.split('\n').filter(line=>/ scn$/.test(line)).map(line=>line.split(' ').slice(0,3).map(v=>Math.round(Number(v)*255)).join(','));
 for(const tone of ['red','orange','green']){
  const hex=SERIAL_TONE_COLOURS[tone],want=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(',');
  assert.ok(fills.includes(want),tone+' fill in the PDF');
 }
});

test('the shared report table shows the coloured number and hands the same numbers to Smart Print, PDF and Excel',()=>{
 const main=read('src/main.jsx');
 const table=main.slice(main.indexOf('function ReportTable('),main.indexOf('function parseCsv('));
 assert.match(table,/table-serial-badge serial-\$\{tone\}/);
 assert.match(table,/columns: withExportSerial\(/,'the export carries the Sr. No. the screen shows');
 assert.match(table,/renderRow\(row, index, ""\)/,'the total line has no number');
 const css=read('src/table-actions.css');
 for(const rule of ['.table-serial-badge.serial-red { background: #dc2626; }','.table-serial-badge.serial-orange { background: #ea580c; }','.table-serial-badge.serial-green { background: #16a34a; }'])assert.ok(css.includes(rule),rule);
});
