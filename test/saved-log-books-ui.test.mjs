import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';

const source=readFileSync(new URL('../src/saved-log-books.jsx',import.meta.url),'utf8');
const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function'),'saved-log-books.jsx',{jsx:{runtime:'classic'}});
function harness(){
  const slots=[];let cursor=0;
  const useState=initial=>{const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value}]};
  const scope={React,useState,useRef:value=>useState(()=>({current:value}))[0],useEffect:()=>{},LogBookSectionTabs:()=>null};
  const components=new Function(...Object.keys(scope),code+';return {SavedLogBooks,SavedLogBookDetails,savedLogBookQuery}')(...Object.values(scope));
  return {...components,slots,render(kind='vehicle'){cursor=0;return components.SavedLogBooks({kind,session:{token:'test'}})}};
}
const nodes=(tree,predicate)=>{const found=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(predicate(node))found.push(node);visit(node.props.children)};visit(tree);return found};

test('saved details display exact stored values, preserve zero, and ELB excludes vehicle fields',()=>{
  const {SavedLogBookDetails}=harness();
  const record={id:1,book_no:'CAL/ELB/281026/001',data:{jobCardNo:'JOB-71',caliberId:'CMPL123',employeeName:'Operator Test',openingHmr:0,closingHmr:8,totalWorkingHmr:8,remark:'Checked values'}};
  const html=renderToStaticMarkup(React.createElement(SavedLogBookDetails,{record,kind:'equipment'}));
  assert.match(html,/JOB-71/);assert.match(html,/CMPL123/);assert.match(html,/Operator Test/);assert.match(html,/<dd>0<\/dd>/);assert.match(html,/Checked values/);assert.match(html,/without a source scan/);
  assert.doesNotMatch(html,/KMR|Individual trips|<input|<select/);
  const vlb=renderToStaticMarkup(React.createElement(SavedLogBookDetails,{kind:'vehicle',record:{...record,data:{...record.data,openingKmr:0,closingKmr:14,trips:[{equipmentName:'V69',loadingTime:'07:36',unloadingTime:'07:46',tripCount:1}],scanCardId:'card'}},imageUrl:'blob:test'}));
  assert.match(vlb,/07:36/);assert.match(vlb,/07:46/);assert.match(vlb,/src="blob:test"/);
});

test('saved screen preserves filters in pagination queries, selects the clicked record and hides stale images',()=>{
  const app=harness();app.render();
  const rows=[{id:1,book_no:'VLB-1',data:{scanCardId:'one'}},{id:2,book_no:'VLB-2',data:{scanCardId:'two'}}];
  app.slots[2]=rows;app.slots[3]='100';app.slots[6]=rows[0];app.slots[7]='blob:first';app.slots[10]=1;
  const tree=app.render();
  const details=nodes(tree,node=>node.type===app.SavedLogBookDetails)[0];assert.equal(details.props.imageUrl,'blob:first');
  const viewButtons=nodes(tree,node=>node.type==='button'&&[].concat(node.props.children).join('')==='View VLB');viewButtons[1].props.onClick();
  const next=nodes(app.render(),node=>node.type===app.SavedLogBookDetails)[0];assert.equal(next.props.record.id,2);assert.equal(next.props.imageUrl,'','previous image is never shown for the new record');
  const query=app.savedLogBookQuery({search:'EMP100',location:'Sasti OC',from:'2026-10-01',to:'2026-10-28'},'100');
  const parsed=new URLSearchParams(query);assert.equal(parsed.get('before'),'100');assert.equal(parsed.get('location'),'Sasti OC');assert.equal(parsed.get('search'),'EMP100');assert.equal(parsed.get('from'),'2026-10-01');
});
