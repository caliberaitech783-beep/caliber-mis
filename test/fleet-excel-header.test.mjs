import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
const source=readFileSync(new URL('../src/fleet-reconciliation.jsx',import.meta.url),'utf8');
test('fleet Excel exports site, shift and actual master sync time above detail and summary columns',async()=>{
 const headings=eval(source.match(/const headings=(.*);/)[1]),summaryHeadings=eval(source.match(/const summaryHeadings=(.*);/)[1]);
 const values=eval(source.match(/const values=(.*);/)[1]),summaryValues=eval(source.match(/const summaryValues=(.*);/)[1]);
 const rows=[{site:'Sasti OC',date:'2026-11-04',shift:'S1',door:'V1',kind:'vehicle',name:'Tipper',model:'M1',cards:[],breakdowns:[],reason:'Driver unavailable',remarks:'=literal',status:'Idle',scannedCards:2}];
 for(const view of ['detail','summary']) for(const subset of [false,true]){
  const activeHeadings=view==='summary'?summaryHeadings:headings,visibleColumns=subset?[3,4]:activeHeadings.map((_,index)=>index);
  let blob,filename;const URL={createObjectURL(value){blob=value;return 'blob:test'},revokeObjectURL(){}};
  const document={createElement(){return {set download(value){filename=value},click(){}}}};
  const data={...rows[0],masterSync:{lastSuccess:'2026-11-04T12:32:34Z'}};
  new Function('visibleColumns','activeHeadings','view','rows','summaryRows','data','headings','summaryHeadings','values','summaryValues','buildXlsxSheetsWorkbook','URL','document','setTimeout',source.match(/const exportExcel=\(\)=>\{(.*)\};/)[1])(visibleColumns,activeHeadings,view,rows,rows,data,headings,summaryHeadings,values,summaryValues,buildXlsxSheetsWorkbook,URL,document,()=>{});
  assert.match(filename,/\.xlsx$/);const xml=new TextDecoder().decode(await blob.arrayBuffer());
  assert.ok(xml.includes('V1'));if(subset){assert.ok(!xml.includes('Driver unavailable'));assert.ok(!xml.includes('>Model<'));assert.ok(xml.includes('>Type<'));}
  assert.ok(xml.includes('SITE NAME -- SASTI OC'));assert.ok(xml.includes('SHIFT - (S1)'));
  assert.ok(xml.includes('SYNC TIME : '+new Date(data.masterSync.lastSuccess).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})));
  assert.ok(xml.includes('<mergeCells count="3">'));assert.ok(xml.includes('ySplit="4" topLeftCell="A5"'));assert.ok(xml.includes('<autoFilter ref="A4:'));assert.ok(xml.includes('!$1:$4'));assert.ok(!xml.includes('<f>'));
 }
});
test('other reports retain their original two-row heading layout',async()=>{
 const xml=new TextDecoder().decode(await buildXlsxSheetsWorkbook('Other',[{columns:[{label:'Site'}],rows:[['Sasti OC']]}]).arrayBuffer());
 assert.ok(xml.includes('<mergeCells count="2">'));assert.ok(xml.includes('ySplit="3" topLeftCell="A4"'));assert.ok(xml.includes('!$1:$3'));
});
