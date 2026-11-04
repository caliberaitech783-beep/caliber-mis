import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc} from 'vite';
import {misRequestAllowed} from '../shared/mis-application-access.mjs';
import {savedReportKey,sanitizeTableView,serializeTableView} from '../src/saved-reports.mjs';
import {primaryRecordDateColumn} from '../src/record-date-range.mjs';
import {encodeDateRange,parseDateRange,matchesDateRange} from '../src/date-range-filter.mjs';
import {cellMatchesFilterValues} from '../src/multi-value-filter.mjs';
import {isDurationColumn,defaultDurationSort,compareDurationValues} from '../src/duration-sort.mjs';
import {ensureJobReferenceVisibleKeys} from '../src/table-actions-model.mjs';
import {sameReportView} from '../src/report-portal-target.mjs';
import {matchesSmartSearch} from '../shared/smart-search.mjs';
import {reportTime12} from '../shared/report-time-format.mjs';

const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
const nodes=(tree,type)=>{
 const result=[];const walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!React.isValidElement(node))return;if(node.type===type)result.push(node);walk(node.props.children);};walk(tree);return result;
};
function hooks(){
 const slots=[];let cursor=0,effects=[];
 return {useState:initial=>{const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
 useRef:value=>{const index=cursor++;return slots[index]??(slots[index]={current:value});},useMemo:fn=>fn(),useDeferredValue:value=>value,useEffect:fn=>effects.push(fn),
 render:(fn,props)=>{cursor=0;effects=[];return fn(props);},commit:()=>{const queue=effects;effects=[];queue.forEach(fn=>fn());}};
}
async function compile(source,name,scope){
 const {code}=await transformWithOxc(source.replaceAll('export function','function'),'controls.jsx',{jsx:{runtime:'classic'}});
 return new Function(...Object.keys(scope),code+';return '+name)(...Object.values(scope));
}

test('MIS PDF and saved views follow source report grants and reject unrelated users and methods',()=>{
 for(const page of ['Reports','Trip Card Bulk Scan','Job Card Bulk Scan','Vehicle Log Book','Equipment Log Book','Dashboard']){
  const session={permissions:{separateMisCredentials:true,misDesktopAccess:[page]}};
  assert.equal(misRequestAllowed(session,{path:'/api/exports/pdf',method:'POST'}),true,page);
  for(const method of ['GET','POST'])assert.equal(misRequestAllowed(session,{path:'/api/saved-reports',method}),true,page);
  assert.equal(misRequestAllowed(session,{path:'/api/exports/pdf',method:'GET'}),false);
  assert.equal(misRequestAllowed(session,{path:'/api/saved-reports',method:'PUT'}),false);
 }
 const session={permissions:{separateMisCredentials:true,misDesktopAccess:['Employee master']}};
 for(const [path,method] of [['/api/exports/pdf','POST'],['/api/saved-reports','GET'],['/api/saved-reports','POST']])assert.equal(misRequestAllowed(session,{path,method}),false);
});

test('saved report Print uses the committed restored view and waits until printing is available',async()=>{
 const source=readFileSync(new URL('../src/saved-reports.jsx',import.meta.url),'utf8');
 const h=hooks(),SavedReportsDialog=()=>null,columns=[{key:'site',label:'Site'}],keys=[],printed=[];
 const scope={React,...h,savedReportKey:(...args)=>{keys.push(args);return savedReportKey(...args);},sanitizeTableView,serializeTableView,defaultSavedReportName:()=>'',useSavedReports:()=>({reports:[],load:async()=>{}}),SavedReportsDialog,SaveReportDialog:()=>null,PrintReportPrompt:()=>null};
 const Panel=await compile(source.slice(source.indexOf('export function SavedReportsPanel')),'SavedReportsPanel',scope);
 let current='old';const props={title:'Report · current dates',tableKey:'stable-table',columns,open:'saved',onOpenChange:()=>{},currentView:()=>({}),onApply:view=>{current=view.filters.site;},canPrint:true,onPrint:()=>printed.push('old')};
 const tree=h.render(Panel,props);
 nodes(tree,SavedReportsDialog)[0].props.onPrint({state:{visible:['site'],filters:{site:'Sasti'},sort:{}}});
 h.render(Panel,{...props,open:'',canPrint:false,onPrint:()=>printed.push(current)});h.commit();assert.deepEqual(printed,[]);
 h.render(Panel,{...props,open:'',onPrint:()=>printed.push(current)});h.commit();assert.deepEqual(printed,['Sasti']);
 assert.equal(keys.at(-1)[0],'stable-table');
});

test('generated reports keep full filtered sorted exports and all print columns beyond one page',async()=>{
 const h=hooks(),FilterableHeader=()=>null,RecordDateRange=()=>null,SavedReportsPanel=()=>null,printed=[];let exported;
 const scope={React,...h,primaryRecordDateColumn,encodeDateRange,parseDateRange,matchesDateRange,cellMatchesFilterValues,isDurationColumn,defaultDurationSort,compareDurationValues,ensureJobReferenceVisibleKeys,sameReportView,matchesSmartSearch,reportTime12,
  useRequestShiftData:()=>({shifts:[]}),requestShiftColumns:columns=>columns,useColumnPreferences:(_table,_columns,visible)=>[visible,()=>{}],mobileTablePageSize:()=>0,
  useTableLayouts:()=>({layouts:[]}),openSmartPrint:model=>printed.push(model),printTableReport:()=>{},exportCellText:String,FilterableHeader,RecordDateRange,SavedReportsPanel,
  TableLayoutSelect:()=>null,ReportActionsMenu:()=>null,SmartSelect:'select',ListFilter:'i',TableParameterFilter:()=>null,ReportColumnSelector:()=>null,ReportSortDialog:()=>null,ChevronLeft:'i',ChevronRight:'i',createPortal:tree=>tree};
 const sort=main.slice(main.indexOf('const sortCollator ='),main.indexOf('const WORKFLOW_INITIAL_RENDER_ROWS'));
 const filtering=main.slice(main.indexOf('const EMPTY_TABLE_FILTER_VALUE ='),main.indexOf('function TableParameterFilter('));
 const table=main.slice(main.indexOf('function ReportTable('),main.indexOf('function parseCsv('));
 const Table=await compile(sort+filtering+table,'ReportTable',scope);
 const columns=[{key:'date',label:'Date',value:r=>r.date},{key:'site',label:'Site',value:r=>r.site},{key:'hours',label:'Time taken',value:r=>r.hours}];
 const rows=Array.from({length:137},(_,index)=>({date:index<120?'2026-11-03':'2026-11-04',site:'Sasti',hours:index===0?'—':`${index}h`}));
 const props={columns,rows,visibleColumnKeys:['date','hours'],title:'Test report',layoutKey:'test',onExportViewChange:view=>{exported=view;}};
 let tree=h.render(Table,props);h.commit();assert.equal(exported.rows.length,137);assert.equal(nodes(nodes(tree,'tbody')[0],'tr').length,50);
 nodes(tree,RecordDateRange)[0].props.onChange(encodeDateRange('2026-11-03','2026-11-03'));
 tree=h.render(Table,props);h.commit();assert.equal(exported.rows.length,120);assert.equal(exported.rows.at(-1).hours,'—');assert.equal(exported.rows[0].hours,'119h');
 assert.deepEqual(exported.columns.map(c=>c.key),['date','hours']);assert.deepEqual(exported.allColumns.map(c=>c.key),['date','site','hours']);
 const saved=nodes(tree,SavedReportsPanel)[0].props;assert.equal(saved.currentView().dateRange,encodeDateRange('2026-11-03','2026-11-03'));
 saved.onPrint();assert.equal(printed[0].rows.length,120);assert.equal(printed[0].columns.length,3);
});
