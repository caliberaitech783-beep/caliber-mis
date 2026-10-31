import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {transformWithOxc} from 'vite';
import {searchSiteDoors,doorLabel} from '../src/door-search.mjs';
import * as equipment from '../request-equipment.mjs';

const find=(node,predicate)=>!React.isValidElement(node)?[]:[...(predicate(node)?[node]:[]),...React.Children.toArray(node.props.children).flatMap(child=>find(child,predicate))];
const records=[{id:'s12',door:'S12',kind:'vehicle',site:'Dhoptala OC',equipmentName:'Scania'}];

for(const [file,name,initialProps,selectionValue] of [
  ['searchable-select.jsx','SearchableSelect',{options:[{value:'s12',label:'S12'}]},v=>v],
  ['door-combobox.jsx','DoorCombobox',{records,kind:'vehicle',location:'Dhoptala OC'},v=>v],
  ['equipment-combobox.jsx','EquipmentCombobox',{records,group:'vehicle'},v=>v.id],
]){
  for(const method of ['mouse','Enter'])test(`${name}: ${method} selection closes after focus restoration and allows reopening`,async()=>{
    const source=fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
    const {code}=await transformWithOxc(source,file,{jsx:{runtime:'classic'}});
    const state=[],refs=[],frames=[];let cursor=0,refCursor=0,tree,value='';
    const input=()=>find(tree,n=>n.props.role==='combobox')[0];
    // Model a mouse/touch option taking focus, so restoring input focus fires onFocus.
    const scope={SmartSelect: "select",React,ChevronDown:()=>null,Search:()=>null,searchSiteDoors,doorLabel,...equipment,
      requestAnimationFrame:fn=>frames.push(fn),useId:()=>name,
      useMemo:fn=>fn(),useEffect:()=>{},
      useRef:()=>{const i=refCursor++;return refs[i]??= {current:{focus(){input().props.onFocus({currentTarget:{select(){}}})},setCustomValidity(){},querySelector(){return null}}}},
      useState:initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next}];},
    };
    const Component=new Function(...Object.keys(scope),code+`;return ${name};`)(...Object.values(scope));
    const render=()=>{cursor=0;refCursor=0;tree=Component({...initialProps,value,onChange:v=>{value=selectionValue(v)},onSelect:v=>{value=selectionValue(v)}});};
    render();input().props.onClick();render();assert.equal(input().props['aria-expanded'],true);
    if(method==='mouse'){
      let prevented=false,stopped=false;
      find(tree,n=>n.props.role==='option')[0].props.onClick({preventDefault(){prevented=true},stopPropagation(){stopped=true}});
      assert.equal(prevented,true,'avoid enclosing label activating input again');assert.equal(stopped,true);
    }else input().props.onKeyDown({key:'Enter',preventDefault(){}});
    render();for(const frame of frames)frame();render();
    assert.equal(value,'s12');assert.equal(input().props['aria-expanded'],false);
    assert.equal(find(tree,n=>n.props.role==='option').length,0);
    input().props.onClick();render();assert.equal(input().props['aria-expanded'],true);
  });
}
