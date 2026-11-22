// OEM Email Delivery Status, the Caliber Directory lists and Employee Master on the shared report table (owner, 20 Nov 2026:
// the VLB column filters on every remaining long list). Each screen keeps its own search box; the table adds a filter and
// sort menu on every heading, Rows, Actions and Smart Print. Without the table (no ReportSection) the plain list stays.
import {SortableHeader,sortRowsBlanksLast} from './helpers/sortable-table-stub.mjs';
import {TableSmartPrint} from './helpers/smart-print-stub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc} from 'vite';
import {cdirPersonId} from '../shared/cdir-organisation.mjs';
import {EMPLOYEE_FIELDS} from '../shared/employee-master-fields.mjs';
import {ERP_EMPLOYEE_FIELDS,isErpEmployee} from '../shared/erp-employee-fields.mjs';
import {suggestedCaliberId} from '../shared/employee-identity.mjs';

async function compile(file,scope,names){
 const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/^import [\s\S]*?;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function').replaceAll('export const','const');
 const {code}=await transformWithOxc(source,file,{jsx:{runtime:'classic'}});
 return new Function(...Object.keys(scope),code+';return {'+names.join(',')+'}')(...Object.values(scope));
}
const nodes=(tree,predicate)=>{const found=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(predicate(node))found.push(node);visit(node.props.children)};visit(tree);return found};
const hooks=()=>{const slots=[];let cursor=0;return {slots,reset:()=>{cursor=0},useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]}}};
const ReportSection=()=>null;
const report=(tree,category)=>nodes(tree,n=>n.type===ReportSection&&(!category||n.props.category===category))[0]?.props;

test('OEM Email Delivery Status: filters on every heading, the Retry button and retry history kept',async()=>{
 const h=hooks();
 const {OemEmailDeliveryStatus}=await compile('oem-email-delivery-status.jsx',{React,useState:h.useState,useEffect:()=>{},TableSmartPrint,SortableHeader,sortRowsBlanksLast,fetch:async()=>({ok:true,json:async()=>({})})},['OemEmailDeliveryStatus']);
 const row=(day,oem,status,cases,extra={})=>({day,oem,level:'L1',email:oem.toLowerCase()+'@example.com',recipient_key:day+':'+oem,status,case_count:cases,attachments:[],...extra});
 const render=props=>{h.reset();return OemEmailDeliveryStatus({session:{token:'t'},...props})};
 render({ReportSection});
 h.slots[0]={deliveries:[row('2026-11-19','BEML','SMTP accepted',12,{message_id:'m1'}),row('2026-11-18','Volvo','Failed / review required',3,{retry_safe:true,error:'Timeout',attempts:[{at:'2026-11-18T12:00:00Z',actor:'pm',reason:'retry',previousError:'Timeout'}]}),row('2026-11-17','Tata','SMTP accepted',null)]};
 const list=report(render({ReportSection}),'oem-email-deliveries');
 assert.equal(list.showSearch,false,'the search box above stays the one search');
 assert.equal(list.columns.length,11);
 const cases=list.columns.find(column=>column.key==='cases');
 assert.deepEqual(sortRowsBlanksLast(list.rows,{key:'cases',direction:'asc'},r=>cases.sortValue(r)).map(r=>r.oem),['Volvo','BEML','Tata'],'BD cases by value, empty last');
 assert.equal(list.columns.find(column=>column.key==='messageId').value(list.rows[1]),'Not recorded');
 const errorCell=list.columns.find(column=>column.key==='error').render(list.rows[1]);
 assert.ok(nodes(errorCell,n=>n.type==='button'&&n.props.children==='Retry failed email').length,'a safe failed email can still be retried');
 assert.ok(nodes(errorCell,n=>n.type==='details').length,'retry history kept');
 assert.equal(nodes(render({ReportSection}),n=>n.type==='table').length,0,'no second, hand-drawn table');
 assert.equal(report(render({})),undefined,'without the shared table the plain list stays');
 assert.equal(nodes(render({}),n=>n.type==='table').length,1);
});

test('Caliber Directory lists: profile link, badges and View team kept on the shared table',async()=>{
 const icon=()=>null,activePerson=person=>Boolean(person.name)&&person.status!=='VACANT',statusOf=person=>person.status||'ACTIVE',clean=value=>String(value??'').trim();
 const source=readFileSync(new URL('../src/caliber-directory-page.jsx',import.meta.url),'utf8');
 const start=source.indexOf('const rowKey='),end=source.indexOf('function ProfileDrawer(');
 assert.ok(start>0&&end>start);
 const {code}=await transformWithOxc(source.slice(start,end),'directory-table.jsx',{jsx:{runtime:'classic'}});
 const {DirectoryTable,directoryColumns}=new Function('React','useState','activePerson','statusOf','clean','cdirPersonId','Network','TableSmartPrint','SortableHeader','sortRowsBlanksLast',code+';return {DirectoryTable,directoryColumns}')(React,initial=>[initial,()=>{}],activePerson,statusOf,clean,cdirPersonId,icon,TableSmartPrint,SortableHeader,sortRowsBlanksLast);
 const people=[{name:'Asha Rao',cat:'A',designation:'Site Manager',department:'Mining',siteLabel:'Sasti OC',contact:'98765 00001',empId:'E1'},{name:'',status:'VACANT',designation:'Surveyor',siteLabel:'Majri OC',contact:''}];
 const selected=[],teams=[];
 const tree=DirectoryTable({rows:people,printTitle:'Employee directory',onSelect:p=>selected.push(p),onOrganisation:p=>teams.push(p),organisationManagers:new Set([cdirPersonId(people[0])]),ReportSection});
 const list=report(tree,'caliber-directory');
 assert.deepEqual(list.columns.map(column=>column.label),[...directoryColumns.map(([,label])=>label),'Organisation']);
 const name=list.columns.find(column=>column.key==='name');
 name.render(people[0]).props.onClick();assert.equal(selected[0],people[0],'the name opens the profile');
 assert.equal(name.value(people[1]),'Vacant position');
 assert.equal(list.columns.find(column=>column.key==='status').render(people[1]).props.className,'cdir-status vacant');
 list.columns.at(-1).render(people[0]).props.onClick();assert.equal(teams[0],people[0],'View team kept');
 assert.equal(list.columns.at(-1).render(people[1]).props.className,'cdir-no-team');
 assert.equal(report(DirectoryTable({rows:people,printTitle:'x',onSelect(){}})),undefined,'without the shared table the plain list stays');
 const page=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8'),module=readFileSync(new URL('../src/employee-transfer.jsx',import.meta.url),'utf8');
 assert.ok(page.includes('<CaliberDirectoryPage token={session?.token || authToken} ReportSection={ReportSection} />'));
 assert.ok(module.includes('<CaliberDirectoryPage token={token} ReportSection={ReportSection}/>'));
 assert.equal((source.match(/ ReportSection=\{ReportSection\}/g)||[]).length,3,'every directory list gets the table');
});

test('Employee Master: the page of 50 on the shared table with View details; search, location and paging stay',async()=>{
 const h=hooks();
 const {EmployeeMaster}=await compile('employee-master.jsx',{React,useState:h.useState,useEffect:()=>{},useRef:value=>({current:value}),SmartSelect:'select',StepBackButton:()=>null,HrMasterImport:()=>null,EmployeeSiteMoves:()=>null,SortableHeader,sortRowsBlanksLast,EMPLOYEE_FIELDS,ERP_EMPLOYEE_FIELDS,isErpEmployee,suggestedCaliberId,fetch:async()=>({ok:true,json:async()=>({})})},['EmployeeMaster']);
 const render=props=>{h.reset();return EmployeeMaster({session:{token:'t'},ExportMenu:()=>null,PrintButton:()=>null,parseCsv:()=>[],...props})};
 render({ReportSection});
 const dataSlot=h.slots.findIndex(value=>value&&Array.isArray(value.records)&&Array.isArray(value.sites));
 assert.ok(dataSlot>=0,'the screen keeps its page of records');
 h.slots[dataSlot]={records:[{id:1,caliberId:'E2',name:'Ravi',site:'Sasti OC',status:'Active'},{id:2,caliberId:'E10',name:'Mina',site:'',status:'Active'}],sites:['Sasti OC'],total:2};
 const tree=render({ReportSection}),list=report(tree,'employee-master');
 assert.deepEqual(list.columns.map(column=>column.label),['Employee ID','Caliber ID','Employee name','Department','Designation','Location','Status','Details']);
 const site=list.columns.find(column=>column.key==='site');
 assert.deepEqual(sortRowsBlanksLast(list.rows,{key:'site',direction:'desc'},r=>site.value(r)).map(r=>r.name),['Ravi','Mina'],'empty location last');
 assert.equal(list.columns.at(-1).render(list.rows[0]).props.children,'View details');
 assert.ok(nodes(tree,n=>n.props?.className==='employee-pagination').length,'Previous / Next stay');
 assert.ok(nodes(tree,n=>n.type==='input'&&n.props.placeholder==='Employee ID, Caliber ID, name or department').length,'the server search stays');
 assert.equal(report(render({})),undefined,'without the shared table the plain list stays');
});
