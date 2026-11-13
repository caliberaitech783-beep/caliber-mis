import assert from 'node:assert/strict';
import test from 'node:test';
import {domCellText,nearestPrintTable,readDomTable} from '../src/dom-table-model.mjs';

// A small stand-in for the browser's table: only what the reader uses.
const text=value=>({nodeType:3,nodeValue:value});
function el(tag,{attrs={},display='',children=[],colSpan=1,rowSpan=1,...rest}={}){
  const node={nodeType:1,tagName:tag.toUpperCase(),colSpan,rowSpan,childNodes:children,_display:display,
    hasAttribute:name=>name in attrs,getAttribute:name=>attrs[name]??null,
    querySelectorAll(selector){
      const wanted=selector.split(',').map(part=>part.trim());
      const found=[];
      const visit=item=>{if(item.nodeType!==1)return;
        if(wanted.some(part=>part===item.tagName.toLowerCase()||(part==='[role="button"]'&&item.getAttribute('role')==='button')||(part==='input[type="checkbox"]'&&item.tagName==='INPUT'&&item.type==='checkbox')||(part==='input[type="radio"]'&&item.tagName==='INPUT'&&item.type==='radio')))found.push(item);
        item.childNodes.forEach(visit);};
      children.forEach(visit);return found;
    },
    get textContent(){return children.map(child=>child.nodeType===3?child.nodeValue:child.textContent).join('');},
    ...rest};
  node.ownerDocument={defaultView:{getComputedStyle:item=>({display:item._display||({TD:'table-cell',TH:'table-cell',DIV:'block',P:'block'}[item.tagName]||'inline'),visibility:'visible'})}};
  for(const child of children)if(child.nodeType===1)child.ownerDocument=node.ownerDocument;
  return node;
}
const td=(children,more={})=>el('td',{children:[].concat(children).map(child=>typeof child==='string'?text(child):child),...more});
const th=(children,more={})=>el('th',{children:[].concat(children).map(child=>typeof child==='string'?text(child):child),...more});
const table=({head=[],body=[],foot=[]})=>({tHead:head.length?{rows:head.map(cells=>({cells}))}:null,tBodies:[{rows:body.map(cells=>({cells}))}],tFoot:foot.length?{rows:foot.map(cells=>({cells}))}:null});
const values=model=>model.rows.map(row=>model.columns.map(column=>column.value(row)));

test('a pop-up list reads as it is on screen: a name and its small count stay apart, a second line stays a second line',()=>{
  const site=el('button',{children:[text('Jayant OC')]}),count=el('span',{children:[text('3 batches')]});
  const time=el('button',{children:[text('1 h 27 min')]}),started=el('small',{display:'block',children:[text('started 13 Nov, 12:06 am')]});
  const model=readDomTable(table({
    head:[[th('Site and batch number'),th('Trip cards'),th('Batch start to close')]],
    body:[[td([site,count]),td(el('b',{children:[text('751')]})),td([el('b',{children:[text('3 h 13 min')]}),el('small',{display:'block',children:[text('average')]})])],
          [td('CMLL/JAYANT OC/3RD -NOV-26/S3/B01'),td('242'),td([time,started])]],
  }));
  assert.deepEqual(model.columns.map(column=>column.label),['Site and batch number','Trip cards','Batch start to close']);
  assert.deepEqual(values(model),[['Jayant OC 3 batches','751','3 h 13 min\naverage'],['CMLL/JAYANT OC/3RD -NOV-26/S3/B01','242','1 h 27 min\nstarted 13 Nov, 12:06 am']]);
});

test('joined headings become one label and a value joined across rows is repeated on every row',()=>{
  const model=readDomTable(table({
    head:[[th('Site',{rowSpan:2}),th('Shift 1',{colSpan:2}),th('Shift 2',{colSpan:2})],[th('Duties'),th('Red'),th('Duties'),th('Red')]],
    body:[[td('Jayant OC',{rowSpan:2}),td('10'),td('1'),td('12'),td('0')],[td('11'),td('2'),td('9'),td('1')]],
    foot:[[td('All sites'),td('21',{colSpan:2}),td('21'),td('1')]],
  }));
  assert.deepEqual(model.columns.map(column=>column.label),['Site','Shift 1 · Duties','Shift 1 · Red','Shift 2 · Duties','Shift 2 · Red']);
  assert.deepEqual(values(model),[['Jayant OC','10','1','12','0'],['Jayant OC','11','2','9','1'],['All sites','21','','21','1']]);
});

test('button-only columns, marked columns and decoration are left out; a field prints its current value',()=>{
  const open=el('button',{children:[text('Open')]}),scan=el('button',{children:[text('Download scan')]});
  const tick=Object.assign(el('input'),{type:'checkbox',checked:true});
  const hours=Object.assign(el('input'),{type:'text',value:'7.5'});
  const shift=Object.assign(el('select'),{type:'select-one',selectedOptions:[{textContent:'Shift B'}]});
  const arrow=el('span',{attrs:{'aria-hidden':'true'},children:[text('↕')]});
  const model=readDomTable(table({
    head:[[th(''),th([el('button',{children:[el('span',{children:[text('Door')]}),arrow]})]),th('Hours'),th('Shift'),th('Original',{attrs:{'data-smart-print-skip':''}}),th('Actions')]],
    body:[[td(tick),td('V105'),td(hours),td(shift),td(scan),td(open)]],
  }));
  assert.deepEqual(model.columns.map(column=>column.label),['Door','Hours','Shift']);
  assert.deepEqual(values(model),[['V105','7.5','Shift B']]);
});

test('"No records" across the whole table is not a record, and an existing serial heading is not doubled',()=>{
  const empty=readDomTable(table({head:[[th('Sr. No.'),th('Machine')]],body:[[td('No matching records',{colSpan:2})]]}));
  assert.deepEqual(empty.rows,[]);
  assert.deepEqual(empty.columns.map(column=>column.label),['Sr. No.','Machine']);
  const numbered=readDomTable(table({head:[[th('S.No'),th('Machine')]],body:[[td('1'),td('EX-12')]]}));
  assert.equal(numbered.columns[0].label,'Sr. No.');
  assert.equal(readDomTable(null),null);
});

test('a table without a heading block uses its leading heading row, and percent signs stay attached',()=>{
  const model=readDomTable({tHead:null,tFoot:null,tBodies:[{rows:[{cells:[th('Site'),th('Done')]},{cells:[td('Gauri Pauni'),td([el('b',{children:[text('62')]}),text('%')])]}]}]});
  assert.deepEqual(model.columns.map(column=>column.label),['Site','Done']);
  assert.deepEqual(values(model),[['Gauri Pauni','62%']]);
  assert.equal(domCellText({innerText:'  plain   text \n\n second '}),'plain text\nsecond');
});

test('the menu prints the first table after it inside the nearest block that holds a table',()=>{
  const first={closest:()=>null,order:2},second={closest:()=>null,order:5},skipped={closest:()=>({}),order:1};
  const block={parentElement:null,hasAttribute:()=>false,querySelectorAll:()=>[skipped,first,second]};
  const heading={parentElement:block,hasAttribute:()=>false,querySelectorAll:()=>[]};
  const button=order=>({parentElement:heading,compareDocumentPosition:other=>other.order>order?4:2});
  assert.equal(nearestPrintTable(button(0)),first);
  assert.equal(nearestPrintTable(button(3)),second);
  assert.equal(nearestPrintTable(button(9)),first,'with no table after it, the first one in the block');
  assert.equal(nearestPrintTable({parentElement:{parentElement:null,hasAttribute:()=>false,querySelectorAll:()=>[]}}),null);
});
