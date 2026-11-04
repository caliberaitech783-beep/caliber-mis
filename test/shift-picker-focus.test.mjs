import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';

test('Shift picker opens on keyboard focus and commits arrow/Enter selection',async()=>{
 const source=readFileSync(new URL('../src/searchable-select.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
 const {code}=await transformWithOxc(source,'searchable-select.jsx',{jsx:{runtime:'classic'}});
 const slots=[];let cursor=0,value='',selected,prevented=false;
 const useState=initial=>{const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next}]};
 const useRef=()=>({current:{focus(){},select(){},setCustomValidity(){},querySelector(){return null}}});
 const Null=()=>null;
 const Component=new Function('React','useState','useRef','useMemo','useEffect','useId','Search','ChevronDown',code+';return SearchableSelect')(React,useState,useRef,fn=>fn(),()=>{},()=> 'shift',Null,Null);
 const render=()=>{cursor=0;return Component({ariaLabel:'Shift',required:true,value,options:[{value:'a',label:'Shift A'},{value:'b',label:'Shift B'}],onChange:next=>{value=next;selected=next}})};
 const findInput=tree=>React.Children.toArray(tree.props.children).find(node=>React.isValidElement(node)&&node.props.className==='searchable-select-control').props.children.find(node=>React.isValidElement(node)&&node.type==='input');
 let input=findInput(render());assert.equal(input.props['aria-expanded'],false);
 input.props.onFocus({currentTarget:{select(){}}});
 input=findInput(render());assert.equal(input.props['aria-expanded'],true);
 input.props.onKeyDown({key:'ArrowDown',preventDefault(){}});
 input=findInput(render());assert.ok(input.props['aria-activedescendant']);
 input.props.onKeyDown({key:'Enter',preventDefault(){prevented=true}});
 input=findInput(render());assert.equal(prevented,true);assert.equal(selected,'a');assert.equal(input.props.value,'Shift A');assert.equal(input.props['aria-expanded'],false);
});
